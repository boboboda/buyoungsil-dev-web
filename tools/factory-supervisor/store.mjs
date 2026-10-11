// 앱 공장 감독 프로그램: 출시 2단계(스토어 자료·Play 업로드)
// - 스토어 자료 기준 폴더: 앱 폴더 .factory/store/ (icon-512.png, feature-1024x500.png, screenshots/phone-01..08.png|jpg, promo.mp4, listing.json, status.json)
//   Claude 가 만든 파일을 여기서 검사한다(크기·비율·알파·글자 수). 영상은 길이를 읽고, 검토 단계가 있으면 검토용 사본만 올린다.
// - 홈페이지로는 고정 이미지 칸(아이콘, 대표 이미지, 폰 스크린샷 png/jpg)만 /api/factory/store-image 로, 검토용 영상은 /api/factory/store-video 로
//   (둘 다 홈페이지가 업로드 서버 /upload/single 에 전달), 검사 결과는 /api/factory/store-assets 로 보낸다.
// - Play Developer API(androidpublisher v3): 서비스 계정 키(JSON, PC 경로)로 토큰을 받아
//   스토어 자료 수정 = edits 열기 → 등록정보(제목·짧은/긴 설명·영상 URL) → 이미지 종류별 통째 교체(deleteall → upload) → 커밋,
//   첫 출시(최초 업로드 뒤) = 업데이트 AAB 를 비공개 테스트 트랙(alpha)에 올림. 프로덕션 트랙은 건드리지 않는다.
//   커밋은 changesInReviewBehavior=ERROR_IF_IN_REVIEW(이미 검토 중인 변경을 취소하지 않음).
//   서비스 계정 키 내용·토큰은 로그·보고 어디에도 쓰지 않는다.
import { spawnSync } from "node:child_process";
import { createSign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const IS_WIN = process.platform === "win32";
const expandHome = (p) => (p === "~" || p.startsWith("~/") || p.startsWith("~\\") ? path.join(os.homedir(), p.slice(1)) : p);
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// 서버 lib/factory/storeAssets.ts 의 STORE_IMAGE_SLOTS 와 같다
export const STORE_SLOTS = {
  icon: { file: "icon-512.png", maxBytes: 1024 * 1024 },
  feature: { file: "feature-1024x500.png", maxBytes: 10 * 1024 * 1024 },
};
const SHOT_MAX_BYTES = 8 * 1024 * 1024;
const LISTING_LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };
const LANG_RE = /^[a-z]{2,3}(-[A-Z]{2,3})?$/;

// ───────── 파일 검사 ─────────

/** PNG/JPEG 머리만 읽어 형식·크기·알파 여부. 모르면 null */
export function imageInfo(buf) {
  if (buf.length > 26 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString("ascii", 12, 16) === "IHDR") {
    const colorType = buf[25];
    // 4: 회색+알파, 6: RGBA. 팔레트(3)는 tRNS 조각이 있으면 투명이 있다
    const alpha = colorType === 4 || colorType === 6 || (colorType === 3 && buf.includes(Buffer.from("tRNS")));
    return { type: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) return null;
      const m = buf[o + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        o += 2;
        continue;
      }
      const len = buf.readUInt16BE(o + 2);
      // SOF0~SOF15 (DHT C4, JPG C8, DAC CC 제외)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: "jpg", width: buf.readUInt16BE(o + 7), height: buf.readUInt16BE(o + 5), alpha: false };
      }
      o += 2 + len;
    }
  }
  return null;
}

