#!/usr/bin/env node
// 도트 그림 저장소 처음 값 올리기 (감독 프로그램 쪽에서 1회 실행): node tools/factory-supervisor/seedart.mjs [--dry]
// one-tiny-frame 의 대상 '싹이' 그림 두 장을 홈페이지 /api/factory/art 로 올린다. 원본 파일은 읽기만 한다.
//   - 앱에 실제 쓰인 정면 그림(one-tiny-frame/samples/ssagi_ref.png) → 승인
//   - 툴킷 시험의 코덱스 옆모습(game-toolkit/.factory/pixellab-test/side/codex-side.png) → 후보
// 같은 srcKey 는 서버가 한 번만 등록하므로 다시 실행해도 중복이 생기지 않는다. 홈페이지에 그림 저장소가 배포되기 전이면 404 로 멈춘다(배포 뒤 다시 실행).
// 서버 주소·토큰은 감독 프로그램 설정 파일(FACTORY_CONFIG 또는 ~/dev/factory/supervisor.config.json)에서 읽고, 토큰은 출력하지 않는다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ASSET_MAX_BYTES, ASSET_MIME } from "./assetupload.mjs";

const expand = (p) => (typeof p === "string" && (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) ? path.join(os.homedir(), p.slice(1)) : p);

/** 올릴 그림 목록. src 는 작업 폴더(workDir) 기준 상대 경로 */
export const SEEDS = [
  {
    srcKey: "seed:one-tiny-frame:ssagi_ref",
    appSlug: "one-tiny-frame",
    subject: "싹이",
    kind: "image-prop",
    status: "approved",
    method: "",
    src: "one-tiny-frame/samples/ssagi_ref.png",
    note: "앱에 실제 쓰인 정면 그림(128px)",
  },
  {
    srcKey: "seed:one-tiny-frame:codex-side",
    appSlug: "one-tiny-frame",
    subject: "싹이",
    kind: "motion-game",
    status: "candidate",
    method: "codex",
    src: "game-toolkit/.factory/pixellab-test/side/codex-side.png",
    note: "코덱스 옆모습(툴킷 시험)",
  },
];

/** 한 장 올리기. post(form) → { status, data }. 반환: { ok, line } (파일 이름·결과만, 값·토큰 없음) */
export async function seedOne(seed, workDir, post) {
  const full = path.resolve(workDir, seed.src);
  const root = path.resolve(workDir);
  const name = path.basename(seed.src);
  if (!full.startsWith(root + path.sep)) return { ok: false, line: `${name}: 작업 폴더 밖 경로라 건너뜀` };
  let st;
  try {
    st = fs.statSync(full);
  } catch {
    return { ok: false, line: `${name}: 파일이 없어요` };
  }
  const ext = path.extname(name).toLowerCase();
  if (!st.isFile() || st.size === 0 || st.size > ASSET_MAX_BYTES || !ASSET_MIME[ext]) return { ok: false, line: `${name}: 올릴 수 없는 파일이에요(이미지 10MB 이하만)` };
  const form = new FormData();
  for (const k of ["appSlug", "subject", "kind", "status", "method", "srcKey", "note"]) form.append(k, seed[k] ?? "");
  form.append("summary", JSON.stringify({ steps: [], refs: [], refsFallback: "처음 값(손으로 올림)", cost: 0 }));
  form.append("file", new Blob([fs.readFileSync(full)], { type: ASSET_MIME[ext] }), name);
  let r;
  try {
    r = await post(form);
  } catch (e) {
    return { ok: false, line: `${name}: 서버에 연결하지 못했어요${e?.name ? ` (${e.name})` : ""}` };
  }
  if (r.status === 200) return { ok: true, line: `${name}: ${r.data?.duplicate ? "이미 있어요" : "올렸어요"} → ${seed.subject} · ${r.data?.art?.status ?? seed.status}` };
  if (r.status === 404) return { ok: false, line: `${name}: 홈페이지가 아직 그림 저장소를 모르는 버전이에요(404). 서버 [배포] 뒤 다시 실행하세요.` };

  return { ok: false, line: `${name}: 실패(${r.status})` };
}

async function main() {
  const dry = process.argv.includes("--dry");
  const configPath = expand(process.env.FACTORY_CONFIG || "~/dev/factory/supervisor.config.json");
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const workDir = expand(cfg.workDir || "~/dev/factory");
  const base = String(cfg.serverUrl || "").replace(/\/+$/, "");
  if (!base || !cfg.token) throw new Error("감독 프로그램 설정에 serverUrl·token 이 없어요.");
  const post = async (form) => {
    const res = await fetch(`${base}/api/factory/art`, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}` }, body: form, signal: AbortSignal.timeout(60_000) });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* JSON 아님 */
    }
    return { status: res.status, data };
  };
  let failed = 0;
  for (const seed of SEEDS) {
    if (dry) {
      const ok = fs.existsSync(path.resolve(workDir, seed.src));
      console.log(`${path.basename(seed.src)}: ${ok ? "있음" : "없음"} → ${seed.subject} · ${seed.status} (올리지 않음, --dry)`);
      if (!ok) failed++;
      continue;
    }
    const r = await seedOne(seed, workDir, post);
    console.log(r.line);
    if (!r.ok) failed++;
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`그림 처음 값 올리기 실패: ${e.message}`);
    process.exitCode = 1;
  });
}
