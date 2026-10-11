// 앱 공장 감독 프로그램: 출시(반자동) 관련
// - 출시 준비 일감(kind=release)의 작업 규칙
// - 일감이 끝나면 앱 폴더 .factory/outbox/ 의 정해진 파일만, 정해진 홈페이지 주소로 보낸다(그 밖의 파일·주소는 없다)
// - 배포 계정 키 파일이 PC 에 "있는지"만 확인해 알린다(파일 내용은 읽지 않는다)
// - 통제실에서 등록한 키 비밀번호를 받아 secrets.env 에 저장하고, 저장했다고 알려 서버 값을 지우게 한다
// - 첫 출시 일감의 업로드 키 준비: 앱에 key.properties 가 있으면 그대로 두고, 없으면 공용/지정 키를 환경변수로 넘긴다.
//   키 파일이 없으면 만들지 않고 키 단계 실패(키는 설정 → 키 보관함의 [새 공용 키 만들기]에서만 만든다. keyvault.mjs).
//   예전 서버가 generate: true 를 주면 예전처럼 공용 키 파일이 없을 때만 한 번 만든다(있으면 절대 덮어쓰지 않는다)
// - 키 파일 후보 찾기(보조): 앱 폴더의 .jks·.keystore·.p12, 확장자 없는 JKS 파일(2KB~100KB, 매직 0xFEEDFEED)과 key.properties 를 찾아
//   경로·별칭·SHA-1·git 추적 여부만 보고(비밀번호는 읽지 않는다)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 로그·실패 이유에 섞인 비밀번호를 가린다(서버 lib/factory/mask.ts 와 같은 규칙)
const MASK_PATTERNS = [
  /((?:store|key|keystore)?[_-]?pass(?:word|wd)?["']?\s*[=:]\s*["']?)([^\s"',;)]+)/gi,
  /(-(?:src|dest)?(?:store|key)pass(?::env|:file)?\s+)(\S+)/gi,
];
export const maskText = (s) => MASK_PATTERNS.reduce((acc, re) => acc.replace(re, "$1***"), String(s ?? ""));

// outbox 파일 이름 → 보낼 주소. 이 목록에 없는 파일은 보내지 않는다.
const OUTBOX = {
  "project.json": "/api/factory/project", // 홈페이지 프로젝트의 빈 항목만 채움(승인 때 '덮어쓰기'를 고른 store/project 일감만 서버가 덮어씀)
  "release.json": "/api/factory/release", // 출시 패키지(스토어 문구·데이터 보안·콘텐츠 등급·체크리스트·방침 초안·AAB 정보)
};
const MAX_OUTBOX_BYTES = 300 * 1024;
const PROJECT_KEYS = ["description", "coverImage", "appLink", "techStack", "privacyPolicy"];