/** MP4 의 moov/mvhd 에서 길이(초). 못 읽으면 null. 파일 전체를 읽지 않고 상자 머리만 따라간다 */
export function mp4Duration(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(16);
    const find = (start, end, type) => {
      let o = start;
      while (o + 8 <= end) {
        fs.readSync(fd, head, 0, 16, o);
        let len = head.readUInt32BE(0);
        const t = head.toString("ascii", 4, 8);
        let hdr = 8;
        if (len === 1) {
          len = Number(head.readBigUInt64BE(8));
          hdr = 16;
        } else if (len === 0) len = end - o;
        if (len < hdr) return null;
        if (t === type) return { start: o + hdr, end: o + len };
        o += len;
      }
      return null;
    };
    const moov = find(0, size, "moov");
    const mvhd = moov && find(moov.start, moov.end, "mvhd");
    if (!mvhd) return null;
    const b = Buffer.alloc(32);
    fs.readSync(fd, b, 0, 32, mvhd.start);
    const v1 = b[0] === 1;
    const scale = v1 ? b.readUInt32BE(20) : b.readUInt32BE(12);
    const dur = v1 ? Number(b.readBigUInt64BE(24)) : b.readUInt32BE(16);
    return scale ? Math.round((dur / scale) * 10) / 10 : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

const chars = (s) => [...String(s ?? "")].length;

/** listing.json 검사. { listing, problems[] } */
export function checkListing(v) {
  const problems = [];
  if (!v || typeof v !== "object" || Array.isArray(v)) return { listing: null, problems: ["listing.json 이 없거나 JSON 객체가 아니에요"] };
  const listing = {};
  for (const [lang, x] of Object.entries(v)) {
    if (!LANG_RE.test(lang)) {
      problems.push(`언어 코드 '${clip(lang, 20)}' 는 Play 형식(ko-KR, en-US)이 아니에요`);
      continue;
    }
    if (!x || typeof x !== "object") {
      problems.push(`${lang}: 값이 객체가 아니에요`);
      continue;
    }
    for (const [k, max] of Object.entries(LISTING_LIMITS)) {
      const n = chars(x[k]);
      if (typeof x[k] !== "string" || !x[k].trim()) problems.push(`${lang}.${k} 가 비었어요`);
      else if (n > max) problems.push(`${lang}.${k} 가 ${n}자예요(${max}자 이내)`);
    }
    listing[lang] = { title: String(x.title ?? ""), shortDescription: String(x.shortDescription ?? ""), fullDescription: String(x.fullDescription ?? "") };
  }
  if (Object.keys(listing).length === 0 && problems.length === 0) problems.push("언어가 하나도 없어요");
  return { listing: Object.keys(listing).length ? listing : null, problems };
}

function checkImage(file, { width, height, maxBytes, noAlpha, what }) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return { problem: `${what} 파일이 없어요(${path.basename(file)})` };
  }
  const info = imageInfo(buf);
  if (!info) return { problem: `${what} 이 png/jpg 가 아니에요` };
  const meta = { file, size: buf.length, width: info.width, height: info.height, type: info.type };
  if (buf.length > maxBytes) return { meta, problem: `${what} 이 ${Math.round(buf.length / 1024)}KB 예요(${Math.round(maxBytes / 1024)}KB 이하)` };
  if (width && (info.width !== width || info.height !== height)) return { meta, problem: `${what} 크기가 ${info.width}x${info.height} 예요(${width}x${height} 이어야 해요)` };
  if (noAlpha && info.alpha) return { meta, problem: `${what} 에 투명(알파) 채널이 있어요(알파 없는 PNG 나 JPG 여야 해요)` };
  return { meta };
}

function shotProblem(m) {
  const { width: w, height: h } = m;
  if (Math.min(w, h) < 320 || Math.max(w, h) > 3840) return `변 길이가 320~3840px 밖이에요(${w}x${h})`;
  const r = w / h;
  if (Math.abs(r - 9 / 16) > 0.01 && Math.abs(r - 16 / 9) > 0.03) return `비율이 9:16·16:9 가 아니에요(${w}x${h})`;
  return null;
}

/**
 * .factory/store/ 검사. 돌려주는 값:
 *   { storeDir, stages: {icon, screenshots, video, listing: {status, note}}, images: {slot: meta}, shots: [meta], video, listing, tools, failure: {stage, reason} | null }
 * 실패: 아이콘·대표 이미지 / 스크린샷(있는데 규격이 틀림) / 문구. 스크린샷이 없거나 영상이 없으면 '건너뜀'(실패 아님).
 * only: 이 일감이 거치는 단계 목록(서버가 고른 갱신 항목으로 정함). 빠진 단계는 검사하지 않고 '고르지 않음'(건너뜀)으로, 그 파일도 결과에 넣지 않는다.
 */
