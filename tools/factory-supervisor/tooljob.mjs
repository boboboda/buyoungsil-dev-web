// 도구 일감(kind=tool, 2-3) 직접 실행기 (감독 프로그램 안에서만 돈다)
// AI 턴 없이 도구 중계(toolbroker.mjs)의 toolkit.run 어댑터로 카드의 도구·방법·옵션을 그대로 실행한다.
// - 일감마다 임시 폴더 <공장>/tooljobs/<id> 에서만 돈다. 앱 폴더와 정비 폴더는 열지 않는다(도구 프로세스의 작업 폴더도 이 폴더).
// - 키는 일감의 requiredSecrets 이면서 설명서가 정한 이 방법의 키만, 도구를 부르는 그 순간에만 환경변수로 붙인다(어댑터가 한다). 값은 로그·보고·파일에 남기지 않는다.
// - 만든 그림은 /api/factory/art 에 '후보'로 올린다(카드 id·판 번호·참고 그림·비용 기록). 임시 폴더는 업로드를 확인한 뒤에만 지운다(rm -rf 가 아니라 아래 deleteToolJobFolder).
// - 카드 방법이 AI 턴을 필요로 하면(AI_TURN_METHODS) 이번에는 '지원 안 함'으로 거절한다.
import fs from "node:fs";
import path from "node:path";

import { pickArtOutputs, createArtRegistrar } from "./artregister.mjs";
import { ADAPTERS, loadToolkitManifest, writeArtRefs, writeProjectSettings } from "./toolbroker.mjs";

export const TOOLJOBS_DIR = "tooljobs";
export const TOOLJOB_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const AI_TURN_METHODS = new Set(); // 지금 설명서의 방법(codex·pixellab·claude·manual)은 모두 툴킷이 직접 처리한다. AI 턴이 필요한 방법을 만들면 여기에 넣는다
const ART_KINDS = ["image-prop", "image-scene", "motion-game", "motion-clip"];
const MAX_SUBJECTS = 8;
const MAX_COUNT = 8;
const MAX_TOTAL = 16;

const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
const isInside = (root, p) => p === root || p.startsWith(root + path.sep);

export const toolJobsRootOf = (workDir) => path.join(workDir, TOOLJOBS_DIR);

/** <공장>/tooljobs/<id>. id 형식이 이상하면 던진다 */
export function toolJobDirOf(workDir, id) {
  if (typeof id !== "string" || !TOOLJOB_ID_RE.test(id)) throw new Error("도구 일감 id 형식이 올바르지 않아요.");
  return path.join(toolJobsRootOf(workDir), id);
}

/**
 * 공장 정리 함수: tooljobs/<id> 폴더 하나만 지운다(그 아래가 일반 폴더이고 tooljobs 안일 때만). rm -rf 는 쓰지 않는다.
 * 반환: "deleted" | "missing". 위험하면 던진다(지우지 않음)
 */
export function deleteToolJobFolder(workDir, id) {
  const dir = toolJobDirOf(workDir, id);
  if (!fs.existsSync(dir) && !isLink(dir)) return "missing";
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("도구 일감 폴더가 일반 폴더가 아니라 지우지 않았어요.");
  const root = fs.realpathSync(toolJobsRootOf(workDir));
  if (!isInside(root, fs.realpathSync(dir)) || fs.realpathSync(dir) === root) throw new Error("도구 일감 폴더가 tooljobs 밖을 가리켜 지우지 않았어요.");
  fs.rmSync(dir, { recursive: true, force: true });
  return "deleted";
}

