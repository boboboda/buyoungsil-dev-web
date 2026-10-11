// 앱 공장 감독 프로그램: 통제실 '업로드 시험'(/next 의 uploadTest: { id, kind })
// 운영과 같은 경로·같은 함수(store.mjs 의 postVideoFile·postImageFile)로 시험 파일을 홈페이지 /api/factory/upload-test 에 올리고,
// 홈페이지가 업로드 서버 /upload/single 로 전달한 결과(공개 주소·HTTP 상태)를 /api/factory/upload-test-report 로 보낸다.
// - video: ffmpeg 가 있으면 2초짜리 진짜 영상(색 막대 + '업로드 시험' 글자), 없으면 mp4 머리(ftyp)만 맞는 약 1MB 합성 파일(재생 안 됨)
// - image: 64x64 PNG 한 장
// - big: 10MB → 50MB → 120MB 합성 mp4 를 차례로, 처음 실패한 크기에서 멈춤
// 시험 파일은 PC 의 임시 폴더에 만들고 끝나면 지운다. 업로드 서버에는 남는다(삭제 API 없음).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { postImageFile, postVideoFile } from "./store.mjs";

const MB = 1024 * 1024;
const BIG_SIZES = [10, 50, 120];

function onPath(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8", shell: false, timeout: 10_000, windowsHide: true });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

// mp4 머리(ftyp) + 'free' 상자 채움. 재생은 안 되지만 서버의 mp4 검사(ftyp)는 통과한다
export function writeSyntheticMp4(file, size) {
  const ftyp = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);
  const freeHead = Buffer.alloc(8);
  freeHead.writeUInt32BE(size - ftyp.length, 0);
  freeHead.write("free", 4, "latin1");
  const fd = fs.openSync(file, "w");
  try {
    fs.writeSync(fd, ftyp);
    fs.writeSync(fd, freeHead);
    const zero = Buffer.alloc(4 * MB);
    let left = size - ftyp.length - freeHead.length;
    while (left > 0) {
      const n = Math.min(left, zero.length);
      fs.writeSync(fd, zero, 0, n);
      left -= n;
    }
  } finally {
    fs.closeSync(fd);
  }
}

// 64x64 RGB PNG(가로 그라데이션)
export function writeTestPng(file) {
  const w = 64;
  const h = 64;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = x * 4;
      raw[o + 1] = 120;
      raw[o + 2] = 255 - y * 4;
    }
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

// ffmpeg 로 2초짜리 시험 영상. 글자는 한글 글꼴이 있으면 '업로드 시험', 없으면 'UPLOAD TEST', 글자 넣기가 안 되면 색 막대만. 실패하면 null
function makeRealVideo(file) {
  const ffmpeg = onPath("ffmpeg");
  if (!ffmpeg) return null;
  const font = ["C:/Windows/Fonts/malgun.ttf", "/System/Library/Fonts/AppleSDGothicNeo.ttc", "/usr/share/fonts/truetype/nanum/NanumGothic.ttf"].find((f) => fs.existsSync(f));
  const text = font
    ? `drawtext=fontfile='${font.replace(/:/g, "\\:")}':text='업로드 시험':fontcolor=white:fontsize=40:box=1:boxcolor=black@0.5:x=(w-tw)/2:y=h-70`
    : "drawtext=text='UPLOAD TEST':fontcolor=white:fontsize=40:box=1:boxcolor=black@0.5:x=(w-tw)/2:y=h-70";
  const base = ["-y", "-f", "lavfi", "-i", "smptebars=size=640x360:rate=25", "-t", "2"];
  const tail = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file];
  for (const vf of [["-vf", text], []]) {
    const r = spawnSync(ffmpeg, [...base, ...vf, ...tail], { encoding: "utf8", shell: false, timeout: 60_000, windowsHide: true });
    if (r.status === 0 && fs.existsSync(file) && fs.statSync(file).size > 0) return { withText: vf.length > 0 };
  }
  return null;
}