export function checkStoreAssets(dir, { only = null } = {}) {
  const storeDir = path.join(dir, ".factory", "store");
  const status = readJson(path.join(storeDir, "status.json")) ?? {};
  const stages = {};
  const images = {};

  const on = (k) => !Array.isArray(only) || only.includes(k);
  const off = { status: "skipped", note: "이번에 고르지 않은 항목이라 건드리지 않았어요" };

  // 아이콘·대표 이미지
  const iconProblems = [];
  const icon = checkImage(path.join(storeDir, STORE_SLOTS.icon.file), { width: 512, height: 512, maxBytes: STORE_SLOTS.icon.maxBytes, noAlpha: false, what: "아이콘" });
  const feature = checkImage(path.join(storeDir, STORE_SLOTS.feature.file), { width: 1024, height: 500, maxBytes: STORE_SLOTS.feature.maxBytes, noAlpha: true, what: "대표 이미지" });
  for (const [slot, r] of [["icon", icon], ["feature", feature]]) {
    if (r.problem) iconProblems.push(r.problem);
    else images[slot] = r.meta;
  }
  stages.icon = iconProblems.length ? { status: "failed", note: iconProblems.join(" / ") } : { status: "ok", note: "아이콘 512x512, 대표 이미지 1024x500" };
  if (!on("icon")) {
    stages.icon = off;
    delete images.icon;
    delete images.feature;
  }

  // 스크린샷
  const shotDir = path.join(storeDir, "screenshots");
  let names = [];
  try {
    names = fs.readdirSync(shotDir).filter((n) => /^phone-0[1-9]\.(png|jpe?g)$/i.test(n)).sort();
  } catch {
    names = [];
  }
  const shots = [];
  const shotProblems = [];
  for (const n of names) {
    const r = checkImage(path.join(shotDir, n), { maxBytes: SHOT_MAX_BYTES, noAlpha: true, what: `스크린샷 ${n}` });
    const p = r.problem ?? shotProblem(r.meta);
    if (p) shotProblems.push(r.problem ? p : `스크린샷 ${n}: ${p}`);
    else shots.push({ ...r.meta, name: n });
  }
  if (names.length === 0) {
    const why = clip(status.screenshots?.reason, 300) || "스크린샷 파일이 없어요(에뮬레이터를 쓰지 못한 것 같아요)";
    stages.screenshots = { status: "skipped", note: `스크린샷 단계 건너뜀 - 직접 올려야 함: ${why}` };
  } else if (shotProblems.length) stages.screenshots = { status: "failed", note: shotProblems.slice(0, 4).join(" / ") };
  else if (shots.length < 2 || shots.length > 8) stages.screenshots = { status: "failed", note: `스크린샷은 2~8장이어야 해요(지금 ${shots.length}장)` };
  else stages.screenshots = { status: "ok", note: `${shots.length}장` };
  if (!on("screenshots")) {
    stages.screenshots = off;
    shots.length = 0;
  }
  shots.forEach((m, i) => (images[`phone-0${i + 1}`] = m));

  // 영상(PC 에만)
  const videoFile = path.join(storeDir, "promo.mp4");
  let video = null;
  try {
    const st = fs.statSync(videoFile);
    if (st.isFile() && st.size > 0) video = { path: videoFile, size: st.size, durationSec: mp4Duration(videoFile) };
  } catch {
    /* 없음 */
  }
  if (video) stages.video = { status: "ok", note: video.durationSec ? `${video.durationSec}초` : "길이를 읽지 못했어요(mp4 확인 필요)" };
  else stages.video = { status: "skipped", note: `영상 단계 건너뜀: ${clip(status.video?.reason, 300) || "promo.mp4 가 없어요"}` };
  if (!on("video")) {
    stages.video = off;
    video = null;
  }

  // 문구
  const { listing, problems } = on("listing") ? checkListing(readJson(path.join(storeDir, "listing.json"))) : { listing: null, problems: [] };
  stages.listing = !on("listing")
    ? off
    : problems.length
      ? { status: "failed", note: problems.slice(0, 6).join(" / ") }
      : { status: "ok", note: Object.keys(listing).join(", ") };

  const order = ["icon", "screenshots", "video", "listing"];
  const bad = order.find((k) => stages[k].status === "failed");
  return {
    storeDir,
    stages,
    images,
    shots,
    video,
    listing,
    tools: clip(status.tools, 600) || null,
    failure: bad ? { stage: bad, reason: stages[bad].note } : null,
    imagesOff: !on("icon") && !on("screenshots"), // 이미지를 고르지 않음: 홈페이지의 기존 이미지 정보를 그대로 둔다
  };
}

// ───────── 이 PC 환경 (스토어 자료 일감의 RELEASE_REQUEST.md 에 붙인다) ─────────

