// 도구 중계 결과 이미지 올리기 (감독 프로그램 안에서만 돈다)
// 중계 도구가 만든 .factory/assets/ 의 이미지를 기존 스크린샷 주소(/api/factory/screenshot)로 올려 통제실 일감 이미지로 보이게 한다.
// - label 은 asset-<파일 이름>. 같은 label 이면 서버가 주소만 바꾼다(기존 동작).
// - 정리본만: 이름이 -raw.<확장자> 로 끝나는 원본은 건너뛴다.
// - 한도·서버 오류·409 는 로그만 남기고 일감을 실패시키지 않는다. 로그에는 파일 이름과 결과만.
import fs from "node:fs";
import path from "node:path";

export const ASSET_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
export const ASSET_MAX_BYTES = 10 * 1024 * 1024;
const MAX_DEPTH = 4;
const MAX_FILES = 200;
const MAX_TRIES = 3;

/** 파일 이름 → 서버 label(LABEL_RE: 영문·숫자·_- 40자) */
export function assetLabel(name) {
  const base = path.basename(name, path.extname(name)).replace(/[^A-Za-z0-9_-]/g, "_");
  return `asset-${base}`.slice(0, 40).replace(/-+$/, "") || "asset";
}

const isRaw = (name) => /-raw\.[A-Za-z0-9]+$/i.test(name);

/** .factory/assets 아래 이미지 파일 목록: [{ rel, full, name, ext, size, mtimeMs, key }]. 심볼릭 링크·하위 4단계 넘는 곳은 보지 않는다 */
export function listAssetImages(appDir) {
  const root = path.join(appDir, ".factory", "assets");
  const out = [];
  const walk = (d, depth) => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let entries;
    try {
      if (fs.lstatSync(d).isSymbolicLink()) return;
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) return;
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!ASSET_MIME[ext]) continue;
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        const rel = path.relative(appDir, full).split(path.sep).join("/");
        out.push({ rel, full, name: e.name, ext, size: st.size, mtimeMs: st.mtimeMs, key: `${rel}:${st.mtimeMs}` });
      }
    }
  };
  walk(root, 0);
  return out;
}

/** 올릴 대상 고르기: 이미지 확장자, 0바이트 초과 10MB 이하, -raw 제외, 이미 처리한 것(경로+수정시각) 제외 */
export function pickAssetUploads(files, done = new Set()) {
  const pick = [];
  const skipped = [];
  for (const f of files) {
    if (done.has(f.key)) continue;
    if (isRaw(f.name)) skipped.push({ ...f, why: "raw" });
    else if (f.size === 0) skipped.push({ ...f, why: "empty" });
    else if (f.size > ASSET_MAX_BYTES) skipped.push({ ...f, why: "too-big" });
    else pick.push(f);
  }
  return { pick, skipped };
}

/**
 * 일감 하나의 결과 이미지 업로더.
 * opts: { appDir, jobId, post(form) → { status, data }, log(level, message) }
 * - seed(): 일감 시작 때 이미 있던 파일(이전 일감 것)은 올리지 않게 기억한다.
 * - upload(): 새 파일을 올린다. 동시에 두 번 돌지 않는다(돌고 있으면 끝난 뒤 한 번 더).
 */
export function createAssetUploader({ appDir, jobId, post, log = () => {} }) {
  const done = new Set(); // 처리 끝(올림·포기·건너뜀)한 경로+수정시각
  const tries = new Map();
  let stopped = false; // 한도·409 뒤에는 이 일감에서 더 올리지 않는다
  let running = null;
  let again = false;
  let uploaded = 0;

  async function once() {
    if (stopped) return;
    const { pick, skipped } = pickAssetUploads(listAssetImages(appDir), done);
    for (const s of skipped) {
      done.add(s.key);
      if (s.why === "too-big") log("warn", `도구가 만든 이미지가 10MB 를 넘어서 올리지 않아요: ${s.name}`);
    }
    for (const f of pick) {
      if (stopped) return;
      const label = assetLabel(f.name);
      let buf;
      try {
        buf = fs.readFileSync(f.full);
      } catch {
        continue; // 사라졌거나 쓰는 중: 다음 번에
      }
      const n = (tries.get(f.key) ?? 0) + 1;
      tries.set(f.key, n);
      if (n >= MAX_TRIES) done.add(f.key); // 3번째 시도 뒤에는 더 하지 않는다
      const form = new FormData();
      form.append("jobId", jobId);
      form.append("label", label);
      form.append("file", new Blob([buf], { type: ASSET_MIME[f.ext] }), f.name);
      let r;
      try {
        r = await post(form);
      } catch (e) {
        log("warn", `도구 이미지 올리기 오류(${n}/${MAX_TRIES}): ${f.name}${e?.name ? ` (${e.name})` : ""}`);
        continue;
      }
      if (r.status === 200) {
        done.add(f.key);
        uploaded++;
        log("info", `도구가 만든 이미지 올림: ${f.name} → ${label}`);
      } else if (r.status === 409) {
        stopped = true;
        log("warn", `도구 이미지 올리기를 멈춰요: 서버가 이 일감을 실행 중으로 보지 않아요(409${r.data?.cancelled ? ", 취소됨" : ""}).`);
      } else if (r.status === 400 && (r.data?.limit || /지시당 \d+장까지/.test(r.data?.message ?? ""))) {
        stopped = true;
        log("warn", `일감 이미지 한도(지시당 ${r.data?.limit ?? "?"}장)에 걸려 도구 이미지 올리기를 멈춰요. 나머지는 앱 폴더 .factory/assets/ 에 있어요.`);
      } else if (r.status >= 500 || r.status === 429) {
        log("warn", `도구 이미지 올리기 실패(${r.status}, ${n}/${MAX_TRIES}): ${f.name}`);
      } else {
        done.add(f.key); // 400·413 같은 건 다시 해도 같다
        log("warn", `도구 이미지 올리기 실패(${r.status}): ${f.name}`);
      }
    }
  }

  return {
    seed() {
      for (const f of listAssetImages(appDir)) done.add(f.key);
    },
    upload() {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        try {
          do {
            again = false;
            await once();
          } while (again && !stopped);
        } catch (e) {
          log("warn", `도구 이미지 올리기 중 오류: ${e?.name ?? "오류"}`);
        } finally {
          running = null;
        }
      })();
      return running;
    },
    get uploaded() {
      return uploaded;
    },
    get stopped() {
      return stopped;
    },
  };
}
