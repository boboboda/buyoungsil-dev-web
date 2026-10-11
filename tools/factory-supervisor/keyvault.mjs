// 앱 공장 감독 프로그램: 키 보관함 일(/next 의 keyTasks)
// - check: 지정한 키 파일 하나를 직접 확인한다(확장자 없어도 됨). 1MB 이하 일반 파일만, 심볼릭 링크는 따라가지 않는다.
//   형식(JKS/JCEKS/PKCS12)·별칭·인증서 SHA-1 을 읽는다. JKS 는 비밀번호 없이 읽고, 비밀번호가 이 PC secrets.env 에 있으면
//   keytool 로 비밀번호·별칭도 확인한다(PKCS12 는 비밀번호가 있을 때만 지문까지, 없으면 형식만). 작업 폴더의 앱 폴더 안이고 git 이 추적 중이면 경고.
// - create: [새 공용 키 만들기]. keytool 로 JKS·RSA 2048·10000일 키를 만든다. 대상 경로에 무엇이든 있으면 절대 덮어쓰지 않고 멈춘다.
//   비밀번호가 아직 이 PC 에 없으면(통제실 → secrets.env 전달 전) pending 으로 알려 서버가 다음에 다시 준다.
// - untrack: [커밋에서 빼기]. 앱 폴더 git 기록 조사 → git rm --cached → .gitignore 보강 → 그 두 경로만 로컬 커밋 → 다시 조회.
//   파일은 읽거나 지우거나 옮기지 않고, push·기록 삭제(history rewrite)는 하지 않는다.
// - 결과는 /api/factory/key-vault 로. 비밀번호·개인키 내용은 읽어서 보내지 않는다(오류 글도 가린다).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { addIgnoreLines } from "./keyguard.mjs";
import { expandHome, findKeytool, jksInfo, maskText } from "./release.mjs";

const MAX_BYTES = 1024 * 1024;
const ALIAS_RE = /^[A-Za-z0-9._-]{1,64}$/;

const redact = (s, secrets) => maskText(secrets.filter(Boolean).reduce((acc, v) => acc.split(v).join("***"), String(s ?? "")));

// keytool 메시지는 영어로 받는다(한국어 Windows 에서도 같은 글로 판별)
function keytool(kt, args, storePass, keyPass) {
  return spawnSync(kt, ["-J-Duser.language=en", "-J-Duser.country=US", ...args], {
    encoding: "utf8",
    shell: false,
    timeout: 60_000,
    windowsHide: true,
    env: { ...process.env, FACTORY_KT_STOREPASS: storePass ?? "", FACTORY_KT_KEYPASS: keyPass ?? storePass ?? "" },
  });
}

function keytoolProblem(out) {
  if (/password was incorrect|keystore password was incorrect|tampered with|Given final block not properly padded|failed to decrypt/i.test(out)) return "비밀번호가 틀려요";
  if (/Alias <[^>]*> does not exist/i.test(out)) return "별칭이 파일 안에 없어요";
  if (/Unrecognized keystore format|Invalid keystore format|not a keystore/i.test(out)) return "키 저장소 형식이 아니에요";
  return null;
}

// 작업 폴더의 앱 폴더 안이면 그 앱 이름과 git 추적 여부
function appGit(abs, workDir) {
  if (!workDir) return { inApp: null, gitTracked: null };
  const root = path.resolve(workDir);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return { inApp: null, gitTracked: null };
  const app = rel.split(path.sep)[0];
  const appDir = path.join(root, app);
  if (!fs.existsSync(path.join(appDir, ".git"))) return { inApp: app, gitTracked: null };
  const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", path.relative(appDir, abs)], { cwd: appDir, encoding: "utf8", shell: false, windowsHide: true });
  return { inApp: app, gitTracked: r.status === 0 };
}

/**
 * 키 파일 하나 확인. 돌려주는 값: { info, error }  (error 는 한국어 한 줄, 문제가 없으면 null)
 * storePass·keyPass 는 이 PC 의 secrets.env 값(없으면 null). 로그·결과에 쓰지 않는다.
 */