function onPath(cmd) {
  const r = spawnSync(IS_WIN ? "where" : "which", [cmd], { encoding: "utf8", shell: false, timeout: 10_000, windowsHide: true });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

export function storeEnv() {
  const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, IS_WIN && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk")].find(
    (d) => d && fs.existsSync(d),
  );
  const exe = (p) => (p && fs.existsSync(p) ? p : null);
  const emulator = sdk ? exe(path.join(sdk, "emulator", IS_WIN ? "emulator.exe" : "emulator")) : null;
  const adb = sdk ? exe(path.join(sdk, "platform-tools", IS_WIN ? "adb.exe" : "adb")) : onPath("adb");
  let avds = [];
  try {
    avds = fs.readdirSync(path.join(os.homedir(), ".android", "avd")).filter((n) => n.endsWith(".ini")).map((n) => n.slice(0, -4));
  } catch {
    avds = [];
  }
  const chrome = [
    IS_WIN && path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    IS_WIN && process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.platform === "darwin" && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => p && fs.existsSync(p));
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  return {
    sdk: sdk ?? null,
    emulator,
    adb,
    avds,
    node: process.versions.node,
    nodeOkForHyperframes: nodeMajor >= 22,
    ffmpeg: onPath("ffmpeg"),
    ffprobe: onPath("ffprobe"),
    chrome: chrome ?? null,
  };
}

export function storeEnvSection(env = storeEnv()) {
  const s = (p) => (p ? `\`${String(p).replace(/\\/g, "/")}\`` : "없음");
  return `

## 이 PC 환경 (감독 프로그램이 확인함)
- Android SDK: ${s(env.sdk)} · emulator: ${s(env.emulator)} · adb: ${s(env.adb)}
- AVD: ${env.avds.length ? env.avds.join(", ") : "없음(스크린샷 단계는 건너뛰세요)"}
- Node: ${env.node}${env.nodeOkForHyperframes ? "" : " (HyperFrames 는 Node 22 이상이 필요해요. 이 PC 의 Node 로는 안 될 수 있어요)"}
- ffmpeg: ${s(env.ffmpeg)} · ffprobe: ${s(env.ffprobe)} · Chrome: ${s(env.chrome)}
- 시스템에 프로그램을 설치하지 마세요(PATH·레지스트리 변경 금지). 필요하면 앱 폴더 밖 임시 폴더에서만.
`;
}

export function envSummary(env) {
  return [
    `Node ${env.node}${env.nodeOkForHyperframes ? "" : "(HyperFrames 는 22 이상 필요)"}`,
    `ffmpeg ${env.ffmpeg ? "있음" : "없음"}`,
    `Chrome ${env.chrome ? "있음" : "없음"}`,
    `에뮬레이터 ${env.emulator ? "있음" : "없음"}, AVD ${env.avds.length}개`,
  ].join(", ");
}

// ───────── 홈페이지로 보내기 ─────────

const MIME = { png: "image/png", jpg: "image/jpeg" };

/** 이미지 한 장을 multipart(file + 그 밖의 칸)로 올린다. 스토어 이미지와 업로드 시험이 같이 쓴다. 돌려주는 값: api 결과 */
export async function postImageFile({ api, pathname, fields = {}, file, type, name }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", new Blob([fs.readFileSync(file)], { type: MIME[type] ?? type }), name);
  return api("POST", pathname, form);
}

/** 검사를 통과한 이미지만 고정 칸으로 올린다. 돌려주는 값: 실패 메시지 목록 */
export async function sendStoreImages({ check, job, api, addLog }) {
  const failures = [];
  for (const [slot, m] of Object.entries(check.images)) {
    try {
      const r = await postImageFile({ api, pathname: "/api/factory/store-image", fields: { jobId: job.id, slot }, file: m.file, type: m.type, name: `${slot}.${m.type}` });
      if (r.status === 200) addLog("info", `스토어 이미지 올림: ${slot}`);
      else failures.push(`${slot} 거절(${r.status}): ${r.data?.message ?? ""}`);
    } catch (e) {
      failures.push(`${slot} 오류: ${e.message}`);
    }
  }
  return failures;
}

export function storeReport(check) {
  const meta = (m) => ({ width: m.width, height: m.height, size: m.size });
  return {
    dir: check.storeDir,
    stages: check.stages,
    ...(check.imagesOff ? {} : { images: Object.fromEntries(Object.entries(check.images).map(([k, m]) => [k, meta(m)])) }),
    video: check.video,
    listing: check.listing,
    tools: check.tools,
  };
}

// ───────── 검토용 홍보 영상 (통제실에서 재생) ─────────

// 서버 app/api/factory/store-video 의 MAX_VIDEO 와 같다(업로드 서버로 전달)
export const STORE_VIDEO_MAX = 120 * 1024 * 1024;
// 예전 방식(홈페이지 DB 에 8MB 조각, /api/factory/review-video): 홈페이지가 아직 store-video 를 모를 때만
export const REVIEW_VIDEO_MAX = 50 * 1024 * 1024;
const REVIEW_CHUNK = 8 * 1024 * 1024;
const MB = (n) => Math.round((n / 1024 / 1024) * 10) / 10;