// 응답을 단계 결과로. 실패 구간: 홈페이지가 stage 를 주면 그것, 아니면(nginx 등 홈페이지 앞에서 거절·연결 실패) pc
function stepOf(label, bytes, started, r, err) {
  const ms = Date.now() - started;
  if (err) return { label, bytes, ms, status: 0, ok: false, url: null, message: `PC → 홈페이지 연결 실패: ${err.message}`, stage: "pc", upstreamStatus: null };
  const d = r.data && typeof r.data === "object" ? r.data : null;
  if (r.status === 200 && typeof d?.url === "string") return { label, bytes, ms, status: 200, ok: true, url: d.url, message: null, stage: null, upstreamStatus: d.upstreamStatus ?? null };
  const stage = d?.stage === "receive" || d?.stage === "upstream" ? d.stage : "pc";
  const message =
    typeof d?.message === "string"
      ? d.message
      : r.status === 413
        ? "PC → 홈페이지 구간에서 413: 홈페이지 앞 nginx 의 크기 제한(client_max_body_size)이에요"
        : `PC → 홈페이지 구간에서 HTTP ${r.status}(홈페이지가 아닌 곳의 응답: nginx 등)`;
  return { label, bytes, ms, status: r.status, ok: false, url: null, message, stage, upstreamStatus: d?.upstreamStatus ?? null };
}

let busy = false;

/** 던지지 않는다 */
export async function runUploadTest({ test, api, log }) {
  if (busy || !test || typeof test.id !== "string" || !["video", "image", "big"].includes(test.kind)) return;
  busy = true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-upload-test-"));
  const steps = [];
  let synthetic = false;
  let note = null;
  const q = (kind) => `/api/factory/upload-test?id=${encodeURIComponent(test.id)}&kind=${kind}`;
  try {
    log(`업로드 시험 시작: ${test.kind}`);
    if (test.kind === "image") {
      const file = path.join(dir, "upload-test.png");
      writeTestPng(file);
      const t0 = Date.now();
      try {
        steps.push(stepOf("시험 이미지 64x64 PNG", fs.statSync(file).size, t0, await postImageFile({ api, pathname: q("image"), file, type: "png", name: "upload-test.png" })));
      } catch (e) {
        steps.push(stepOf("시험 이미지 64x64 PNG", fs.statSync(file).size, t0, null, e));
      }
    } else if (test.kind === "video") {
      const file = path.join(dir, "upload-test.mp4");
      const real = makeRealVideo(file);
      if (!real) {
        writeSyntheticMp4(file, 1 * MB);
        synthetic = true;
        note = "ffmpeg 가 없어 합성 파일로 시험했어요. 합성 파일이라 재생은 안 돼요(ffmpeg 설치 후 진짜 영상 시험).";
      } else if (!real.withText) note = "ffmpeg 글자 넣기가 안 돼 색 막대만 있는 영상이에요.";
      const size = fs.statSync(file).size;
      const label = synthetic ? "합성 mp4 1MB" : "시험 영상 2초";
      const t0 = Date.now();
      try {
        steps.push(stepOf(label, size, t0, await postVideoFile({ api, pathname: q("video"), file, size })));
      } catch (e) {
        steps.push(stepOf(label, size, t0, null, e));
      }
    } else {
      synthetic = true;
      for (const n of BIG_SIZES) {
        const file = path.join(dir, `upload-test-${n}mb.mp4`);
        writeSyntheticMp4(file, n * MB);
        const t0 = Date.now();
        let step;
        try {
          step = stepOf(`${n}MB`, n * MB, t0, await postVideoFile({ api, pathname: q("video"), file, size: n * MB }));
        } catch (e) {
          step = stepOf(`${n}MB`, n * MB, t0, null, e);
        }
        fs.rmSync(file, { force: true });
        steps.push(step);
        log(`업로드 시험 ${n}MB: ${step.ok ? "통과" : `실패(${step.status})`}`);
        if (!step.ok) break;
      }
      const passed = steps.filter((s) => s.ok).map((s) => s.label);
      const bad = steps.find((s) => !s.ok);
      note = bad ? `${passed.length ? `${passed.at(-1)} 까지 통과, ` : ""}${bad.label} 에서 ${bad.status || "연결 실패"}` : `${passed.at(-1)} 까지 모두 통과`;
    }
  } catch (e) {
    note = `시험 파일을 만들지 못했어요: ${e.message}`;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  try {
    const r = await api("POST", "/api/factory/upload-test-report", { id: test.id, synthetic, note, steps });
    log(r.status === 200 ? `업로드 시험 결과를 보냈어요(${test.kind})` : `업로드 시험 결과 보내기 거절(${r.status})`);
  } catch (e) {
    log(`업로드 시험 결과 보내기 오류: ${e.message}`);
  } finally {
    busy = false;
  }
}