/** 임시 폴더를 새로 만든다(이전 시도의 폴더가 남아 있으면 정리 함수로 지우고 다시). 반환: 폴더 경로 */
export function prepareToolJob(workDir, id) {
  const dir = toolJobDirOf(workDir, id);
  const root = toolJobsRootOf(workDir);
  if (isLink(root)) throw new Error("tooljobs 폴더가 심볼릭 링크라 쓰지 않아요.");
  fs.mkdirSync(root, { recursive: true });
  deleteToolJobFolder(workDir, id);
  fs.mkdirSync(dir);
  fs.mkdirSync(path.join(dir, ".factory"));
  return dir;
}

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** 서버가 준 toolInput → 정리된 입력. 틀리면 { error } */
export function readToolInput(raw) {
  if (!isRecord(raw)) return { error: "도구 일감 입력(toolInput)이 없어요." };
  const subjects = (Array.isArray(raw.subjects) ? raw.subjects : []).filter((s) => typeof s === "string" && s.trim() && !/[\u0000-\u001f]/.test(s) && s.length <= 60).map((s) => s.trim());
  const count = Number.isInteger(raw.count) ? raw.count : NaN;
  if (!subjects.length || subjects.length > MAX_SUBJECTS) return { error: `대상은 1~${MAX_SUBJECTS}개여야 해요.` };
  if (!(count >= 1 && count <= MAX_COUNT)) return { error: `장 수는 1~${MAX_COUNT}이어야 해요.` };
  if (count * subjects.length > MAX_TOTAL) return { error: `한 일감은 전체 ${MAX_TOTAL}장까지예요.` };
  const extra = typeof raw.extra === "string" ? raw.extra.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 500) : "";
  return { subjects, count, extra, confirmed: raw.confirmed === true };
}

/** 카드 설정에서 결과 종류(없으면 image-prop) */
export const kindOf = (settings) => (ART_KINDS.includes(settings?.results?.default_kind) ? settings.results.default_kind : "image-prop");

/** 한 번 부를 toolkit.run 인자(설명서 도구가 선언한 인자만). prompt 는 대상 이름 + 추가 지시 */
export function buildCallArgs({ card, appSlug, settings, subject, extra, outDir, declared }) {
  const kind = kindOf(settings);
  const all = { kind, subject, project: appSlug, output_dir: outDir, prompt: extra ? `${subject}. ${extra}` : subject };

  if (card.method) all.method = card.method;
  if (kind.startsWith("motion")) {
    if (Number.isInteger(settings?.motion?.frames)) all.frames = settings.motion.frames;
    if (typeof settings?.motion?.preset === "string" && settings.motion.preset) all.preset = settings.motion.preset;
  }

  return Object.fromEntries(Object.entries(all).filter(([k]) => declared.has(k)));
}

const stripCost = (ts) => {
  if (!isRecord(ts) || !isRecord(ts.settings) || !("cost" in ts.settings)) return ts;
  const { cost: _cost, ...rest } = ts.settings;
  return { ...ts, settings: rest };
};

/**
 * 도구 일감 한 건을 실행한다. 던지지 않는다.
 * job: /next 가 준 일감({ id, appSlug, requiredSecrets, toolInput, card, projectToolSettings, approvedArts, pickedArts })
 * d: { workDir, toolkitDir, pythonCmd, secrets(이름→값, 전체), post(form) → { status, data }, log(level, message), redact(s), spawnImpl?, isStopped(), onChild(child|null), beat?() }
 * 반환: { status: "done"|"failed"|"needs_confirmation", summary?, failReason?, toolResult, folder: "deleted"|"kept"|"none" }
 */