/**
 * limit 이 넘으면 ffmpeg 로 줄인 사본(.factory/store/review-preview.mp4)을 만든다. 원본 promo.mp4 는 건드리지 않는다.
 * 돌려주는 값: { file, size } 또는 { note }(못 줄임)
 */
function fitVideo(src, limit, log) {
  const size = fs.statSync(src).size;
  if (size <= limit) return { file: src, size };
  const out = path.join(path.dirname(src), "review-preview.mp4");
  if (fs.existsSync(out)) {
    const s = fs.statSync(out);
    if (s.mtimeMs >= fs.statSync(src).mtimeMs && s.size > 0 && s.size <= limit) return { file: out, size: s.size };
  }
  const ffmpeg = onPath("ffmpeg");
  if (!ffmpeg) return { note: `영상이 ${MB(size)}MB 라 너무 커요(${MB(limit)}MB 이하만). ffmpeg 가 없어 줄이지 못했어요. 너무 커서 PC 에서 직접 확인: ${src}` };
  log?.(`검토 영상이 ${MB(size)}MB 라 ffmpeg 로 줄여요`);
  const r = spawnSync(ffmpeg, ["-y", "-i", src, "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out], {
    encoding: "utf8",
    shell: false,
    timeout: 10 * 60_000,
    windowsHide: true,
  });
  if (r.status !== 0 || !fs.existsSync(out)) return { note: `영상을 줄이지 못했어요(ffmpeg). PC 에서 직접 확인: ${src}` };
  const small = fs.statSync(out).size;
  if (small > limit) return { note: `줄여도 ${MB(small)}MB 라 너무 커요. PC 에서 직접 확인: ${src}` };
  return { file: out, size: small };
}

/** mp4 파일을 원본 바이트로 흘려 보낸다(Content-Length 포함, 15분). 검토 영상과 업로드 시험이 같이 쓴다. 돌려주는 값: api 결과 */
export function postVideoFile({ api, pathname, file, size }) {
  return api("POST", pathname, { streamFile: file, size, type: "video/mp4" }, { timeoutMs: 15 * 60_000 });
}

/** mp4 인지(4~8바이트 'ftyp'). 서버도 같은 검사를 한다 */
function isMp4(file) {
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(12);
    return fs.readSync(fd, b, 0, 12, 0) === 12 && b.toString("latin1", 4, 8) === "ftyp";
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 검토용 영상을 올린다: 홈페이지 /api/factory/store-video 가 업로드 서버(이미지와 같은 곳)에 전달하고 주소를 저장한다(120MB 이하,
 * 넘으면 ffmpeg 로 줄인 사본). 홈페이지가 아직 예전 버전이라 store-video 가 없으면 예전 방식(DB 조각, 50MB 이하)으로 올린다.
 * 못 올리면 'PC 에서 직접 확인' 안내를 돌려준다. 돌려주는 값: { ok, note }
 */
export async function uploadReviewVideo({ video, job, api, log }) {
  if (!video?.path) return { ok: false, note: "영상 없음(영상 단계 건너뜀)" };
  if (!isMp4(video.path)) return { ok: false, note: `mp4 형식이 아니라 올리지 않았어요. PC 에서 직접 확인: ${video.path}` };
  const fit = fitVideo(video.path, STORE_VIDEO_MAX, log);
  if (fit.note) return { ok: false, note: fit.note };
  let r;
  try {
    r = await postVideoFile({ api, pathname: `/api/factory/store-video?jobId=${encodeURIComponent(job.id)}`, file: fit.file, size: fit.size });
  } catch (e) {
    return { ok: false, note: `검토 영상 올리기 오류: ${e.message}. PC 에서 직접 확인: ${video.path}` };
  }
  const shrunk = fit.file !== video.path ? ", 줄인 사본" : "";
  if (r.status === 200) return { ok: true, note: `검토 영상을 업로드 서버에 올렸어요(${MB(fit.size)}MB${shrunk}). 통제실에서 재생할 수 있어요(업로드 서버에 남아요).` };
  // 홈페이지 응답이 아닌 404·413(라우트 없음·프록시 용량 제한): 예전 방식으로
  if (!((r.status === 404 || r.status === 413) && !r.data?.message)) {
    return { ok: false, note: `검토 영상 올리기 거절(${r.status}): ${r.data?.message ?? ""}. PC 에서 직접 확인: ${video.path}` };
  }
  log?.(`홈페이지가 store-video 를 받지 못해(${r.status}) 예전 방식(조각)으로 올려요`);
  return uploadReviewVideoChunks({ video, job, api, log });
}

// 예전 방식: 홈페이지 DB 에 8MB 조각으로(관리자만 재생, 결정 뒤·7일 뒤 삭제)
async function uploadReviewVideoChunks({ video, job, api, log }) {
  const fit = fitVideo(video.path, REVIEW_VIDEO_MAX, log);
  if (fit.note) return { ok: false, note: fit.note };
  const { file, size } = fit;
  const count = Math.ceil(size / REVIEW_CHUNK);
  const fd = fs.openSync(file, "r");
  try {
    for (let idx = 0; idx < count; idx++) {
      const len = Math.min(REVIEW_CHUNK, size - idx * REVIEW_CHUNK);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, idx * REVIEW_CHUNK);
      const r = await api("PUT", `/api/factory/review-video?jobId=${encodeURIComponent(job.id)}&idx=${idx}&count=${count}&size=${size}`, buf);
      if (r.status !== 200) return { ok: false, note: `검토 영상 올리기 거절(${r.status}): ${r.data?.message ?? ""}. PC 에서 직접 확인: ${video.path}` };
    }
  } finally {
    fs.closeSync(fd);
  }
  return { ok: true, note: `검토 영상을 올렸어요(${MB(size)}MB${file !== video.path ? ", 줄인 사본" : ""}). 통제실에서 재생할 수 있어요(결정 뒤·7일 뒤 지워져요).` };
}

