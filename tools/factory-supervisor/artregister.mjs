// 도트 그림 저장소: pixel-art 결과를 '후보'로 올리기 (감독 프로그램 안에서만 돈다)
// 중계 도구(pixel-art)가 끝나면 result.json 의 project·subject·kind·method·outputs 로 결과 이미지(시트·PNG·GIF)를 홈페이지 /api/factory/art 에 올려 후보로 등록한다.
// - 언제나 '후보'로만 올린다(승인은 부영실이 스튜디오에서). 한 결과에서 대표 그림(PNG·WebP·JPEG 첫 번째)과 GIF 첫 번째, 최대 2장.
// - 같은 파일(경로+수정 시각)은 srcKey 로 구분해서 서버가 한 번만 등록한다. 한도·409·서버 오류는 로그만 남기고 일감을 실패시키지 않는다. 로그에는 파일 이름과 결과만.
import fs from "node:fs";
import path from "node:path";

import { safeAppPath } from "./toolbroker.mjs";
import { ASSET_MAX_BYTES, ASSET_MIME } from "./assetupload.mjs";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const STILL_EXTS = [".png", ".webp", ".jpg", ".jpeg"];
const MAX_PER_RESULT = 2;
const MAX_TRIES = 2;

/** result.json 의 outputs(앱 폴더 기준 경로) → 올릴 파일 [{ rel, full, name, ext, size, mtimeMs }] : 대표 그림 1장 + GIF 1장. 중간 파일(_steps)·-raw·빈 파일·10MB 초과는 뺀다 */
export function pickArtOutputs(appDir, outputs) {
  const found = [];
  for (const o of Array.isArray(outputs) ? outputs : []) {
    if (typeof o !== "string") continue;
    const p = safeAppPath(appDir, o);
    if (!p.ok) continue;
    const ext = path.extname(p.rel).toLowerCase();
    const name = path.basename(p.rel);
    if (!ASSET_MIME[ext] || p.rel.split("/").includes("_steps") || /-raw\.[A-Za-z0-9]+$/i.test(name)) continue;
    let st;
    try {
      st = fs.lstatSync(p.full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile() || st.size === 0 || st.size > ASSET_MAX_BYTES) continue;
    found.push({ rel: p.rel, full: p.full, name, ext, size: st.size, mtimeMs: st.mtimeMs });
  }
  const still = found.find((f) => STILL_EXTS.includes(f.ext));
  const gif = found.find((f) => f.ext === ".gif");
  return [still, gif].filter(Boolean).slice(0, MAX_PER_RESULT);
}

/**
 * 일감 하나의 그림 등록기. opts: { appDir, jobId, appSlug, post(form) → { status, data }, log(level, message) }
 * - register(source): source 는 toolbroker 의 readStudioArtSource() 결과. 기다리지 않고 불러도 되고, 일감이 끝날 때 idle() 로 마무리를 기다린다.
 */
export function createArtRegistrar({ appDir, jobId, appSlug, post, log = () => {} }) {
  let stopped = false; // 한도·409 뒤에는 이 일감에서 더 올리지 않는다
  let registered = 0;
  const pending = new Set();
  const done = new Set();

  async function one(source, f) {
    const srcKey = `${jobId}:${f.rel}:${Math.floor(f.mtimeMs)}`.slice(0, 300);
    if (done.has(srcKey)) return;
    done.add(srcKey);
    const project = SLUG_RE.test(source.project ?? "") ? source.project : appSlug; // result.json 의 project 가 비었거나 이상하면 이 일감의 앱 이름
    let buf;
    try {
      buf = fs.readFileSync(f.full);
    } catch {
      return;
    }
    for (let n = 1; n <= MAX_TRIES; n++) {
      if (stopped) return;
      const form = new FormData();
      form.append("jobId", jobId);
      form.append("appSlug", project);
      form.append("subject", source.subject);
      form.append("kind", source.kind);
      form.append("method", source.method ?? "");
      form.append("summary", JSON.stringify(source.summary ?? {}));
      form.append("srcKey", srcKey);
      form.append("file", new Blob([buf], { type: ASSET_MIME[f.ext] }), f.name);
      let r;
      try {
        r = await post(form);
      } catch (e) {
        log("warn", `그림 후보 올리기 오류(${n}/${MAX_TRIES}): ${f.name}${e?.name ? ` (${e.name})` : ""}`);
        continue;
      }
      if (r.status === 200) {
        registered++;
        log("info", `그림 후보로 등록: ${f.name} (${project} · ${source.subject} · ${source.kind})${r.data?.duplicate ? " — 이미 있어서 건너뜀" : ""}`);
        return;
      }
      if (r.status === 409) {
        stopped = true;
        log("warn", `그림 후보 올리기를 멈춰요: 서버가 이 일감을 실행 중으로 보지 않아요(409).`);
        return;
      }
      if (r.status === 429) {
        stopped = true;
        log("warn", "그림 후보 올리기를 멈춰요: 한 일감이 올릴 수 있는 수를 넘었어요.");
        return;
      }
      if (r.status === 404) {
        stopped = true;
        log("warn", "그림 후보 올리기를 멈춰요: 홈페이지가 아직 그림 저장소를 모르는 버전이에요(배포 전). 그림은 앱 폴더에 있어요.");
        return;
      }
      if (r.status >= 500) {
        log("warn", `그림 후보 올리기 실패(${r.status}, ${n}/${MAX_TRIES}): ${f.name}`);
        continue;
      }
      log("warn", `그림 후보 올리기 실패(${r.status}): ${f.name}`); // 400·413 같은 건 다시 해도 같다
      return;
    }
  }

  return {
    register(source) {
      if (stopped || !source?.subject || !source?.kind) return Promise.resolve();
      const p = (async () => {
        try {
          for (const f of pickArtOutputs(appDir, source.outputs)) await one(source, f);
        } catch (e) {
          log("warn", `그림 후보 올리기 중 오류: ${e?.name ?? "오류"}`);
        }
      })().finally(() => pending.delete(p));
      pending.add(p);
      return p;
    },
    /** 올리는 중인 것이 모두 끝날 때까지 */
    async idle() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    get registered() {
      return registered;
    },
    get stopped() {
      return stopped;
    },
  };
}
