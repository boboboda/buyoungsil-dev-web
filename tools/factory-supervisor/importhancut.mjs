#!/usr/bin/env node
// 한 컷 서버의 승인 컷 → 공장 그림 저장소 가져오기 (감독 프로그램 쪽 1회용, 다시 돌려도 안전): node tools/factory-supervisor/importhancut.mjs [--dry] [--settings-only] [--no-settings]
//   1) one-tiny-frame 의 도구 설정 spec.cell_size 를 128 로 고친다(수정자 '정비', 이력에 남음. 이미 128 이면 바꾸지 않음).
//   2) 서버2 의 한 컷 컨테이너 DB(/data/hancut.db)를 '읽기 전용'으로 조회해 승인 컷(approved_at 있음)을 모두 가져온다. 후보는 가져오지 않는다.
//      각 컷: 대상 '싹이' · image-scene · 승인 · pixellab · 메모(컷 id·날짜·한 줄 문장) · 원래 만든 시각·승인 시각. 이미지는 /api/factory/art 가 업로드 서버에 올린다.
//      srcKey = hancut:<컷 id> 라서 다시 돌려도 중복되지 않는다(서버가 "이미 있어요"로 돌려줌).
// 한 컷 서버의 DB·파일은 읽기만 한다(sqlite readonly, 이미지는 cat). ssh 는 serverpc2 에 인자로 직접 적은 명령만 쓴다.
// 서버 주소·토큰은 감독 프로그램 설정 파일에서 읽고, 토큰은 출력하지 않는다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { ASSET_MAX_BYTES } from "./assetupload.mjs";

const expand = (p) => (typeof p === "string" && (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) ? path.join(os.homedir(), p.slice(1)) : p);

export const HOST = "serverpc2";
export const CONTAINER = "one-tiny-frame-api-1";
export const APP_SLUG = "one-tiny-frame";
export const SUBJECT = "싹이";
export const CELL_SIZE = 128;
const IMAGE_RE = /^images\/[A-Za-z0-9_-]+\.png$/;
// 읽기 전용 조회(따옴표 안에 작은따옴표를 쓰지 않는다)
const QUERY_JS =
  'const D=require("better-sqlite3");const d=new D("/data/hancut.db",{readonly:true});console.log(JSON.stringify(d.prepare("select id,slug,line,topic,image_file,created_at,approved_at from cuts where approved_at is not null and image_file is not null order by id").all()))';

/** ssh 로 서버2 에서 명령 하나 실행. 반환: { status, stdout(Buffer), stderr } */
export function sshRun(command) {
  const r = spawnSync("ssh", ["-o", "BatchMode=yes", HOST, command], { maxBuffer: ASSET_MAX_BYTES + 1024 * 1024, timeout: 120_000, windowsHide: true });

  return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: String(r.stderr ?? "") };
}

/** 한 컷 서버에서 승인 컷 목록을 읽는다 */
export function fetchApprovedCuts(run = sshRun) {
  const r = run(`docker exec ${CONTAINER} node -e '${QUERY_JS}'`);

  if (r.status !== 0) throw new Error(`한 컷 서버 조회 실패(코드 ${r.status})`);
  const rows = JSON.parse(r.stdout.toString("utf8").trim());

  return Array.isArray(rows) ? rows : [];
}

/** 컷 이미지 파일 읽기(읽기 전용 cat). 반환: Buffer | null */
export function fetchCutImage(file, run = sshRun) {
  if (!IMAGE_RE.test(file)) return null;
  const r = run(`docker exec ${CONTAINER} cat /data/${file}`);
  const ok = r.status === 0 && r.stdout.length > 8 && r.stdout.length <= ASSET_MAX_BYTES && r.stdout.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  return ok ? r.stdout : null;
}

export const srcKeyOf = (cut) => `hancut:${cut.id}`;

/** 메모: 한 컷 컷 id·날짜·한 줄 문장(서버가 200자로 자른다) */
export function noteOf(cut) {
  const day = String(cut.created_at ?? "").slice(0, 10);
  const line = String(cut.line ?? "").replace(/\s+/g, " ").trim();

  return `한 컷 #${cut.id} · ${day}${line ? ` · ${line}` : ""}`.slice(0, 200);
}