// ───────── Play Developer API ─────────

const API = () => (process.env.FACTORY_PLAY_API_BASE || "https://androidpublisher.googleapis.com").replace(/\/+$/, "");
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export class PlayError extends Error {
  constructor(message, { status = 0, raw = "" } = {}) {
    super(message);
    this.status = status;
    this.raw = raw;
  }
}

/** 구글 오류를 사람이 할 일이 보이는 한국어로. raw 는 원문(짧게) */
export function playErrorText(status, raw, { packageName, track } = {}) {
  const t = String(raw ?? "");
  const vc = /version code (\d+)/i.exec(t)?.[1];
  if (/already been used|version code .* (?:has been )?used|APK_UPGRADE_VERSION_CONFLICT|apkUpgradeVersionConflict/i.test(t)) {
    return `버전 코드${vc ? ` ${vc}` : ""}가 이미 Play 에 올라간 번호예요. 앱의 버전 코드(pubspec version 의 + 뒤 숫자 / versionCode)를 올려 다시 빌드하세요.`;
  }
  if (/signed with the wrong key|wrong key|different (?:upload )?key|certificate.*(?:mismatch|does not match)/i.test(t)) {
    return "AAB 서명 키가 Play 에 등록된 업로드 키와 달라요. 처음 올린 AAB 와 같은 업로드 키로 서명해야 해요.";
  }
  if (/only releases with status draft/i.test(t)) return "아직 한 번도 출시되지 않은(초안) 앱이라 초안 상태로만 올릴 수 있어요.";
  if (/CHANGES_ALREADY_IN_REVIEW|already have changes in review/i.test(t)) {
    return "Play 에 이미 검토 중인 변경이 있어서 올리지 않았어요(진행 중인 검토를 취소하지 않음). 검토가 끝난 뒤 재시도하세요.";
  }
  if (/has not been used in project|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(t)) {
    return "서비스 계정의 Google Cloud 프로젝트에서 'Google Play Android Developer API' 가 꺼져 있어요. Cloud Console 에서 켜고 몇 분 뒤 재시도하세요.";
  }
  if (/invalid_grant|invalid_client|Invalid JWT|account not found/i.test(t)) return "서비스 계정 키가 잘못됐거나 폐기됐어요. Cloud Console 에서 새 JSON 키를 받아 같은 경로에 두세요.";
  if (/Package not found|applicationNotFound|No application was found/i.test(t) || (status === 404 && /applications\//.test(t))) {
    return `Play Console 에서 패키지 '${packageName ?? "?"}' 앱을 찾지 못했어요. 패키지 이름과, 서비스 계정이 이 앱 권한을 받았는지 확인하세요.`;
  }
  if (/track.*not found|Track not found|trackNotFound/i.test(t)) return `Play Console 에 '${track ?? "?"}' 트랙이 없어요. 비공개 테스트(Closed testing) 트랙을 먼저 만드세요.`;
  if (status === 401 || status === 403 || /permission|forbidden|does not have permission|PERMISSION_DENIED/i.test(t)) {
    return "서비스 계정에 이 앱 권한이 없어요. Play Console > 사용자 및 권한에서 서비스 계정 이메일을 초대하고 이 앱의 출시·스토어 등록정보 권한을 주세요.";
  }
  if (/image/i.test(t) && /(dimension|size|aspect|invalid|too (?:large|small))/i.test(t)) return `Play 가 이미지를 거절했어요(크기·비율·형식): ${clip(t, 200)}`;
  return `Play API 오류${status ? `(${status})` : ""}: ${clip(t, 300) || "응답 없음"}`;
}

/** 서비스 계정 JSON 을 읽어 접근 토큰을 받는다. 키 내용은 밖으로 내보내지 않는다 */
export async function playToken(keyPath) {
  const file = path.resolve(expandHome(String(keyPath ?? "")));
  let sa;
  try {
    sa = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new PlayError(`서비스 계정 키 파일을 읽지 못했어요(${keyPath}). 경로와 JSON 형식을 확인하세요.`);
  }
  if (!sa?.client_email || !sa?.private_key) throw new PlayError("서비스 계정 키 JSON 에 client_email·private_key 가 없어요(서비스 계정 '키' 파일이 맞는지 확인).");
  const tokenUri = typeof sa.token_uri === "string" && /^https?:\/\//.test(sa.token_uri) ? sa.token_uri : "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }))}`;
  let sig;
  try {
    sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
  } catch {
    throw new PlayError("서비스 계정 키의 private_key 로 서명하지 못했어요(키 파일이 손상됐을 수 있어요).");
  }
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) throw new PlayError(playErrorText(res.status, `${data?.error ?? ""} ${data?.error_description ?? ""}`), { status: res.status });
  return { token: data.access_token, email: sa.client_email };
}