export async function runToolJob(job, d) {
  const log = d.log ?? (() => {});
  const redact = d.redact ?? ((s) => s);
  const arts = [];
  let cost = 0;
  const result = (status, message, extra = {}) => ({
    status,
    ...(status === "done" ? { summary: message } : { failReason: message }),
    toolResult: { cost, arts, message: redact(message).slice(0, 600), ...(status === "needs_confirmation" ? { needsConfirmation: true } : {}) },
    folder: "none",
    ...extra,
  });
  let dir = "";

  try {
    const input = readToolInput(job.toolInput);
    if (input.error) return result("failed", input.error);
    const card = isRecord(job.card) ? job.card : null;
    if (!card || typeof card.tool !== "string") return result("failed", "이 일감이 부른 카드를 쓸 수 없어요(지워졌거나 꺼졌거나 설정 오류). 카드를 확인한 뒤 다시 보내세요.");
    if (AI_TURN_METHODS.has(card.method)) return result("failed", `'${card.method}' 방법은 AI 턴이 필요해서 도구 일감으로는 지원하지 않아요(이번 범위 밖). 앱 수정 일감으로 보내세요.`);
    const manifest = loadToolkitManifest(d.toolkitDir);
    if (!manifest.ok) return result("failed", `툴킷 도구함을 읽지 못했어요: ${manifest.reason}`);
    const tool = Object.hasOwn(manifest.tools, card.tool) ? manifest.tools[card.tool] : null;
    if (!tool) return result("failed", `툴킷에 ${card.tool} 도구가 없어요.`);
    const declared = new Set(tool.args.map((a) => a.name));
    if (!declared.has("subject") || !declared.has("output_dir")) return result("failed", `${card.tool} 는 대상(subject)·결과 폴더(output_dir)를 받는 도구가 아니라 카드로 직접 실행할 수 없어요.`);

    dir = prepareToolJob(d.workDir, job.id);
    const settingsIn = input.confirmed ? stripCost(job.projectToolSettings) : job.projectToolSettings; // 사람이 비용 한도를 확인했으면 카드 설정의 비용 한도는 이번 실행에서 건너뛴다
    const settingsState = writeProjectSettings(dir, settingsIn, job.approvedArts, card.rules ?? null);
    const refCount = writeArtRefs(dir, job.pickedArts, job.approvedArts);
    log("info", `임시 폴더 준비: ${TOOLJOBS_DIR}/${job.id} · 카드 ${String(card.name ?? "").slice(0, 40)}(판 ${card.version}) · ${card.tool}${card.method ? ` · ${card.method}` : ""} · 설정 ${settingsState} · 참고 그림 ${refCount}장 먼저`);
    if (input.confirmed) log("info", "비용 한도를 사람이 확인한 일감이라 카드 설정의 비용 한도는 이번 실행에서 건너뛰어요.");

    // 키: 일감이 선언한 것만(어댑터가 다시 설명서의 이 방법 키와 맞춰 필요한 것만 환경변수로 붙인다)
    const requiredSecrets = Array.isArray(job.requiredSecrets) ? job.requiredSecrets.filter((n) => typeof n === "string") : [];
    const secrets = Object.fromEntries(requiredSecrets.filter((n) => typeof d.secrets?.[n] === "string" && d.secrets[n] !== "").map((n) => [n, d.secrets[n]]));
    const secretValues = Object.values(secrets).filter((v) => v.length >= 4);
    const redactAll = (s) => secretValues.reduce((acc, v) => acc.split(v).join("***"), redact(String(s ?? "")));
    const adapter = ADAPTERS["toolkit.run"];
    const ctx = (requestId) => ({
      appDir: dir,
      requestId,
      mode: "allow", // 사람이 승인한 도구 일감이다(중계 설정과 상관없이 직접 실행)
      toolkitDir: d.toolkitDir,
      pythonCmd: d.pythonCmd,
      requiredSecrets,
      toolTimeoutSec: 0,
      hasSecret: (n) => requiredSecrets.includes(n) && typeof secrets[n] === "string" && secrets[n] !== "",
      secretsFor: (names) => Object.fromEntries(names.filter((n) => requiredSecrets.includes(n) && typeof secrets[n] === "string").map((n) => [n, secrets[n]])),
      redact: redactAll,
      spawnImpl: d.spawnImpl,
      onChild: d.onChild ?? (() => {}),
    });

    const registrar = createArtRegistrar({
      appDir: dir,
      jobId: job.id,
      appSlug: job.appSlug,
      card: { id: card.id, version: card.version },
      log: (level, m) => log(level, redactAll(m)),
      post: async (form) => {
        const r = await d.post(form);
        const a = r?.data?.art;

        if (r?.status === 200 && a && typeof a.url === "string") arts.push({ url: a.url, subject: String(a.subject ?? "").slice(0, 60), kind: String(a.kind ?? "").slice(0, 40) });

        return r;
      },
    });

    let made = 0; // 만든 결과(도구 호출 성공 수)
    let wantUploads = 0; // 올라가야 할 그림 수
    let failures = 0;
    let lastFail = "";
    let held = "";
    const total = input.subjects.length * input.count;
    let n = 0;

    outer: for (const subject of input.subjects) {
      for (let k = 1; k <= input.count; k++) {
        n++;
        if (d.isStopped?.()) return result("failed", "중지됐어요(취소 또는 감독 프로그램 종료).", { folder: "kept" });
        const outDir = `out/s${String(input.subjects.indexOf(subject) + 1).padStart(2, "0")}-${k}`;
        const args = buildCallArgs({ card, appSlug: job.appSlug, settings: settingsIn?.settings, subject, extra: input.extra, outDir, declared });
        const requestId = `${job.id}-${n}`.slice(0, 64);
        const c = ctx(requestId);
        const v = adapter.validate({ command: card.tool, args }, c);

        if (!v.ok) {
          failures++;
          lastFail = v.reason;
          log("warn", `[${n}/${total}] ${subject}: 실행하지 못했어요 — ${redactAll(v.reason)}`);
          if (v.status === "denied" || /키|허용/.test(v.reason)) break outer; // 키·권한 문제는 다음 호출도 같다
          continue;
        }
        log("info", `[${n}/${total}] ${subject} 만드는 중…`);
        d.beat?.();
        const r = await adapter.run(v.value, c);

        if (r.art?.cost) cost += r.art.cost;
        else if (r.artSource?.summary?.cost) cost += r.artSource.summary.cost;
        if (r.art?.needsConfirmation) {
          held = "PixelLab 비용 한도(카드 설정)를 넘어 확인이 필요해요.";
          log("warn", `[${n}/${total}] ${subject}: ${held}`);
          break outer;
        }
        if (r.status !== "ok") {
          failures++;
          lastFail = `${r.message}${r.output ? ` — ${redactAll(r.output).slice(-300)}` : ""}`;
          log("warn", `[${n}/${total}] ${subject}: ${redactAll(lastFail)}`);
          continue;
        }
        made++;
        if (r.artSource) {
          wantUploads += pickArtOutputs(dir, r.artSource.outputs).length;
          await registrar.register(r.artSource);
        } else log("warn", `[${n}/${total}] ${subject}: 결과 요약(result.json)을 읽지 못해 그림 저장소에 올리지 못했어요.`);
        log("info", `[${n}/${total}] ${subject}: 완료 (누적 비용 ${cost}회)`);
      }
    }
    await registrar.idle();
    const uploaded = registrar.registered;
    const uploadOk = wantUploads === 0 ? made === 0 : uploaded >= wantUploads && !registrar.stopped;

    // 업로드를 확인한 뒤에만 임시 폴더를 지운다. 못 올렸으면 남겨 두고 알린다(통제실에서 사람이 판단)
    let folder = "kept";
    if (held && !made) folder = tryDelete(d.workDir, job.id, log) ? "deleted" : "kept";
    else if (made && uploadOk) folder = tryDelete(d.workDir, job.id, log) ? "deleted" : "kept";
    else if (!made && failures) folder = tryDelete(d.workDir, job.id, log) ? "deleted" : "kept";
    const tail = `${folder === "deleted" ? "" : ` (임시 폴더 ${TOOLJOBS_DIR}/${job.id} 를 남겨 뒀어요)`}`;

    if (held) {
      return result("needs_confirmation", `${held} 만든 그림 ${arts.length}장은 이미 후보로 올렸어요.`, { folder });
    }
    if (made && !uploadOk) {
      return result("failed", `그림 ${made}건을 만들었지만 그림 저장소에 올리지 못한 것이 있어요(올라간 ${uploaded}/${wantUploads}장).${tail}`, { folder });
    }
    if (!made) return result("failed", `만든 그림이 없어요: ${redactAll(lastFail || "도구 실행 결과가 없어요.")}`, { folder });

    return result("done", `카드 '${String(card.name ?? "").slice(0, 40)}'(판 ${card.version})로 ${made}/${total}건 만들어 후보 ${arts.length}장을 올렸어요. 비용 PixelLab ${cost}회.${failures ? ` 실패 ${failures}건: ${redactAll(lastFail).slice(0, 200)}` : ""}${tail}`, { folder });
  } catch (e) {
    return result("failed", `도구 일감 실행 중 오류: ${redact(e?.message ?? String(e)).slice(0, 300)}`, { folder: dir ? "kept" : "none" });
  }
}

function tryDelete(workDir, id, log) {
  try {
    deleteToolJobFolder(workDir, id);
    log("info", `임시 폴더를 정리했어요: ${TOOLJOBS_DIR}/${id}`);

    return true;
  } catch (e) {
    log("warn", `임시 폴더를 지우지 못했어요: ${e.message}`);

    return false;
  }
}
