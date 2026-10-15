// 소설 실행기(7-1): 홈페이지에서 승인된 소설 작업을 가져와 작품 폴더의 cycle.sh 를 대신 돌리고 결과(원고·검수·판정·비용)를 홈페이지에 올린다.
//   - 작품 폴더: <novelsDir>/<작품 이름>  (novelsDir 기본 <workDir>/novels, 설정 novelsDir 로 바꿈). cycle.sh 의 동작은 바꾸지 않는다(git 커밋·푸시도 cycle.sh 가 한다. 여기서는 git 을 건드리지 않음)
//   - 실행 전: 열린 메모를 reviews/NNN-memo.md 에 '- (필수|권장) [L줄번호] 내용' 으로 이어 붙인다(기존 항목 유지, 같은 줄은 한 번만)
//   - 실행: git Bash(bash.exe)로 ./cycle.sh NNN [--fresh] [--skip-write] [--max-rewrites N]. UTF-8 출력 보장. 표준출력 끝 200줄을 15초마다 진행 로그로 보냄
//   - 실행 후: 로그·검수·usage.md 에서 판정·필수/권장 건수·글자 수·비용을 읽어 완료 보고. chapters/NNN.md·reviews/NNN.md 도 같이 올림. 메모는 성공했을 때만 applied
//   - 한 번에 하나(앱 일감·정비가 돌면 시작하지 않음. 이 판단은 호출하는 쪽 supervisor.mjs 가 canStart 로 알려 줌). 최대 40분(서버가 준 timeoutMin)
//   - 시작할 때 한 번 서버에 recover 를 보내 이 PC 에서 running 으로 남은 작업을 failed 로 정리한다(재시작해도 중복 실행·영원히 running 방지)
//   - 서버가 아직 새 버전이 아니면(404) 조용히 10분 뒤 다시 본다. 이 모듈의 오류는 대기열 확인(/next 폴링)에 영향을 주지 않는다(호출하는 쪽이 try/catch)
// 시험: tests/novelrun.test.mjs
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const NOVEL_BEAT_MS = 15_000; // 진행 로그를 보내는 간격(10초 이상)
export const NOVEL_SYNC_EVERY_MS = 10 * 60_000; // 원고·검수 사본 올리기 주기(작업이 없을 때)
export const NOVEL_RETRY_MS = 10 * 60_000; // 서버가 아직 새 버전이 아닐 때 다시 보는 간격
export const DEFAULT_TIMEOUT_MIN = 40;
export const LOG_TAIL_LINES = 200;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const MAX_CHAPTER_CHARS = 100_000;
const MAX_REVIEW_CHARS = 150_000;

export const epName = (n) => String(Number(n)).padStart(3, "0");

/** 작품 폴더들이 있는 곳 */
export function novelsDirOf(cfg) {
  return path.resolve(cfg.novelsDir || path.join(cfg.workDir, "novels"));
}

/** 작품 폴더 경로. 이름 형식이 이상하거나 novelsDir 밖이면 null */
export function workDirOf(cfg, slug) {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return null;
  const base = novelsDirOf(cfg);
  const dir = path.resolve(base, slug);
  return dir.startsWith(base + path.sep) ? dir : null;
}

/** cycle.sh 인자(화 번호 뒤). params: { fresh, skipWrite, maxRewrites } */
export function cycleArgs(episode, params = {}) {
  const args = [epName(episode)];
  if (params.fresh) args.push("--fresh");
  else if (params.skipWrite) args.push("--skip-write");
  const n = Number(params.maxRewrites);
  args.push("--max-rewrites", String(Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0));
  return args;
}

/** 메모 파일에 이어 붙인다. 기존 내용은 그대로 두고, 이미 같은 줄이 있으면 건너뛴다. 붙인 줄 수를 돌려준다 */
export function appendMemo(file, lines, episode) {
  const clean = lines.map((l) => String(l).replace(/[\r\n]+/g, " ").trim()).filter((l) => l.startsWith("- "));
  if (!clean.length) return 0;
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    text = `# ${epName(episode)}화 사람의 수정 요청 메모\n\ncycle.sh가 이 파일의 \`- \` 항목을 writer와 checker에 넘긴다. checker는 본문이 지키지 않으면 '필수' 지적으로 올린다.\n\n`;
  }
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const add = [...new Set(clean)].filter((l) => !have.has(l));
  if (!add.length) return 0;
  const body = (text.endsWith("\n") || text === "" ? text : text + "\n") + add.join("\n") + "\n";
  fs.writeFileSync(file, body, { encoding: "utf8" });
  return add.length;
}