function client(token, packageName, ctx) {
  const base = `${API()}/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;
  const upBase = `${API()}/upload/androidpublisher/v3/applications/${encodeURIComponent(packageName)}`;
  const call = async (method, url, { json, body, type, timeout = 120_000, ok404 = false } = {}) => {
    const headers = { Authorization: `Bearer ${token}` };
    if (json !== undefined) headers["Content-Type"] = "application/json";
    else if (type) headers["Content-Type"] = type;
    const res = await fetch(url, { method, headers, body: json !== undefined ? JSON.stringify(json) : body, signal: AbortSignal.timeout(timeout) });
    const text = await res.text();
    if (ok404 && res.status === 404) return null;
    if (!res.ok) {
      let msg = text;
      try {
        const e = JSON.parse(text)?.error;
        msg = [e?.message, e?.status, ...(e?.errors ?? []).map((x) => x.reason), ...(e?.details ?? []).map((d) => d.reason)].filter(Boolean).join(" ");
      } catch {
        /* 원문 */
      }
      throw new PlayError(playErrorText(res.status, msg, ctx), { status: res.status, raw: clip(msg, 300) });
    }
    return text ? JSON.parse(text) : {};
  };
  return { base, upBase, call };
}

// 커밋: 검토 중인 변경은 취소하지 않는다. "자동으로 검토에 보낼 수 없음" 이면 changesNotSentForReview=true 로 한 번 더(사람이 Console 에서 검토 보내기)
async function commitEdit(c, editId) {
  const url = (extra) => `${c.base}/edits/${editId}:commit?changesInReviewBehavior=ERROR_IF_IN_REVIEW${extra}`;
  try {
    await c.call("POST", url(""));
    return { changesNotSentForReview: false };
  } catch (e) {
    if (!/changesNotSentForReview/i.test(`${e.raw} ${e.message}`)) throw e;
    await c.call("POST", url("&changesNotSentForReview=true"));
    return { changesNotSentForReview: true };
  }
}

async function withEdit(c, fn) {
  const edit = await c.call("POST", `${c.base}/edits`, { json: {} });
  const editId = edit.id;
  try {
    const out = await fn(editId);
    const commit = await commitEdit(c, editId);
    return { editId, ...out, ...commit };
  } catch (e) {
    await c.call("DELETE", `${c.base}/edits/${editId}`).catch(() => {}); // 열어 둔 수정은 버린다
    throw e;
  }
}

/**
 * 스토어 자료 업로드. 등록정보는 언어마다 기존 값을 읽어 제목·설명·(링크가 있으면)영상만 바꾼다.
 * 이미지는 종류별로 통째 교체(deleteall → upload): 아이콘, 대표 이미지, 폰 스크린샷(검사를 통과해 2장 이상일 때만. 아니면 기존 그대로).
 * items(고른 갱신 항목, null 이면 예전 일감 = 전부): listing 이 없으면 제목·설명은 그대로, video 가 없으면 영상은 그대로,
 * images 가 없으면 이미지는 그대로. 문구를 안 고르면 Play 에 이미 있는 언어마다 고른 것(영상·이미지)만 바꾼다.
 */
export async function playUploadStore({ play, check, log, items = null }) {
  const ctx = { packageName: play.packageName };
  const want = (k) => !Array.isArray(items) || items.includes(k);
  const doListing = want("listing");
  const doVideo = want("video") && !!play.videoUrl;
  const { token } = await playToken(play.serviceAccountKeyPath);
  const c = client(token, play.packageName, ctx);
  let langs = doListing ? Object.keys(check.listing ?? {}) : null;
  const types = [
    ["icon", check.images.icon ? [check.images.icon] : []],
    ["featureGraphic", check.images.feature ? [check.images.feature] : []],
    ["phoneScreenshots", check.stages.screenshots?.status === "ok" ? check.shots : []],
  ].filter(([, files]) => want("images") && files.length);
  return withEdit(c, async (editId) => {
    if (!langs) {
      // 문구를 고르지 않았으면 Play 에 이미 있는 언어만(제목·설명은 그대로)
      const all = await c.call("GET", `${c.base}/edits/${editId}/listings`);
      langs = (Array.isArray(all?.listings) ? all.listings : []).map((l) => l.language).filter((l) => typeof l === "string" && LANG_RE.test(l));
    }
    for (const lang of langs) {
      const url = `${c.base}/edits/${editId}/listings/${encodeURIComponent(lang)}`;
      if (doListing) {
        const l = check.listing[lang];
        const cur = (await c.call("GET", url, { ok404: true })) ?? {};
        const video = (want("video") ? play.videoUrl : null) || cur.video || undefined;
        await c.call("PUT", url, { json: { language: lang, title: l.title, shortDescription: l.shortDescription, fullDescription: l.fullDescription, ...(video ? { video } : {}) } });
      } else if (doVideo) {
        await c.call("PATCH", url, { json: { language: lang, video: play.videoUrl } }); // 영상 링크만
      }
      for (const [type, files] of types) {
        await c.call("DELETE", `${url}/${type}`);
        for (const f of files) {
          await c.call("POST", `${c.upBase}/edits/${editId}/listings/${encodeURIComponent(lang)}/${type}?uploadType=media`, {
            body: fs.readFileSync(f.file),
            type: MIME[f.type],
          });
        }
      }
      const what = [doListing ? "문구" : "", doVideo ? "영상 링크" : "", types.length ? `이미지 ${types.map(([t]) => t).join("·")} 교체` : ""].filter(Boolean);
      log?.(`Play 등록정보 ${lang}: ${what.join(", ") || "바꿀 것 없음"}`);
    }
    return { langs, imageTypes: types.map(([t]) => t), video: doVideo, listing: doListing };
  });
}

/**
 * 업데이트 AAB → 비공개 테스트 트랙. 초안 앱이면 초안(draft)으로 한 번 더.
 * releaseNotes: { "ko-KR": "출시 노트" } (앱 업데이트의 What's new, 언어별 500자 이내. 없으면 넣지 않음)
 */
export async function playUploadAab({ play, aabPath, log, releaseNotes = null }) {
  const ctx = { packageName: play.packageName, track: play.track };
  const { token } = await playToken(play.serviceAccountKeyPath);
  const c = client(token, play.packageName, ctx);
  return withEdit(c, async (editId) => {
    const b = await c.call("POST", `${c.upBase}/edits/${editId}/bundles?uploadType=media`, {
      body: fs.readFileSync(aabPath),
      type: "application/octet-stream",
      timeout: 15 * 60_000,
    });
    const versionCode = b.versionCode;
    log?.(`AAB 올림(버전 코드 ${versionCode}) → ${play.track} 트랙에 출시 등록`);
    const notes = Object.entries(releaseNotes && typeof releaseNotes === "object" ? releaseNotes : {})
      .filter(([lang, text]) => LANG_RE.test(lang) && typeof text === "string" && text.trim())
      .map(([language, text]) => ({ language, text: [...text.trim()].slice(0, 500).join("") }));
    const put = (status) =>
      c.call("PUT", `${c.base}/edits/${editId}/tracks/${encodeURIComponent(play.track)}`, {
        json: { track: play.track, releases: [{ versionCodes: [String(versionCode)], status, ...(notes.length ? { releaseNotes: notes } : {}) }] },
      });
    let status = "completed";
    try {
      await put(status);
    } catch (e) {
      if (!/only releases with status draft/i.test(`${e.raw} ${e.message}`)) throw e;
      status = "draft";
      await put(status);
    }
    return { versionCode, status };
  });
}