export function checkKeyFile({ keyPath, alias, storePass = null, keyPass = null, workDir = null }) {
  const abs = path.resolve(expandHome(String(keyPath ?? "")));
  const info = { exists: false, size: null, mtime: null, type: null, aliases: [], aliasFound: null, passwordOk: null, inApp: null, gitTracked: null, note: null };
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return { info, error: `키 파일이 없어요(${keyPath})` };
  }
  if (st.isSymbolicLink()) return { info, error: "심볼릭 링크는 따라가지 않아요. 실제 키 파일 경로를 넣어 주세요." };
  if (!st.isFile()) return { info, error: "일반 파일이 아니에요(폴더 등). 키 파일 경로를 넣어 주세요." };
  Object.assign(info, { exists: true, size: st.size, mtime: st.mtime.toISOString(), ...appGit(abs, workDir) });
  if (st.size > MAX_BYTES) return { info, error: `파일이 너무 커요(${Math.round(st.size / 1024)}KB). 키 파일은 1MB 이하예요.` };

  const parsed = jksInfo(fs.readFileSync(abs));
  info.type = parsed.type;
  info.aliases = parsed.aliases;
  info.note = parsed.note;
  const problems = [];
  if (info.gitTracked) problems.push("⚠️ 앱 폴더 git 이 이 키 파일을 추적 중이에요(커밋에서 빼세요)");

  const pass = storePass || null;
  const kt = pass || parsed.type === "알 수 없음" ? findKeytool() : null;
  if (pass && kt) {
    // 비밀번호가 있으면 keytool 로 비밀번호·별칭·지문을 확인(PKCS12 는 이것으로만 지문을 읽는다)
    const r = keytool(kt, ["-list", "-v", "-keystore", abs, "-storepass:env", "FACTORY_KT_STOREPASS"], pass, keyPass);
    const out = `${r.stdout || ""}\n${r.stderr || ""}`;
    const p = r.status === 0 ? null : keytoolProblem(out);
    if (r.status === 0) {
      info.passwordOk = true;
      const fromKt = [];
      let cur = null;
      for (const line of out.split(/\r?\n/)) {
        const a = /^Alias name:\s*(.+)$/.exec(line.trim());
        if (a) {
          cur = { alias: a[1].trim(), sha1: null };
          fromKt.push(cur);
          continue;
        }
        const h = /^SHA1:\s*([0-9A-F:]{59})/i.exec(line.trim());
        if (h && cur && !cur.sha1) cur.sha1 = h[1].toUpperCase();
      }
      if (fromKt.length) info.aliases = fromKt.slice(0, 20);
      if (/Keystore type:\s*PKCS12/i.test(out)) info.type = "PKCS12";
      if (info.type === "PKCS12") info.note = null;
    } else if (p === "비밀번호가 틀려요") {
      info.passwordOk = false;
      problems.push("비밀번호가 틀려요(통제실에서 이 키의 비밀번호를 다시 등록하세요)");
    } else {
      problems.push(`keytool 로 읽지 못했어요: ${p ?? redact(out.replace(/\s+/g, " ").trim(), [pass, keyPass]).slice(0, 200)}`);
    }
  } else if (pass && !kt) {
    problems.push("keytool 을 찾지 못해 비밀번호는 확인하지 못했어요(JDK·Android Studio 설치 또는 JAVA_HOME)");
  } else if (parsed.type === "PKCS12") {
    info.note = "PKCS12 는 형식만 표시해요(비밀번호를 등록하면 지문까지 확인)";
  }

  if (info.aliases.length) {
    info.aliasFound = info.aliases.some((a) => a.alias.toLowerCase() === String(alias ?? "").toLowerCase());
    if (!info.aliasFound) problems.push(`별칭 '${alias}' 가 파일 안에 없어요(있는 별칭: ${info.aliases.map((a) => a.alias).join(", ")})`);
  }
  if (parsed.type === "알 수 없음" && info.passwordOk !== true) problems.push("키 저장소(JKS/JCEKS/PKCS12) 파일이 아닌 것 같아요");
  return { info, error: problems.length ? redact(problems.join(" / "), [storePass, keyPass]) : null };
}