// ───────── 결과 읽기 ─────────

/** reviews/NNN.md 맨 끝 VERDICT: PASS|FAIL|UNKNOWN */
export function parseVerdict(md) {
  const all = [...String(md ?? "").matchAll(/^[`*\s]*VERDICT:\s*(PASS|FAIL|UNKNOWN)[`*\s]*$/gm)];
  return all.length ? all[all.length - 1][1] : null;
}

/** 검수 파일의 필수/권장 건수: 맨 끝 '필수 합계 N건, 권장 M건' 줄이 우선, 없으면 지적 표의 등급을 센다 */
export function parseCounts(md) {
  const text = String(md ?? "");
  const m = [...text.matchAll(/필수 합계\s*(\d+)\s*건,\s*권장\s*(\d+)\s*건/g)].pop();
  if (m) return { must: Number(m[1]), rec: Number(m[2]) };
  let must = 0;
  let rec = 0;
  for (const line of text.split(/\r?\n/)) {
    const g = /^\|\s*[*`]?(필수|권장)[*`]?\s*\|/.exec(line);
    if (g) g[1] === "필수" ? must++ : rec++;
  }
  return must + rec > 0 ? { must, rec } : { must: null, rec: null };
}

/** 로그 파일에서 가장 최근 '===== NNN화 사이클 결과 =====' 블록 */
export function lastResultBlock(logText, episode) {
  const text = String(logText ?? "");
  const mark = `===== ${epName(episode)}화 사이클 결과 =====`;
  const i = text.lastIndexOf(mark);
  return i < 0 ? "" : text.slice(i);
}

export function parseChars(block, reviewMd) {
  const a = /글자 수:\s*공백 포함\s*([\d,]+)자/.exec(block);
  if (a) return Number(a[1].replace(/,/g, ""));
  const b = [...String(reviewMd ?? "").matchAll(/분량\s*([\d,]+)자/g)].pop();
  return b ? Number(b[1].replace(/,/g, "")) : null;
}

/** usage.md 의 표 행들(`| 숫자 |` 로 시작) */
export const usageRows = (text) => String(text ?? "").split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l));

/** 이번 실행으로 늘어난 usage 행들의 비용($) 합. 행이 줄었으면(파일이 다시 쓰였으면) 0 으로 본다 */
export function costOfNewRows(before, after) {
  if (after.length <= before.length) return 0;
  let sum = 0;
  for (const row of after.slice(before.length)) {
    const m = [...row.matchAll(/\$(\d+(?:\.\d+)?)/g)].pop();
    if (m) sum += Number(m[1]);
  }
  return Math.round(sum * 10000) / 10000;
}

export function summaryLine({ verdict, must, rec, chars, rewrites, costUsd }) {
  const parts = [];
  parts.push(verdict ? `판정 ${verdict}` : "판정 없음");
  if (must != null) parts.push(`필수 ${must}건`);
  if (rec != null) parts.push(`권장 ${rec}건`);
  if (chars != null) parts.push(`${chars.toLocaleString("en-US")}자`);
  if (rewrites) parts.push(`재작성 ${rewrites}`);
  parts.push(`$${costUsd.toFixed(2)}`);
  return parts.join(" · ");
}

const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const titleOf = (chapter) => {
  const m = /^#\s*(?:\d+\s*화\s*)?(.+)$/m.exec(String(chapter ?? "").split(/\r?\n/)[0] ?? "");
  return m ? m[1].trim().slice(0, 100) : null;
};

/** 폴더의 원고·검수 한 화를 서버에 올릴 본문으로 */
export function readEpisodeFiles(dir, episode) {
  const ep = epName(episode);
  const chapter = read(path.join(dir, "chapters", `${ep}.md`));
  const review = read(path.join(dir, "reviews", `${ep}.md`));
  return { chapter: chapter == null ? null : chapter.slice(0, MAX_CHAPTER_CHARS), review: review == null ? null : review.slice(0, MAX_REVIEW_CHARS) };
}