export function releaseRules(job) {
  if (job.kind !== "release") return "";
  return `
## 출시 준비 (이 일감은 kind=release)
- RELEASE_REQUEST.md 가 이번 지시예요(종류: 첫 출시 / 스토어 수정 / 앱 업데이트(기능 추가) / 프로젝트 업데이트(예전)). 그 종류가 허락한 것만 하세요.
  '앱 업데이트'만 RELEASE_REQUEST.md 의 업데이트 내용대로 앱 코드를 고치고, 다른 종류는 앱 기능을 바꾸지 마세요.
- 첫 출시·스토어 수정은 끝나면 사람이 통제실에서 검토해요(검토 대기). Play 업로드·홈페이지 반영은 승인 뒤 감독 프로그램이 해요. 만든 파일은 지우지 마세요.
- 진행 단계는 RELEASE_REQUEST.md 의 단계 이름(key, build, sign, store, icon, screenshots, video, listing, privacy, code, test, version, done. review·upload·homepage 는 감독 프로그램이)으로 .factory/phase.txt 에 쓰고,
  더 진행할 수 없으면 .factory/fail.json 에 {"stage": "단계", "reason": "이유"} 를 쓰고 끝내세요(비밀번호·키 값 금지).
- 결과는 \`.factory/outbox/\` 에 JSON 파일로 저장하세요(첫 출시: 아래 두 개 + .factory/store/ 의 정해진 파일, 스토어 수정: release.json·project.json + .factory/store/ 의 정해진 파일, 앱 업데이트: release.json(aab·releaseNotes·tests) + 홈페이지 반영을 골랐으면 project.json, 프로젝트 업데이트: project.json). 감독 프로그램이 일감이 끝날 때 홈페이지로 보내요. 다른 파일 이름은 보내지 않아요.
  - \`project.json\` (홈페이지 프로젝트의 빈 항목만 채워요. 승인 때 '덮어쓰기'를 고른 일감은 방침 말고는 바꿔요): {"description": "소개 2~3문장", "privacyPolicy": "개인정보처리방침 마크다운"}
    - 방침에 [[ ... ]] 자리표시자를 남기지 마세요(남으면 거절돼요). 모르는 값은 release.json 의 checklist 에 적으세요.
  - \`release.json\`:
    {"storeListing": {"ko": {"title": "30자 이내", "shortDescription": "80자 이내", "fullDescription": "4000자 이내"}, "en": {...같은 형식}},
     "dataSafety": {"collects": false, "shares": false, "items": [{"type": "데이터 유형", "purpose": "목적", "optional": true}], "encryptedInTransit": true, "deletionRequest": "삭제 요청 방법"},
     "contentRating": {"violence": "없음", "sexual": "없음", "language": "없음", "drugs": "없음", "gambling": "없음", "userInteraction": "없음", "sharesLocation": false, "digitalPurchases": false, "summary": "예상 등급"},
     "checklist": [{"item": "할 일", "done": false, "note": "설명"}],
     "privacyPolicyDraft": "project.json 과 같은 방침 마크다운",
     "sdks": ["코드에서 찾은 광고·분석·오류 수집 SDK 이름"],
     "notes": "사람이 알아야 할 것",
     "aab": {"path": "build/app/outputs/bundle/release/app-release.aab", "versionName": "1.0.0", "versionCode": 1},
     "releaseNotes": {"ko-KR": "앱 업데이트만: 출시 노트 500자 이내"}, "tests": "앱 업데이트만: 분석·시험 결과 한두 줄"}
  - aab 는 실제로 서명 빌드를 만든 경우에만 넣으세요. 경로는 앱 폴더 기준. 파일은 PC 에만 두고 서버로 올리지 않아요(크기·시각은 감독 프로그램이 채워요).
- 서명 키 파일은 RELEASE_REQUEST.md 에 적힌 PC 경로에서 읽기만 하세요(서비스 계정 키 파일은 읽지 마세요). 앱 폴더로 복사하거나 커밋하지 마세요.
- 비밀번호는 환경변수로만 읽고, 파일·로그·커밋·JSON 에 쓰지 마세요.
- Play 업로드(앱 업데이트 AAB → 비공개 테스트 트랙, 스토어 등록정보·이미지)는 감독 프로그램이 해요. 직접 올리지 마세요(fastlane·API 호출 금지). 프로덕션 트랙은 절대 건드리지 마세요.
`;
}

// AAB 정보는 실제 파일을 보고 채운다(앱 폴더 안의 .aab 만). 없으면 빼고 이유를 돌려준다.
export function realAab(dir, aab) {
  if (!aab || typeof aab !== "object" || typeof aab.path !== "string") return { aab: undefined };
  const full = path.resolve(dir, aab.path);
  if (!full.startsWith(dir + path.sep) || !full.toLowerCase().endsWith(".aab")) return { aab: undefined, warn: `AAB 경로가 앱 폴더 밖이거나 .aab 가 아니라서 뺐어요: ${aab.path}` };
  let st;
  try {
    st = fs.statSync(full);
  } catch {
    return { aab: undefined, warn: `AAB 파일이 없어서 뺐어요: ${aab.path}` };
  }
  return {
    aab: {
      path: full,
      size: st.size,
      versionName: typeof aab.versionName === "string" ? aab.versionName : null,
      versionCode: Number.isInteger(aab.versionCode) ? aab.versionCode : null,
      builtAt: st.mtime.toISOString(),
    },
  };
}