/** 올릴 폼 만들기 */
export function buildForm(cut, buf) {
  const form = new FormData();
  const fields = { appSlug: APP_SLUG, subject: SUBJECT, kind: "image-scene", status: "approved", method: "pixellab", srcKey: srcKeyOf(cut), note: noteOf(cut), createdAt: cut.created_at, decidedAt: cut.approved_at };

  for (const [k, v] of Object.entries(fields)) form.append(k, String(v ?? ""));
  form.append("summary", JSON.stringify({ steps: [], refs: [], refsFallback: "한 컷 서버에서 가져옴", cost: 0 }));
  form.append("file", new Blob([buf], { type: "image/png" }), path.basename(cut.image_file));

  return form;
}

/** 전부 가져오기. deps: { cuts, readImage(file), post(form) → { status, data } }. 반환: { uploaded, duplicate, failed, lines } */
export async function importAll({ cuts, readImage, post, dry = false }) {
  const out = { uploaded: 0, duplicate: 0, failed: 0, lines: [] };

  for (const cut of cuts) {
    const tag = `#${cut.id}`;
    const buf = readImage(cut.image_file);

    if (!buf) {
      out.failed++;
      out.lines.push(`${tag}: 이미지를 읽지 못했어요`);
      continue;
    }
    if (dry) {
      out.lines.push(`${tag}: ${buf.length}바이트 읽음(올리지 않음, --dry)`);
      continue;
    }
    let r;

    try {
      r = await post(buildForm(cut, buf));
    } catch (e) {
      out.failed++;
      out.lines.push(`${tag}: 서버에 연결하지 못했어요${e?.name ? ` (${e.name})` : ""}`);
      continue;
    }
    if (r.status === 200) {
      if (r.data?.duplicate) out.duplicate++;
      else out.uploaded++;
      out.lines.push(`${tag}: ${r.data?.duplicate ? "이미 있어요" : "올렸어요"}`);
    } else {
      out.failed++;
      out.lines.push(`${tag}: 실패(${r.status})`);
    }
  }

  return out;
}

/** 설정 칸 크기 고치기. post(body) → { status, data }. 반환: { ok, line } */
export async function setCellSize(post) {
  let r;

  try {
    r = await post({ appSlug: APP_SLUG, patch: { spec: { cell_size: CELL_SIZE } }, who: "정비", note: `규격 칸 크기 ${CELL_SIZE} (한 컷 서버 생성 크기)` });
  } catch (e) {
    return { ok: false, line: `설정: 서버에 연결하지 못했어요${e?.name ? ` (${e.name})` : ""}` };
  }
  if (r.status === 200) return { ok: true, line: `설정: cell_size ${CELL_SIZE} ${r.data?.unchanged ? "(이미 그 값이라 그대로)" : `저장(버전 ${r.data?.version})`}` };
  if (r.status === 404 && !r.data) return { ok: false, line: "설정: 홈페이지가 이 주소를 아직 몰라요(404). 서버 [배포] 뒤 다시 실행하세요." };

  return { ok: false, line: `설정: 실패(${r.status})${r.data?.message ? ` ${String(r.data.message).slice(0, 100)}` : ""}` };
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const configPath = expand(process.env.FACTORY_CONFIG || "~/dev/factory/supervisor.config.json");
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const base = String(cfg.serverUrl || "").replace(/\/+$/, "");

  if (!base || !cfg.token) throw new Error("감독 프로그램 설정에 serverUrl·token 이 없어요.");
  const call = async (url, init) => {
    const res = await fetch(`${base}${url}`, { ...init, headers: { Authorization: `Bearer ${cfg.token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
    let data = null;

    try {
      data = await res.json();
    } catch {
      /* JSON 아님 */
    }

    return { status: res.status, data };
  };
  let failed = 0;

  if (!args.includes("--no-settings")) {
    if (dry) console.log(`설정: cell_size ${CELL_SIZE} 로 바꿀 예정(올리지 않음, --dry)`);
    else {
      const s = await setCellSize((body) => call("/api/factory/tool-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

      console.log(s.line);
      if (!s.ok) failed++;
    }
  }
  if (!args.includes("--settings-only")) {
    const cuts = fetchApprovedCuts();

    console.log(`한 컷 서버 승인 컷 ${cuts.length}장`);
    const r = await importAll({ cuts, readImage: (f) => fetchCutImage(f), post: (form) => call("/api/factory/art", { method: "POST", body: form }), dry });

    for (const l of r.lines) console.log(l);
    console.log(`결과: 올림 ${r.uploaded} · 이미 있음 ${r.duplicate} · 실패 ${r.failed}`);
    failed += r.failed;
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`한 컷 가져오기 실패: ${e.message}`);
    process.exitCode = 1;
  });
}