/** 공용 키 만들기. 돌려주는 값: { ok, pending?, error?, info? } */
export function createKeyFile({ keyPath, alias, dname, storePass, keyPass, workDir = null, log }) {
  if (!storePass) return { ok: false, pending: true, error: "비밀번호가 아직 이 PC 에 없어요(곧 받아서 다시 해요)" };
  if (!ALIAS_RE.test(String(alias ?? ""))) return { ok: false, error: "별칭은 영문·숫자·. _ - 만 쓸 수 있어요" };
  const abs = path.resolve(expandHome(String(keyPath ?? "")));
  let exists = true;
  try {
    fs.lstatSync(abs);
  } catch {
    exists = false;
  }
  if (exists) {
    // 덮어쓰지 않는다. 무엇이 있는지만 확인해 함께 보낸다
    return { ok: false, error: `이미 있어요: ${keyPath}. 덮어쓰지 않았어요(기존 키라면 [기존 키 등록]으로 등록하세요)`, info: checkKeyFile({ keyPath, alias, workDir }).info };
  }
  const kt = findKeytool();
  if (!kt) return { ok: false, error: "keytool 을 찾지 못했어요(JDK 나 Android Studio 를 설치하거나 JAVA_HOME 을 지정하세요)" };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const cn = String(dname ?? "").replace(/[^0-9A-Za-z가-힣 ._-]/g, "").trim().slice(0, 60) || "App Factory";
  const r = keytool(
    kt,
    ["-genkeypair", "-keystore", abs, "-storetype", "JKS", "-alias", alias, "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
      "-dname", `CN=${cn}, C=KR`, "-storepass:env", "FACTORY_KT_STOREPASS", "-keypass:env", "FACTORY_KT_KEYPASS", "-noprompt"],
    storePass,
    keyPass || storePass,
  );
  if (r.status !== 0 || !fs.existsSync(abs)) {
    const why = redact(`${r.stderr || ""} ${r.stdout || ""}`.replace(/\s+/g, " ").trim(), [storePass, keyPass]).slice(0, 300);
    return { ok: false, error: `keytool 로 키를 만들지 못했어요: ${why || `종료 코드 ${r.status}`}` };
  }
  log?.(`공용 키를 새로 만들었어요: ${abs}`);
  const c = checkKeyFile({ keyPath, alias, storePass, keyPass, workDir });
  return { ok: true, info: c.info, error: c.error };
}

// ───────── [커밋에서 빼기] ─────────
// 앱 폴더 git 에서 이 키 파일의 추적만 해제한다. 파일은 읽거나 지우거나 옮기지 않는다. push·기록 삭제는 하지 않는다.
const SKIP_APPS = new Set(["selfdev", "supervisor-src", "node_modules"]);
const UNTRACK_MSG = "chore: 서명 키 추적 해제, .gitignore 보강";
const KEY_GLOBS = ["*.jks", "*.keystore", "*.p12", "*.pfx"];