// 일감이 끝날 때(완료 보고 전에) 부른다. 보낸 파일은 .factory/outbox/sent/ 로 옮긴다.
// 돌려주는 값: 실패 목록 [{ name, status, message }]. (홈페이지에 연결된 프로젝트가 없어 project.json 이 404 인 것은 실패로 보지 않는다)
// job.release.outbox 가 있으면(서버가 출시 종류별로 정함) 그 파일만 보낸다.
export async function sendOutbox({ dir, job, api, addLog }) {
  const box = path.join(dir, ".factory", "outbox");
  const allowed = Array.isArray(job.release?.outbox) ? job.release.outbox.filter((n) => OUTBOX[n]) : Object.keys(OUTBOX);
  const failures = [];
  let names = [];
  try {
    names = fs.readdirSync(box).filter((n) => fs.statSync(path.join(box, n)).isFile());
  } catch {
    return failures;
  }
  for (const name of names) {
    const endpoint = OUTBOX[name];
    if (!endpoint || !allowed.includes(name)) {
      addLog("warn", `outbox 의 ${name} 은 이 일감에서 보낼 수 있는 파일이 아니라서 건너뛰어요(허용: ${allowed.join(", ")}).`);
      continue;
    }
    const full = path.join(box, name);
    let data;
    try {
      if (fs.statSync(full).size > MAX_OUTBOX_BYTES) throw new Error(`${MAX_OUTBOX_BYTES / 1024}KB 를 넘어요`);
      data = JSON.parse(fs.readFileSync(full, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("JSON 객체가 아니에요");
    } catch (e) {
      addLog("warn", `outbox ${name} 을 읽지 못했어요: ${e.message}`);
      failures.push({ name, status: 0, message: `${name} 을 읽지 못했어요: ${e.message}` });
      continue;
    }
    let body;
    if (name === "project.json") {
      body = { appSlug: job.appSlug, jobId: job.id };
      for (const k of PROJECT_KEYS) if (data[k] !== undefined) body[k] = data[k];
    } else {
      const { aab, warn } = realAab(dir, data.aab);
      if (warn) addLog("warn", warn);
      body = { ...data, jobId: job.id, aab };
    }
    try {
      const r = await api("POST", endpoint, body);
      const msg = r.data?.message ?? "";
      if (r.status === 200) {
        addLog("info", `outbox ${name} 보냄: ${msg}`);
        fs.mkdirSync(path.join(box, "sent"), { recursive: true });
        fs.renameSync(full, path.join(box, "sent", `${job.id}-${name}`));
      } else {
        addLog("warn", `outbox ${name} 보내기 거절(${r.status}): ${msg}`);
        if (!(name === "project.json" && r.status === 404)) failures.push({ name, status: r.status, message: `${name} 거절(${r.status}): ${msg}` });
      }
    } catch (e) {
      addLog("warn", `outbox ${name} 보내기 오류: ${e.message}`);
      failures.push({ name, status: 0, message: `${name} 보내기 오류: ${e.message}` });
    }
  }
  return failures;
}

// Claude 가 남긴 .factory/fail.json (출시 일감에서 단계 실패를 알리는 파일). 없으면 null
export function readFailFile(dir) {
  const p = path.join(dir, ".factory", "fail.json");
  try {
    const v = JSON.parse(fs.readFileSync(p, "utf8"));
    const stage = typeof v?.stage === "string" && /^[a-z_-]{1,40}$/.test(v.stage) ? v.stage : null;
    const reason = typeof v?.reason === "string" ? v.reason.slice(0, 1500) : "";
    return { stage, reason: reason || "이유 없음" };
  } catch {
    return null;
  }
}

// 재시도 때 RELEASE_REQUEST.md 에 붙이는 안내
export function resumeSection(job) {
  const r = job.release;
  if (!r?.resumeFrom) return "";
  return `\n\n## 재시도: '${r.resumeFrom}' 단계부터\n- 이전 시도가 이 단계에서 실패했어요${r.resumeNote ? `: ${maskText(r.resumeNote).slice(0, 500)}` : "."}\n- 앞 단계에서 이미 만든 결과(빌드 산출물, outbox 파일 등)는 다시 만들지 말고 그대로 쓰고, 이 단계부터 이어서 하세요.\n`;
}

// ───────── 업로드 키 준비 (첫 출시) ─────────

export const expandHome = (p) => (p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(os.homedir(), p.slice(1)) : p);

/** 앱 자체 키 설정 파일(Flutter: android/key.properties, 그 밖: key.properties) */
export function appKeyProperties(dir) {
  return ["android/key.properties", "key.properties"].map((r) => path.join(dir, r)).find((p) => fs.existsSync(p)) ?? null;
}

export function findKeytool() {
  const exe = process.platform === "win32" ? "keytool.exe" : "keytool";
  const cands = [
    process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, "bin", exe),
    "keytool",
    process.platform === "win32" && path.join(process.env.ProgramFiles || "C:\\Program Files", "Android", "Android Studio", "jbr", "bin", exe),
    process.platform === "darwin" && "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool",
  ].filter(Boolean);
  for (const c of cands) {
    if (c !== "keytool" && !fs.existsSync(c)) continue;
    const r = spawnSync(c, ["-help"], { encoding: "utf8", shell: false, timeout: 20_000, windowsHide: true });
    if (r.status === 0) return c;
  }
  return null;
}

/**
 * 첫 출시 일감의 키 준비. 돌려주는 값:
 *   { ok: true, env, secrets, note }   env 를 Claude 에 넘기고 secrets(비밀번호 값)는 로그 가리기에 쓴다
 *   { ok: false, reason }              키 단계 실패
 * 앱에 key.properties 가 있으면 아무것도 넘기지 않는다(앱 자체 키를 그대로 쓴다).
 */
export function prepareReleaseKey({ job, dir, secrets, log }) {
  const k = job.release?.key;
  if (job.release?.kind !== "first" || !k) return { ok: true, env: {}, secrets: [], note: null };
  const own = appKeyProperties(dir);
  if (own) return { ok: true, env: {}, secrets: [], note: `앱 자체 키 설정(${path.relative(dir, own)})을 그대로 써요(건드리지 않음).` };

  const storePass = secrets[k.storeName] || (k.legacyStoreName && secrets[k.legacyStoreName]) || "";
  const keyPass = secrets[k.keyName] || (k.legacyKeyName && secrets[k.legacyKeyName]) || storePass;
  if (!storePass) {
    return { ok: false, reason: `키 비밀번호가 이 PC 에 없어요(${k.storeName}). 통제실에서 ${k.source === "custom" ? "이 앱의 다른 키" : "배포 계정"} 비밀번호를 등록한 뒤 재시도하세요.` };
  }
  // 보관함 키는 확장자가 없을 수 있다(예: Untitled). 새로 만드는 예전 방식만 확장자를 본다
  if (typeof k.path !== "string" || !k.path.trim()) return { ok: false, reason: "키 경로가 없어요." };
  if (k.generate && !/\.(jks|keystore)$/i.test(k.path)) return { ok: false, reason: "키 경로가 .jks/.keystore 가 아니에요." };
  const abs = path.resolve(expandHome(k.path));
  let note;

  if (fs.existsSync(abs)) {
    note = `업로드 키 사용: ${k.path} (${k.alias}, 기존 파일 그대로)`;
  } else if (!k.generate) {
    // 운영 키 보호: 출시 일감은 키를 만들지 않는다
    return { ok: false, reason: typeof k.missingMessage === "string" && k.missingMessage ? k.missingMessage : `키 파일이 없어요(${k.path}). 설정 → 키 보관함에서 만들거나 등록하세요.` };
  } else {
    const kt = findKeytool();
    if (!kt) return { ok: false, reason: "keytool 을 찾지 못해 공용 키를 만들 수 없어요(JDK 나 Android Studio 를 설치하거나 JAVA_HOME 을 지정하세요)." };
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (fs.existsSync(abs)) return { ok: false, reason: "키 파일이 방금 생겼어요. 덮어쓰지 않으려고 멈췄어요. 재시도하세요." };
    const r = spawnSync(
      kt,
      ["-genkeypair", "-keystore", abs, "-storetype", "JKS", "-alias", k.alias, "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
        "-dname", String(k.dname || "CN=App Factory, C=KR"), "-storepass:env", "FACTORY_KT_STOREPASS", "-keypass:env", "FACTORY_KT_KEYPASS", "-noprompt"],
      { encoding: "utf8", shell: false, timeout: 60_000, windowsHide: true, env: { ...process.env, FACTORY_KT_STOREPASS: storePass, FACTORY_KT_KEYPASS: keyPass } },
    );
    if (r.status !== 0 || !fs.existsSync(abs)) {
      const why = maskText(`${r.stderr || ""} ${r.stdout || ""}`.replace(/\s+/g, " ").trim()).slice(0, 300);
      return { ok: false, reason: `keytool 로 공용 키를 만들지 못했어요: ${why || `종료 코드 ${r.status}`}` };
    }
    log?.(`공용 업로드 키를 새로 만들었어요: ${abs}`);
    note = `공용 업로드 키를 새로 만들었어요: ${k.path} (${k.alias}). ⚠️ 이 파일과 비밀번호를 PC 밖 안전한 곳 두 군데 이상에 백업하세요.`;
  }
  return {
    ok: true,
    env: { FACTORY_KEYSTORE_PATH: abs, FACTORY_KEY_ALIAS: k.alias, FACTORY_KEYSTORE_PASSWORD: storePass, FACTORY_KEY_PASSWORD: keyPass },
    secrets: [storePass, keyPass],
    note,
  };
}

// ───────── 키 비밀번호 받기 (통제실 등록 → secrets.env) ─────────

const NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

// secrets.env 의 해당 이름 줄만 바꾸거나 덧붙인다. 다른 줄은 그대로 둔다.
function upsertSecrets(file, entries) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = text ? text.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const [name, value] of Object.entries(entries)) {
    if (!NAME_RE.test(name) || typeof value !== "string" || /[\r\n]/.test(value)) throw new Error(`저장할 수 없는 값(${name})`);
    const i = lines.findIndex((l) => new RegExp(`^\\s*${name}\\s*=`).test(l));
    if (i >= 0) lines[i] = `${name}=${value}`;
    else lines.push(`${name}=${value}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, lines.join("\n") + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

let syncingKeys = false;

/** /next 응답에 keyPasswordsPending 이 있으면 부른다. 값은 로그에 남기지 않는다. 던지지 않는다. */
export async function syncKeyPasswords({ api, log, secretsFile }) {
  if (syncingKeys) return;
  syncingKeys = true;
  try {
    const r = await api("GET", "/api/factory/key-passwords");
    if (r.status !== 200 || !Array.isArray(r.data?.items)) return log(`키 비밀번호 가져오기 거절(${r.status})`);
    const ack = [];
    for (const it of r.data.items) {
      if (!it || !NAME_RE.test(it.storeName) || !NAME_RE.test(it.keyName) || typeof it.store !== "string" || typeof it.key !== "string") continue;
      try {
        upsertSecrets(secretsFile, { [it.storeName]: it.store, [it.keyName]: it.key });
        ack.push({ keyRef: it.keyRef, version: it.version });
      } catch (e) {
        log(`키 비밀번호를 secrets.env 에 저장하지 못했어요: ${e.message}`);
      }
    }
    if (ack.length) {
      const a = await api("POST", "/api/factory/key-passwords", { ack });
      log(a.status === 200 ? `키 비밀번호 ${ack.length}개를 secrets.env 에 저장했어요(서버 값은 지움).` : `키 비밀번호 저장 확인 거절(${a.status})`);
    }
  } catch (e) {
    log(`키 비밀번호 가져오기 오류: ${e.message}`);
  } finally {
    syncingKeys = false;
  }
}

// ───────── 키 점검 ─────────

const SKIP_DIRS = new Set(["node_modules", ".git", "build", ".gradle", ".dart_tool", "Pods", ".idea", ".cxx", "intermediates", ".next", "dist", ".factory"]);
const SKIP_APPS = new Set(["selfdev", "supervisor-src", "node_modules"]);

const sha1Hex = (buf) => createHash("sha1").update(buf).digest("hex").toUpperCase().match(/../g).join(":");

/** JKS/JCEKS 파일에서 별칭과 인증서 SHA-1 을 읽는다(인증서는 암호화돼 있지 않아 비밀번호가 필요 없다). PKCS12 는 비밀번호 없이 못 읽는다. */
export function jksInfo(buf) {
  if (buf.length < 12) return { type: "알 수 없음", aliases: [], note: "파일이 너무 작아요" };
  const magic = buf.readUInt32BE(0);
  if (magic !== 0xfeedfeed && magic !== 0xcececece) {
    return { type: buf[0] === 0x30 ? "PKCS12" : "알 수 없음", aliases: [], note: buf[0] === 0x30 ? "PKCS12 는 비밀번호 없이 지문을 읽을 수 없어요" : null };
  }
  const type = magic === 0xfeedfeed ? "JKS" : "JCEKS";
  const aliases = [];
  let o = 4;
  try {
    const ver = buf.readUInt32BE(o);
    o += 4;
    const n = buf.readUInt32BE(o);
    o += 4;
    const utf = () => {
      const l = buf.readUInt16BE(o);
      o += 2;
      const s = buf.toString("utf8", o, o + l);
      o += l;
      return s;
    };
    const cert = () => {
      if (ver === 2) utf(); // 인증서 종류(X.509)
      const l = buf.readUInt32BE(o);
      o += 4;
      const der = buf.subarray(o, o + l);
      o += l;
      return sha1Hex(der);
    };
    for (let i = 0; i < n && i < 20; i++) {
      const tag = buf.readUInt32BE(o);
      o += 4;
      const alias = utf();
      o += 8; // 만든 시각
      if (tag === 1) {
        const kl = buf.readUInt32BE(o);
        o += 4 + kl; // 암호화된 개인키(건너뜀)
        const cc = buf.readUInt32BE(o);
        o += 4;
        let first = null;
        for (let c = 0; c < cc; c++) {
          const h = cert();
          if (c === 0) first = h;
        }
        aliases.push({ alias, sha1: first });
      } else if (tag === 2) {
        aliases.push({ alias, sha1: cert() });
      } else {
        aliases.push({ alias, sha1: null }); // JCEKS 비밀 키 등: 더 읽지 않는다
        break;
      }
    }
  } catch {
    return { type, aliases, note: "파일 끝을 읽지 못했어요(일부만 표시)" };
  }
  return { type, aliases, note: null };
}

// 확장자 없는 파일 중 2KB~100KB 이고 머리가 JKS/JCEKS 매직이면 키 파일 후보
function looksLikeJks(file) {
  let fd;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size < 2 * 1024 || st.size > 100 * 1024) return false;
    fd = fs.openSync(file, "r");
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    const m = b.readUInt32BE(0);
    return m === 0xfeedfeed || m === 0xcececece;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function walk(root, depth, out, budget) {
  if (depth > 5 || budget.n <= 0) return;
  let ents = [];
  try {
    ents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    if (--budget.n <= 0) return;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, depth + 1, out, budget);
    } else if (e.isFile()) {
      const low = e.name.toLowerCase();
      if (low.endsWith(".jks") || low.endsWith(".keystore") || low.endsWith(".p12") || low.endsWith(".pfx")) out.keys.push(full);
      else if (low === "key.properties") out.props.push(full);
      else if (!e.name.includes(".") && out.keys.length < 20 && looksLikeJks(full)) out.keys.push(full); // 확장자 없는 키 파일(예: Untitled)
    }
  }
}

function gitTracked(appDir, file) {
  if (!fs.existsSync(path.join(appDir, ".git"))) return null;
  const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", path.relative(appDir, file)], { cwd: appDir, encoding: "utf8", shell: false, windowsHide: true });
  return r.status === 0;
}

// key.properties 에서 storeFile·keyAlias 줄만 읽는다(비밀번호 줄은 읽어서 쓰지 않는다)
function readKeyProps(file) {
  const out = { storeFile: null, keyAlias: null };
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(storeFile|keyAlias)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].slice(0, 300);
    }
  } catch {
    /* 못 읽음 */
  }
  return out;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

/**
 * /next 응답에 keyScan: true 가 있으면 한 번 실행. 던지지 않는다.
 * only(keyScanApps: 앱 이름 목록)가 있으면 그 앱 폴더만 점검하고, 폴더가 없으면 { missing: true } 로 알린다.
 */
export async function runKeyScan({ api, log, workDir, only = null }) {
  try {
    const apps = [];
    const names = Array.isArray(only) ? [...new Set(only.filter((s) => typeof s === "string" && SLUG_RE.test(s) && !SKIP_APPS.has(s)))].slice(0, 20) : null;
    let dirs = [];
    try {
      dirs = fs.readdirSync(workDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".") && !SKIP_APPS.has(d.name));
    } catch {
      dirs = [];
    }
    if (names) {
      for (const n of names) if (!dirs.some((d) => d.name === n)) apps.push({ appSlug: n, keys: [], keyProperties: [], missing: true });
      dirs = dirs.filter((d) => names.includes(d.name));
    }
    for (const d of dirs.slice(0, 100)) {
      const appDir = path.join(workDir, d.name);
      const found = { keys: [], props: [] };
      walk(appDir, 0, found, { n: 30_000 });
      if (!found.keys.length && !found.props.length) {
        apps.push({ appSlug: d.name, keys: [], keyProperties: [] });
        continue;
      }
      const rel = (p) => path.relative(appDir, p).replace(/\\/g, "/");
      apps.push({
        appSlug: d.name,
        keys: found.keys.slice(0, 20).map((k) => {
          let info = { type: "알 수 없음", aliases: [], note: "읽지 못했어요" };
          try {
            info = jksInfo(fs.readFileSync(k));
          } catch {
            /* 그대로 */
          }
          return { path: rel(k), abs: path.resolve(k), type: info.type, aliases: info.aliases, gitTracked: gitTracked(appDir, k), note: info.note };
        }),
        keyProperties: found.props.slice(0, 10).map((p) => ({ path: rel(p), ...readKeyProps(p), gitTracked: gitTracked(appDir, p) })),
      });
    }
    const r = await api("POST", "/api/factory/key-report", names ? { only: names, apps } : { apps });
    log(r.status === 200 ? `키 점검 결과를 보냈어요(앱 ${apps.length}개${names ? `: ${names.join(", ")}` : ""}).` : `키 점검 결과 보내기 거절(${r.status})`);
  } catch (e) {
    log(`키 점검 오류: ${e.message}`);
  }
}

// ───────── 배포 계정 키 파일 존재 확인 ─────────
const expand = expandHome;
const ALLOWED_EXT = [".jks", ".keystore", ".json"];
let lastPcSig = "";
let lastPcAt = 0;

// /next 응답의 pcPaths 를 받아, 바뀌었거나 10분이 지났으면 존재 여부만 알린다. 내용은 읽지 않는다.
export async function reportPcPaths(pcPaths, api, log) {
  if (!Array.isArray(pcPaths) || pcPaths.length === 0) return;
  const sig = JSON.stringify(pcPaths);
  if (sig === lastPcSig && Date.now() - lastPcAt < 10 * 60 * 1000) return;
  lastPcSig = sig;
  lastPcAt = Date.now();
  const items = [];
  for (const it of pcPaths.slice(0, 20)) {
    if (!it || typeof it.key !== "string" || typeof it.path !== "string") continue;
    if (!ALLOWED_EXT.some((e) => it.path.toLowerCase().endsWith(e))) continue; // 키 파일 확장자만 확인한다
    let st = null;
    try {
      st = fs.statSync(path.resolve(expand(it.path)));
    } catch {
      /* 없음 */
    }
    items.push({ key: it.key, path: it.path, exists: !!st && st.isFile(), size: st?.isFile() ? st.size : null, mtime: st ? st.mtime.toISOString() : null });
  }
  try {
    const r = await api("POST", "/api/factory/pc-status", { items });
    if (r.status !== 200) log(`키 파일 확인 결과 보내기 거절(${r.status})`);
  } catch (e) {
    log(`키 파일 확인 결과 보내기 오류: ${e.message}`);
  }
}
