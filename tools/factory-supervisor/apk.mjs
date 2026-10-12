// 앱 공장 감독 프로그램: 출시 패키지 '시험용 APK'(출시 일감 종류 apk)
// - AI 가 앱 폴더에서 만든 서명 release APK(.factory/apk.json 에 경로·버전)를 감독 프로그램이 검사한다:
//   경로는 앱 폴더 안의 .apk 만, apksigner verify 로 서명 확인, 디버그 키 거절, 등록된 키(또는 앱 자체 key.properties 의 키)와 서명 인증서 SHA-256 비교.
// - 통과하면 크기·SHA-256·버전·빌드 시각·git 커밋을 붙여 /api/factory/test-apk 로 8MB 조각씩 올린다(관리자만 내려받기, 앱당 최근 5개).
// - 키 파일·비밀번호는 홈페이지로 보내지 않는다. 비밀번호는 keytool 에 환경변수로만 넘기고(인자·로그에 없음), 서명 인증서 지문(공개 정보)만 보낸다.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appKeyProperties, expandHome, findKeytool, jksInfo, maskText } from "./release.mjs";

const IS_WIN = process.platform === "win32";
export const APK_CHUNK = 8 * 1024 * 1024;
export const APK_MAX_DEFAULT = 200 * 1024 * 1024;
const hex = (s) => String(s ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");

// ───────── .factory/apk.json ─────────

/**
 * AI 가 남긴 .factory/apk.json 을 읽어 실제 파일로 확인한다. 경로는 앱 폴더 안의 .apk 만(밖이면 거절).
 * 돌려주는 값: { ok: true, file, size, versionName, versionCode, builtAt } | { ok: false, reason }
 */
export function readApkInfo(dir, { maxBytes = APK_MAX_DEFAULT } = {}) {
  let v;
  try {
    v = JSON.parse(fs.readFileSync(path.join(dir, ".factory", "apk.json"), "utf8"));
  } catch {
    return { ok: false, reason: ".factory/apk.json 이 없거나 JSON 이 아니에요(APK 를 만들지 못한 것 같아요)." };
  }
  if (!v || typeof v.path !== "string" || !v.path.trim()) return { ok: false, reason: "apk.json 에 path 가 없어요." };
  const root = path.resolve(dir);
  const file = path.resolve(root, v.path);
  if (!file.startsWith(root + path.sep) || !file.toLowerCase().endsWith(".apk") || /["%^&|<>\r\n]/.test(file)) {
    return { ok: false, reason: `APK 경로가 앱 폴더 밖이거나 .apk 가 아니에요: ${String(v.path).slice(0, 200)}` };
  }
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return { ok: false, reason: `APK 파일이 없어요: ${v.path}` };
  }
  if (!st.isFile() || st.size === 0) return { ok: false, reason: `APK 파일이 비었거나 파일이 아니에요: ${v.path}` };
  if (st.size > maxBytes) return { ok: false, reason: `APK 가 ${Math.round(st.size / 1024 / 1024)}MB 예요. ${Math.round(maxBytes / 1024 / 1024)}MB 이하만 올릴 수 있어요.` };
  return {
    ok: true,
    file,
    size: st.size,
    versionName: typeof v.versionName === "string" ? v.versionName.slice(0, 40) : null,
    versionCode: Number.isInteger(v.versionCode) && v.versionCode >= 0 ? v.versionCode : null,
    builtAt: st.mtime.toISOString(),
  };
}

export function sha256File(file) {
  const h = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

// ───────── apksigner ─────────

function sdkDir() {
  return [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, IS_WIN && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk"), path.join(os.homedir(), "Library", "Android", "sdk"), path.join(os.homedir(), "Android", "Sdk")].find(
    (d) => d && fs.existsSync(d),
  );
}

const verNum = (v) => v.split(/[.-]/).map((x) => Number(x) || 0).reduce((a, x) => a * 1000 + x, 0);

/** 가장 새 build-tools 의 apksigner.jar. 없으면 null */
export function findApksignerJar(sdk = sdkDir()) {
  if (!sdk) return null;
  let vers = [];
  try {
    vers = fs.readdirSync(path.join(sdk, "build-tools"));
  } catch {
    return null;
  }
  for (const v of vers.sort((a, b) => verNum(b) - verNum(a))) {
    const jar = path.join(sdk, "build-tools", v, "lib", "apksigner.jar");
    if (fs.existsSync(jar)) return jar;
  }
  return null;
}

/** apksigner 를 돌릴 java(JAVA_HOME → Android Studio jbr → PATH). 없으면 null */
export function findJava() {
  const exe = IS_WIN ? "java.exe" : "java";
  const cands = [
    process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, "bin", exe),
    IS_WIN && path.join(process.env.ProgramFiles || "C:\\Program Files", "Android", "Android Studio", "jbr", "bin", exe),
    process.platform === "darwin" && "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java",
    "java",
  ].filter(Boolean);
  for (const c of cands) {
    if (c !== "java" && !fs.existsSync(c)) continue;
    const r = spawnSync(c, ["-version"], { encoding: "utf8", shell: false, timeout: 20_000, windowsHide: true });
    if (r.status === 0) return c;
  }
  return null;
}

/**
 * apksigner verify --print-certs 출력 해석.
 * 돌려주는 값: { signers: [{ dn, sha256 }], schemes: ["v1","v2",...] }
 */
export function parseApksigner(out) {
  const text = String(out ?? "");
  const signers = [];
  for (const m of text.matchAll(/Signer #(\d+) certificate (DN|SHA-256 digest): (.+)/g)) {
    const i = Number(m[1]) - 1;
    signers[i] = signers[i] ?? { dn: null, sha256: null };
    if (m[2] === "DN") signers[i].dn = m[3].trim();
    else signers[i].sha256 = hex(m[3]);
  }
  const schemes = [...text.matchAll(/Verified using v([0-9.]+) scheme \(([^)]*)\): true/g)].map((m) => `v${m[1]}`);
  return { signers: signers.filter(Boolean), schemes };
}

export const isDebugCert = (dn) => /CN=Android Debug/i.test(String(dn ?? ""));

/** apksigner verify. { ok, signers, schemes, reason? } */
export function verifyApk(file, { java = findJava(), jar = findApksignerJar() } = {}) {
  if (!jar) return { ok: false, reason: "apksigner 를 찾지 못했어요(Android SDK build-tools 를 설치하세요)." };
  if (!java) return { ok: false, reason: "apksigner 를 돌릴 Java 를 찾지 못했어요(Android Studio 또는 JDK 를 설치하거나 JAVA_HOME 을 지정하세요)." };
  const r = spawnSync(java, ["-jar", jar, "verify", "--print-certs", "-v", file], { encoding: "utf8", shell: false, timeout: 180_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const parsed = parseApksigner(out);
  if (r.status !== 0 || !/^Verifies$/m.test(out)) {
    return { ok: false, ...parsed, reason: `apksigner 서명 확인 실패: ${maskText(out.replace(/\s+/g, " ").trim()).slice(0, 300) || `종료 코드 ${r.status}`}` };
  }
  if (parsed.signers.length === 0 || !parsed.signers[0].sha256) return { ok: false, ...parsed, reason: "apksigner 결과에서 서명 인증서를 읽지 못했어요." };
  return { ok: true, ...parsed };
}

// ───────── 등록된 키의 인증서 지문 ─────────

/** key.properties 의 storeFile·keyAlias(비밀번호 줄은 읽어서 쓰지 않는다) */
function keyProps(file) {
  const out = { storeFile: null, keyAlias: null };
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(storeFile|keyAlias)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {
    /* 못 읽음 */
  }
  return out;
}

/**
 * 이 일감이 써야 하는 키의 서명 인증서 SHA-256. 모르면 sha256 null 과 이유(note).
 * - 앱 자체 key.properties 가 있으면 그 storeFile(JKS 면 비밀번호 없이 읽음)
 * - 아니면 감독 프로그램이 넘긴 키(env.FACTORY_KEYSTORE_PATH): JKS 는 비밀번호 없이, 아니면 keytool 에 비밀번호를 환경변수로
 */
export function expectedSigner({ dir, env = {}, keytool = undefined }) {
  const own = appKeyProperties(dir);
  let file;
  let alias;
  let storePass = null;
  let label;
  if (own) {
    const p = keyProps(own);
    if (!p.storeFile) return { sha256: null, label: "앱 자체 key.properties", note: "key.properties 에 storeFile 이 없어 비교하지 못했어요" };
    // Flutter 의 storeFile 은 android/app 기준 상대 경로일 때가 많다
    const cands = [path.resolve(path.dirname(own), "app", p.storeFile), path.resolve(path.dirname(own), p.storeFile), path.resolve(expandHome(p.storeFile))];
    file = cands.find((c) => fs.existsSync(c));
    alias = p.keyAlias;
    label = `앱 자체 key.properties (${p.storeFile})`;
    if (!file) return { sha256: null, label, note: "key.properties 의 키 파일을 찾지 못해 비교하지 못했어요" };
  } else {
    file = env.FACTORY_KEYSTORE_PATH;
    alias = env.FACTORY_KEY_ALIAS;
    storePass = env.FACTORY_KEYSTORE_PASSWORD || null;
    label = file ? path.basename(file) : null;
    if (!file || !fs.existsSync(file)) return { sha256: null, label, note: "등록된 키 파일을 찾지 못해 비교하지 못했어요" };
  }
  try {
    const info = jksInfo(fs.readFileSync(file));
    const a = info.aliases.find((x) => !alias || x.alias.toLowerCase() === String(alias).toLowerCase()) ?? null;
    if (a?.sha256) return { sha256: a.sha256, label };
  } catch {
    /* PKCS12 등: 아래 keytool */
  }
  if (!storePass) return { sha256: null, label, note: "키 형식(PKCS12 등) 때문에 비밀번호 없이 지문을 읽지 못해 비교하지 못했어요" };
  const kt = keytool === undefined ? findKeytool() : keytool;
  if (!kt) return { sha256: null, label, note: "keytool 이 없어 비교하지 못했어요" };
  const r = spawnSync(kt, ["-list", "-v", "-keystore", file, ...(alias ? ["-alias", alias] : []), "-storepass:env", "FACTORY_KT_STOREPASS"], {
    encoding: "utf8",
    shell: false,
    timeout: 60_000,
    windowsHide: true,
    env: { ...process.env, FACTORY_KT_STOREPASS: storePass },
  });
  const m = /SHA-?256:\s*([0-9A-F:]{64,95})/i.exec(r.stdout || "");
  return m ? { sha256: hex(m[1]), label } : { sha256: null, label, note: "keytool 로 지문을 읽지 못해 비교하지 못했어요" };
}

/**
 * 서명 검사 결과 판정. 디버그 키·다른 키면 실패. 비교할 지문을 모르면 통과하되 note 를 남긴다.
 * 돌려주는 값: { ok, reason?, note?, signerSha256 }
 */
export function judgeSignature(verify, expected) {
  if (!verify.ok) return { ok: false, reason: verify.reason };
  const s = verify.signers[0];
  if (verify.signers.length !== 1) return { ok: false, reason: `서명자가 ${verify.signers.length}명이에요(하나여야 해요).` };
  if (isDebugCert(s.dn)) return { ok: false, reason: "디버그 키로 서명된 APK 예요. 등록된 업로드 키로 서명해야 해요(android/app/build.gradle 의 signingConfigs.release 확인)." };
  if (expected.sha256 && expected.sha256 !== s.sha256) {
    return { ok: false, reason: `등록된 키(${expected.label ?? "?"})와 다른 키로 서명됐어요(APK ${s.sha256.slice(0, 12)}… / 키 ${expected.sha256.slice(0, 12)}…).` };
  }
  return { ok: true, signerSha256: s.sha256, note: expected.sha256 ? null : expected.note };
}

// ───────── git ─────────

export function gitCommitOf(dir) {
  const r = spawnSync("git", ["rev-parse", "--short=10", "HEAD"], { cwd: dir, encoding: "utf8", shell: false, windowsHide: true });
  if (r.status !== 0) return null;
  const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: dir, encoding: "utf8", shell: false, windowsHide: true });
  return `${r.stdout.trim()}${dirty.status === 0 && dirty.stdout.trim() ? "+dirty" : ""}`;
}

// ───────── 올리기 ─────────

/**
 * /api/factory/test-apk 로 올린다: 정보 먼저(POST) → 8MB 조각(PUT, 조각마다 3번까지 다시). 돌려주는 값: { ok, message }
 * api(method, path, body) 는 감독 프로그램의 홈페이지 호출(Buffer 본문은 그대로 보낸다).
 */
export async function uploadTestApk({ file, meta, api, log }) {
  const start = await api("POST", "/api/factory/test-apk", meta);
  if (start.status !== 200 || !start.data?.apkId) return { ok: false, message: `APK 올리기 시작 거절(${start.status}): ${start.data?.message ?? ""}` };
  const { apkId } = start.data;
  const chunk = Number(start.data.chunkSize) || APK_CHUNK;
  const count = Math.ceil(meta.size / chunk);
  const fd = fs.openSync(file, "r");
  try {
    for (let idx = 0; idx < count; idx++) {
      const len = Math.min(chunk, meta.size - idx * chunk);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, idx * chunk);
      let r = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          r = await api("PUT", `/api/factory/test-apk?apkId=${encodeURIComponent(apkId)}&idx=${idx}`, buf);
        } catch (e) {
          r = { status: 0, data: { message: e.message } };
        }
        if (r.status === 200 || (r.status >= 400 && r.status < 500 && r.status !== 429)) break;
        await new Promise((ok) => setTimeout(ok, 2000 * attempt));
      }
      if (r.status !== 200) return { ok: false, message: `APK 조각 ${idx + 1}/${count} 올리기 거절(${r.status}): ${r.data?.message ?? ""}` };
      if (idx === count - 1 && r.data?.complete !== true) return { ok: false, message: `홈페이지가 APK 를 다 받지 못했어요: ${r.data?.message ?? ""}` };
      if (count > 2 && (idx + 1) % 5 === 0) log?.(`APK 올리는 중 ${idx + 1}/${count}`);
    }
  } finally {
    fs.closeSync(fd);
  }
  return { ok: true, message: `APK 를 올렸어요(${count}조각, 홈페이지가 SHA-256 확인).` };
}