function gitRun(cwd, args, env) {
  return spawnSync("git", args, { cwd, encoding: "utf8", shell: false, windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...(env ? { env } : {}) });
}
const oneLine = (r) => `${r.stderr || ""} ${r.stdout || ""}`.replace(/\s+/g, " ").trim().slice(0, 200);
const samePath = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** 돌려주는 값: { ok, error?, result } (result 는 서버 KeyUntrack 모양) */
export function untrackKeyFile({ keyPath, workDir }) {
  const result = { ok: true, message: null, file: null, wasTracked: false, stagedOnly: false, commits: [], hasRemote: null, remotes: [], pushed: [], untracked: false, gitignoreAdded: [], commit: null, stillTracked: null };
  const fail = (error) => ({ ok: false, error, result: { ...result, ok: false } });
  const abs = path.resolve(expandHome(String(keyPath ?? "")));
  const root = path.resolve(String(workDir ?? ""));
  const rel0 = path.relative(root, abs);
  if (!workDir || !rel0 || rel0.startsWith("..") || path.isAbsolute(rel0)) return fail("작업 폴더의 앱 폴더 안에 있는 키 파일이 아니에요(앱 폴더 git 만 정리해요).");
  const app = rel0.split(path.sep)[0];
  if (SKIP_APPS.has(app) || app.startsWith(".")) return fail("공장 자체 폴더는 정리하지 않아요.");
  const appDir = path.join(root, app);
  const fileDir = path.dirname(abs);
  if (!fs.existsSync(fileDir)) return fail(`키 파일이 있는 폴더가 없어요(${path.dirname(String(keyPath))}).`);

  const top0 = gitRun(fileDir, ["rev-parse", "--show-toplevel"]);
  if (top0.error?.code === "ENOENT") return fail("git 을 찾지 못했어요(Git 설치 필요).");
  if (top0.status !== 0) return fail("이 앱 폴더는 git 저장소가 아니에요.");
  const top = path.resolve(top0.stdout.trim());
  const inApp = path.relative(appDir, top);
  if (inApp.startsWith("..") || path.isAbsolute(inApp)) return fail("키 파일이 앱 폴더 밖의 git 저장소에 있어요. 정리하지 않았어요.");
  const rel = path.relative(top, abs).split(path.sep).join("/");
  result.file = rel;

  // 1. 상태 조사(파일 내용은 보지 않음)
  if (gitRun(top, ["ls-files", "--error-unmatch", "--", rel]).status !== 0) {
    return { ok: true, result: { ...result, message: "git 이 추적하지 않아요" } };
  }
  result.wasTracked = true;
  const lg = gitRun(top, ["log", "-n", "20", "--abbrev=7", "--date=short", "--format=%h%x09%ad%x09%s", "--", rel]);
  result.commits = lg.status === 0
    ? lg.stdout.split(/\r?\n/).filter(Boolean).map((l) => {
        const [h, d, ...m] = l.split("\t");
        return { hash: h.slice(0, 7), date: d ?? null, subject: m.join(" ").slice(0, 120) || null };
      })
    : [];
  result.stagedOnly = result.commits.length === 0;
  const rm0 = gitRun(top, ["remote"]);
  result.remotes = rm0.status === 0 ? rm0.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 10) : [];
  result.hasRemote = result.remotes.length > 0;
  if (result.hasRemote) {
    for (const c of result.commits) {
      const b = gitRun(top, ["branch", "-r", "--contains", c.hash]);
      const branches = b.status === 0 ? b.stdout.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.includes(" -> ")).slice(0, 10) : [];
      if (branches.length) result.pushed.push({ commit: c.hash, branches });
    }
  }

  // 2. 추적 해제(작업 폴더의 파일은 그대로)
  const rm = gitRun(top, ["rm", "--cached", "-q", "--", rel]);
  if (rm.status !== 0) return fail(`추적 해제에 실패했어요: ${oneLine(rm)}`);
  result.untracked = true;

  // 3. .gitignore 보강(중복 없이)
  result.gitignoreAdded = addIgnoreLines(top, [...KEY_GLOBS, `/${rel}`]);

  // 4. 그 두 경로만 커밋: 임시 인덱스(HEAD 기준)에서 키 파일 제거 + .gitignore 만 반영해 커밋한다.
  //    이미 스테이징돼 있던 다른 파일은 진짜 인덱스에 그대로 남고 커밋에 섞이지 않는다.
  const tmpIndex = path.join(os.tmpdir(), `factory-untrack-${process.pid}-${Date.now()}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    const hasHead = gitRun(top, ["rev-parse", "-q", "--verify", "HEAD"]).status === 0;
    if (hasHead && gitRun(top, ["read-tree", "HEAD"], env).status !== 0) return fail("커밋 준비(read-tree)에 실패했어요. 추적 해제는 됐어요(커밋은 안 함).");
    gitRun(top, ["rm", "--cached", "-q", "--ignore-unmatch", "--", rel], env);
    gitRun(top, ["add", "--", ".gitignore"], env);
    const changed = gitRun(top, hasHead ? ["diff", "--cached", "--quiet", "HEAD"] : ["diff", "--cached", "--quiet"], env).status !== 0 || !hasHead;
    if (changed) {
      const who = gitRun(top, ["config", "user.email"]).stdout.trim() ? [] : ["-c", "user.name=app-factory", "-c", "user.email=factory@localhost"];
      const c = gitRun(top, [...who, "commit", "-q", "--no-verify", "-m", UNTRACK_MSG], env);
      if (c.status !== 0) return fail(`커밋에 실패했어요: ${oneLine(c)}. 추적 해제는 됐어요.`);
      result.commit = gitRun(top, ["rev-parse", "--short=7", "HEAD"]).stdout.trim().slice(0, 7) || null;
    }
  } finally {
    fs.rmSync(tmpIndex, { force: true });
    fs.rmSync(`${tmpIndex}.lock`, { force: true });
  }
  // 진짜 인덱스도 새 커밋과 맞춘다(.gitignore). 키 파일은 위 2단계에서 이미 빠짐
  gitRun(top, ["add", "--", ".gitignore"]);

  // 5. 다시 확인
  result.stillTracked = gitRun(top, ["ls-files", "--error-unmatch", "--", rel]).status === 0;
  if (result.stillTracked) return fail("추적 해제 뒤에도 git 이 이 파일을 추적하고 있어요. 앱 폴더를 직접 확인하세요.");
  return { ok: true, result };
}

let busy = false;

/** /next 의 keyTasks 를 처리하고 결과를 보낸다. 던지지 않는다. readSecrets 는 secrets.env 를 읽는 함수 */
export async function runKeyTasks({ tasks, api, log, workDir, readSecrets }) {
  if (busy || !Array.isArray(tasks) || tasks.length === 0) return;
  busy = true;
  try {
    const secrets = readSecrets();
    const results = [];
    for (const t of tasks.slice(0, 10)) {
      if (!t || typeof t.id !== "string" || typeof t.path !== "string") continue;
      const storePass = (typeof t.storeName === "string" && secrets[t.storeName]) || null;
      const keyPass = (typeof t.keyName === "string" && secrets[t.keyName]) || storePass;
      try {
        if (t.op === "create") {
          const r = createKeyFile({ keyPath: t.path, alias: t.alias, dname: t.dname, storePass, keyPass, workDir, log });
          results.push({ id: t.id, op: "create", ok: r.ok, pending: r.pending === true, error: r.error ?? null, info: r.info ?? null });
          log(r.ok ? `키 보관함: 공용 키 만들기 완료(${t.path})` : r.pending ? "키 보관함: 비밀번호를 기다려요" : `키 보관함: 만들기 실패 - ${r.error}`);
        } else if (t.op === "untrack") {
          const u = untrackKeyFile({ keyPath: t.path, workDir });
          // 끝나면 다시 조회해 경고가 사라졌는지 함께 보낸다
          const c = checkKeyFile({ keyPath: t.path, alias: t.alias, storePass, keyPass, workDir });
          results.push({ id: t.id, op: "untrack", ok: u.ok, error: u.error ?? null, result: u.result, info: c.info });
          log(`키 보관함: 커밋에서 빼기 ${t.path} → ${u.ok ? (u.result.wasTracked ? `해제${u.result.commit ? `, 커밋 ${u.result.commit}` : ""}` : "추적 안 함") : u.error}`);
        } else if (t.op === "check") {
          const r = checkKeyFile({ keyPath: t.path, alias: t.alias, storePass, keyPass, workDir });
          results.push({ id: t.id, op: "check", ok: true, error: r.error, info: r.info });
          log(`키 보관함: 조회 ${t.path} → ${r.info.exists ? `${r.info.type ?? "?"}${r.error ? ` (${r.error})` : ""}` : "파일 없음"}`);
        }
      } catch (e) {
        results.push({ id: t.id, op: t.op, ok: false, error: redact(`처리 중 오류: ${e.message}`, [storePass, keyPass]).slice(0, 300) });
      }
    }
    if (results.length) {
      const r = await api("POST", "/api/factory/key-vault", { results });
      if (r.status !== 200) log(`키 보관함 결과 보내기 거절(${r.status})`);
    }
  } catch (e) {
    log(`키 보관함 처리 오류: ${maskText(e.message)}`);
  } finally {
    busy = false;
  }
}