/** 작품 폴더 목록(cycle.sh 가 있는 폴더) */
export function listNovelDirs(cfg) {
  const base = novelsDirOf(cfg);
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && SLUG_RE.test(e.name) && fs.existsSync(path.join(base, e.name, "cycle.sh")))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function listEpisodes(dir) {
  try {
    return fs
      .readdirSync(path.join(dir, "chapters"))
      .map((f) => /^(\d{1,4})\.md$/.exec(f))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .filter((n) => n >= 1 && n <= 9999)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export function findBashCmd(configured, { exists = fs.existsSync, env = process.env, platform = process.platform } = {}) {
  if (configured) return configured;
  if (platform === "win32") {
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs")]) {
      if (!base) continue;
      const p = path.join(base, "Git", "bin", "bash.exe");
      if (exists(p)) return p;
    }
  }
  return "bash";
}

/**
 * 소설 실행기를 만든다. deps:
 *  api(method, path, body, opts) → { status, data }   홈페이지 호출(토큰 포함)
 *  log(msg)   cfg() → 설정   killTree(child)   redact(text)   env() → 자식 프로세스에 줄 환경변수   spawnFn(테스트용)   now()
 */
export function createNovelRunner({ api, log, cfg, killTree, redact = (s) => s, env = () => process.env, spawnFn = spawn, now = () => Date.now(), beatMs = NOVEL_BEAT_MS }) {
  const st = { job: null, child: null, stopped: null, recovered: false, retryAt: 0, syncAt: 0, syncing: false, hashes: new Map(), unsupportedLogged: false };

  const unsupported = (r, what) => {
    if (r.status !== 404) return false;
    st.retryAt = now() + NOVEL_RETRY_MS;
    if (!st.unsupportedLogged) {
      st.unsupportedLogged = true;
      log(`[소설] 홈페이지가 아직 소설 실행 기능이 없는 버전이에요(${what} 404). 서버 배포 뒤 자동으로 시작해요.`);
    }
    return true;
  };

  async function recover() {
    const r = await api("POST", "/api/novel/jobs/recover", {});
    if (unsupported(r, "recover")) return false;
    if (r.status !== 200) {
      log(`[소설] 재시작 정리 응답 이상: ${r.status}`);
      return false;
    }
    st.recovered = true;
    st.unsupportedLogged = false;
    if (r.data?.failed) log(`[소설] 감독 재시작 전에 running 이던 작업 ${r.data.failed}개를 실패로 정리했어요.`);
    return true;
  }

  /** 원고·검수 사본 올리기(작업이 없을 때 주기적으로). 바뀐 것만 */
  async function syncContent() {
    if (st.syncing || st.job) return 0;
    st.syncing = true;
    let sent = 0;
    try {
      for (const slug of listNovelDirs(cfg())) {
        const dir = workDirOf(cfg(), slug);
        for (const ep of listEpisodes(dir)) {
          if (st.job || st.stopped) return sent;
          const f = readEpisodeFiles(dir, ep);
          const hash = createHash("sha1").update(`${f.chapter ?? ""}\u0000${f.review ?? ""}`).digest("hex");
          const key = `${slug}/${ep}`;
          if (st.hashes.get(key) === hash) continue;
          const counts = f.review ? parseCounts(f.review) : { must: null, rec: null };
          const r = await api("POST", "/api/novel/jobs/content", {
            slug,
            episode: ep,
            title: titleOf(f.chapter),
            ...(f.chapter != null ? { chapter: f.chapter } : {}),
            ...(f.review != null ? { review: f.review, verdict: parseVerdict(f.review), mustCount: counts.must, recCount: counts.rec } : {}),
          });
          if (unsupported(r, "content")) return sent;
          if (r.status !== 200) {
            log(`[소설] 원고 올리기 거절(${slug} ${ep}화): ${r.status} ${r.data?.message ?? ""}`);
            continue;
          }
          st.hashes.set(key, hash);
          sent++;
        }
      }
      st.syncAt = now();
      if (sent) log(`[소설] 원고·검수 ${sent}화를 홈페이지에 올렸어요.`);
    } catch (e) {
      log(`[소설] 원고 올리기 오류: ${e.message}`);
    } finally {
      st.syncing = false;
    }
    return sent;
  }

  async function post(pathname, body, tries = 1) {
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        last = await api("POST", pathname, body, { timeoutMs: 60_000 });
        if (last.status === 200 || (last.status >= 400 && last.status < 500)) return last;
      } catch (e) {
        last = { status: 0, data: { message: e.message } };
      }
      if (i < tries - 1) await new Promise((r) => setTimeout(r, beatMs <= 1000 ? 50 : 5000 * 3 ** i));
    }
    return last;
  }

  async function run(job) {
    const c = cfg();
    const dir = workDirOf(c, job.workSlug);
    const ep = epName(job.episode);
    const started = now();
    const timeoutMs = Math.max(1, Number(job.timeoutMin) || DEFAULT_TIMEOUT_MIN) * 60_000;
    const tail = [];
    let partial = "";
    let timedOut = false;
    const finish = async (body) => {
      const r = await post("/api/novel/jobs/complete", { id: job.id, ...body }, 4);
      if (r?.status !== 200) log(`[소설] 완료 보고 실패(${job.id}): ${r?.status} ${r?.data?.message ?? ""} — 서버가 10분 안에 실패로 정리해요.`);
      return r;
    };
    const failNow = (why) => finish({ ok: false, summary: why, logTail: tail.join("\n") });
    try {
      if (!dir || !fs.existsSync(path.join(dir, "cycle.sh"))) return await failNow(`작품 폴더나 cycle.sh 가 없어요: ${job.workSlug} (${novelsDirOf(c)})`);
      if (!/^\d+$/.test(String(job.episode))) return await failNow("화 번호가 올바르지 않아요.");
      log(`[소설] 시작: ${job.workSlug} ${ep}화 (${job.mode}, 메모 ${job.notes?.length ?? 0}건)`);
      // 실행 전: 열린 메모를 메모 파일에 이어 붙인다
      const memoLines = (job.notes ?? []).map((n) => n.memoLine).filter(Boolean);
      const added = appendMemo(path.join(dir, "reviews", `${ep}-memo.md`), memoLines, job.episode);
      if (memoLines.length) log(`[소설] 메모 ${memoLines.length}건 중 ${added}건을 ${ep}-memo.md 에 이어 붙였어요.`);
      const usageBefore = usageRows(read(path.join(dir, "usage.md")));
      const bash = findBashCmd(c.bashCmd);
      const args = ["./cycle.sh", ...cycleArgs(job.episode, job.params)];
      const child = spawnFn(bash, args, {
        cwd: dir,
        env: { ...env(), PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", FACTORY_ROLE: "novel" },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      st.child = child;
      st.job = job;
      const onData = (chunk) => {
        const text = partial + chunk;
        const parts = text.split(/\r?\n/);
        partial = parts.pop() ?? "";
        for (const line of parts) tail.push(redact(line.slice(0, 2000)));
        if (tail.length > LOG_TAIL_LINES) tail.splice(0, tail.length - LOG_TAIL_LINES);
      };
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      // 끝났다는 신호는 exit(종료 코드). 남은 출력은 close 까지 잠깐만 기다린다(멈춘 cycle.sh 의 손자 프로세스가 출력 통로를 쥐고 있어도 막히지 않게)
      const exit = new Promise((resolve) => {
        let res = null;
        child.on("error", (e) => resolve({ code: -1, error: e.message }));
        child.on("exit", (code) => {
          res = { code };
          setTimeout(() => resolve(res), 1000);
        });
        child.on("close", (code) => resolve(res ?? { code }));
      });
      const sendProgress = async () => {
        const text = [...tail, ...(partial ? [redact(partial)] : [])].slice(-LOG_TAIL_LINES).join("\n");
        try {
          const r = await api("POST", "/api/novel/jobs/progress", { id: job.id, logTail: text });
          if (r.status === 200 && r.data?.cancel === true && !st.stopped) {
            st.stopped = "취소";
            log(`[소설] 사람이 취소했어요(${job.workSlug} ${ep}화). cycle.sh 를 멈춰요.`);
            killTree(child);
          }
        } catch {
          /* 한 번 놓쳐도 다음 하트비트가 보낸다 */
        }
      };
      const beat = setInterval(() => {
        sendProgress();
        if (now() - started > timeoutMs && !timedOut && !st.stopped) {
          timedOut = true;
          log(`[소설] 시간 초과(${Math.round(timeoutMs / 60_000)}분): ${job.workSlug} ${ep}화. cycle.sh 를 멈춰요.`);
          killTree(child);
        }
      }, beatMs);
      sendProgress();
      const res = await exit;
      clearInterval(beat);
      if (partial) tail.push(redact(partial));
      if (st.stopped === "감독 프로그램 종료") return; // 종료 중: 서버가 재시작 때 failed 로 정리한다
      const logTail = tail.slice(-LOG_TAIL_LINES).join("\n");
      if (st.stopped === "취소") return await finish({ ok: false, summary: "사람이 취소했어요.", logTail });
      if (timedOut) return await finish({ ok: false, summary: `시간 초과(${Math.round(timeoutMs / 60_000)}분)로 중단했어요.`, logTail });
      if (res.code !== 0) {
        const lastLines = tail.filter((l) => l.trim()).slice(-4).join(" / ").slice(0, 600);
        return await finish({ ok: false, summary: `cycle.sh 가 오류로 끝났어요(종료 코드 ${res.code}${res.error ? `, ${res.error}` : ""}). ${lastLines}`.slice(0, 3800), logTail });
      }
      // 결과 읽기
      const files = readEpisodeFiles(dir, job.episode);
      const block = lastResultBlock(read(path.join(dir, "logs", `cycle-${ep}.log`)), job.episode);
      const verdict = parseVerdict(files.review) ?? (/최종 판정:\s*(PASS|FAIL|UNKNOWN)/.exec(block)?.[1] ?? null);
      const counts = parseCounts(files.review);
      const chars = parseChars(block, files.review);
      const costUsd = costOfNewRows(usageBefore, usageRows(read(path.join(dir, "usage.md"))));
      const rewrites = /재작성 횟수:\s*(\d+\s*\/\s*\d+)/.exec(block)?.[1]?.replace(/\s+/g, "") ?? null;
      const summary = summaryLine({ verdict, must: counts.must, rec: counts.rec, chars, rewrites, costUsd });
      const r = await finish({
        ok: true,
        verdict,
        mustCount: counts.must,
        recCount: counts.rec,
        charCount: chars,
        costUsd,
        summary,
        logTail,
        chapter: files.chapter,
        review: files.review,
        appliedNoteIds: (job.notes ?? []).map((n) => n.id),
      });
      log(`[소설] 완료: ${job.workSlug} ${ep}화 — ${summary}`);
      if (r?.status === 200 && files.chapter != null) st.hashes.set(`${job.workSlug}/${job.episode}`, createHash("sha1").update(`${files.chapter ?? ""}\u0000${files.review ?? ""}`).digest("hex"));
      return r;
    } catch (e) {
      log(`[소설] 실행 중 오류: ${e.stack || e.message}`);
      return await failNow(`감독 프로그램 오류: ${e.message}`.slice(0, 800));
    } finally {
      st.job = null;
      st.child = null;
      st.stopped = null;
    }
  }

  /**
   * 대기열 확인 한 번(15초마다). canStart: 지금 새로 시작해도 되는가(일시 정지·업데이트·재시작 대기·앱 일감·정비 중이 아님).
   * 일감을 시작하면 true. 던지지 않는다.
   */
  async function tick({ canStart, idle = canStart }) {
    try {
      if (st.job) return false;
      if (now() < st.retryAt) return false;
      if (!st.recovered && !(await recover())) return false;
      if (canStart) {
        const r = await api("GET", "/api/novel/jobs/next");
        if (unsupported(r, "next")) return false;
        if (r.status === 200 && r.data?.job) {
          st.job = r.data.job; // 바로 '진행 중'으로 센다(run 이 이어서 채움)
          run(r.data.job).catch((e) => log(`[소설] 예기치 못한 오류: ${e.message}`));
          return true;
        }
        if (r.status !== 200) log(`[소설] 대기열 응답 이상: ${r.status} ${r.data?.message ?? ""}`);
      }
      if (idle && !st.syncing && now() - st.syncAt > NOVEL_SYNC_EVERY_MS) void syncContent();
    } catch (e) {
      log(`[소설] 확인 오류: ${e.message}`);
    }
    return false;
  }

  return {
    tick,
    busy: () => !!st.job,
    syncContent,
    recover,
    /** 감독 프로그램 종료: 도는 cycle.sh 를 멈춘다(서버는 재시작 때 running 을 failed 로 정리) */
    stop() {
      if (st.child && st.job) {
        st.stopped = "감독 프로그램 종료";
        killTree(st.child);
      }
    },
    _state: st,
  };
}
