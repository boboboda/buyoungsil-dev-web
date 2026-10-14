#!/usr/bin/env node
// 도구 설명서(game-toolkit/tools/manifests/<도구>.json, 형식 schemas/tool-manifest.schema.json)를 읽어 홈페이지로 보고하고(읽기 전용),
// 도구 중계(toolbroker.mjs)가 '방법 → 필요한 키'를 정할 때 같은 설명서를 쓰게 한다. 도구·파이썬은 실행하지 않는다.
// - 설명서 파일이 있는 도구: 파일 내용 그대로(source: "file"). 없는 도구: tools.json(도구함 정보)으로 최소 설명서를 만든다(source: "fallback").
// - 보고: POST /api/factory/tool-manifests { commit, tools:[…] }. 시작할 때와 툴킷 커밋·설명서 내용이 바뀌었을 때(가끔 다시). 실패하면 늦춰서 다시 시도하고 폴링·일감에는 영향이 없다.
// - 키는 이름만 다룬다. 값은 읽지도 보내지도 않는다.
//
//   node toolmanifest.mjs once [툴킷폴더]   읽어서 화면에 보여 준다(서버로 보내지 않음)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MANIFEST_DIR_REL = "tools/manifests";
export const MANIFEST_CHECK_MS = 60_000; // 커밋·파일 바뀜 확인 주기(git rev-parse 한 번 + 작은 파일 몇 개)
export const MANIFEST_RESEND_MS = 6 * 60 * 60_000; // 안 바뀌어도 6시간에 한 번은 다시 보낸다
export const MANIFEST_BODY_BYTES = 60 * 1024; // 서버 한도 64KB 보다 조금 아래
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOOLS = 40;
const POST_TIMEOUT_MS = 10_000;
const NAME_RE = /^[a-z][a-z0-9_.-]{0,39}$/;
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const ARG_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

// 선택 키(tools.json 의 optionalSecrets)는 그 호출이 이 방법일 때만 필요하다. 설명서 파일이 없는 도구는 이 표로 '방법 → 키'를 짐작한다
export const OPTIONAL_SECRET_METHODS = Object.freeze({ PIXELLAB_TOKEN: "pixellab" });

const isRecord = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** 툴킷 폴더 안의 실제 파일만 글자로 읽는다(심볼릭 링크·폴더 밖·너무 큰 파일은 null) */
function readInside(root, rel) {
  try {
    const full = path.resolve(root, ...String(rel).split("/"));
    if (!full.startsWith(path.resolve(root) + path.sep) || isLink(full)) return null;
    const st = fs.statSync(full);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(full, "utf8").replace(/^﻿/, "");
  } catch {
    return null;
  }
}

/** tools/manifests/*.json → { 이름: 설명서 }. 파일 이름과 name 이 같고 방법이 하나 이상인 것만. 깨진 파일은 건너뛴다(목록에 reasons 로 남긴다) */
export function readManifestFiles(toolkitDir) {
  const manifests = {};
  const skipped = [];
  if (!toolkitDir) return { manifests, skipped };
  const dir = path.join(toolkitDir, ...MANIFEST_DIR_REL.split("/"));
  let names = [];
  try {
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) return { manifests, skipped };
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return { manifests, skipped };
  }
  for (const file of names) {
    const base = file.slice(0, -5);
    const text = readInside(toolkitDir, `${MANIFEST_DIR_REL}/${file}`);
    if (text === null) {
      skipped.push(`${file}: 읽지 못했어요`);
      continue;
    }
    try {
      const m = JSON.parse(text);
      if (!isRecord(m) || m.name !== base || !NAME_RE.test(base) || !Array.isArray(m.methods) || !m.methods.some((x) => isRecord(x) && typeof x.id === "string")) {
        skipped.push(`${file}: 형식이 맞지 않아요`);
        continue;
      }
      const { $schema: _ignored, proposals: _memo, ...rest } = m; // 구현 안 한 제안 메모는 보내지 않는다
      manifests[base] = { ...rest, source: "file" };
    } catch {
      skipped.push(`${file}: JSON 이 아니에요`);
    }
  }
  return { manifests, skipped };
}

const secretNames = (list) => [...new Set((Array.isArray(list) ? list : []).filter((s) => typeof s === "string" && SECRET_NAME_RE.test(s)))].slice(0, 8);

/** tools.json 의 도구 한 항목(원본) → 최소 설명서: 방법은 기본 하나 + 선택 키가 가리키는 방법. 한계·비용 칸은 비어 있다 */
export function fallbackManifest(id, t) {
  const methods = [
    { id: "default", label: "기본", secrets: secretNames(t.secrets), network: t.network === true, limits: Number.isInteger(t.timeoutSec) && t.timeoutSec > 0 ? { timeoutSec: t.timeoutSec } : {} },
  ];
  const byMethod = new Map();
  for (const name of secretNames(t.optionalSecrets)) {
    const method = OPTIONAL_SECRET_METHODS[name] ?? "optional";
    byMethod.set(method, [...(byMethod.get(method) ?? []), name]);
  }
  for (const [method, secrets] of byMethod) methods.push({ id: method, label: method, secrets, network: true, limits: {}, notes: "tools.json 의 선택 키(optionalSecrets)에서 짐작한 방법이에요." });
  const inputs = [];
  for (const a of Array.isArray(t.args) ? t.args : []) {
    if (!isRecord(a) || !ARG_NAME_RE.test(a.name ?? "")) continue;
    inputs.push({ name: a.name, label: a.name, type: ["string", "int", "path"].includes(a.type) ? a.type : "string", required: a.required === true, description: typeof a.description === "string" ? a.description.slice(0, 200) : "" });
  }
  return {
    name: id,
    label: id,
    description: typeof t.description === "string" ? t.description.slice(0, 300) : "",
    layer: t.layer === "studio" || t.layer === "internal" ? t.layer : "internal",
    version: 1,
    source: "fallback",
    methods,
    inputs: inputs.slice(0, 30),
    outputs: { formats: [], resultFile: "", resultFields: [] },
  };
}

/** 툴킷 git 커밋(짧게). 읽기만(rev-parse). 못 읽으면 "" */
export function toolkitCommit(toolkitDir) {
  if (!toolkitDir) return "";
  try {
    const r = spawnSync("git", ["-C", toolkitDir, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const out = String(r.stdout ?? "").trim();
    return r.status === 0 && /^[0-9a-f]{7,40}$/.test(out) ? out : "";
  } catch {
    return "";
  }
}

const bytes = (o) => Buffer.byteLength(JSON.stringify(o), "utf8");

/** 툴킷 폴더 → { commit, tools:[설명서…], skipped }. 설명서 파일이 있는 도구가 먼저, 그다음 tools.json 에만 있는 도구(최소 설명서). 던지지 않는다 */
export function collectManifests(toolkitDir, { limit = MANIFEST_BODY_BYTES } = {}) {
  const { manifests, skipped } = readManifestFiles(toolkitDir);
  const fallbacks = [];
  try {
    const text = readInside(toolkitDir, "tools.json");
    const tools = text ? JSON.parse(text)?.tools : null;
    if (isRecord(tools)) {
      // 스튜디오 도구가 먼저
      const entries = Object.entries(tools).filter(([id, t]) => NAME_RE.test(id) && isRecord(t) && !Object.hasOwn(manifests, id));
      entries.sort(([, a], [, b]) => (b.layer === "studio") - (a.layer === "studio"));
      for (const [id, t] of entries) fallbacks.push(fallbackManifest(id, t));
    }
  } catch {
    /* tools.json 을 못 읽으면 설명서 파일만 보낸다 */
  }
  let list = [...Object.values(manifests), ...fallbacks].slice(0, MAX_TOOLS);
  const commit = toolkitCommit(toolkitDir);
  while (list.length > 0 && bytes({ commit, tools: list }) > limit) {
    // 넘치면 최소 설명서부터 하나씩 뺀다(설명서 파일은 끝까지 남긴다)
    const i = list.map((m) => m.source).lastIndexOf("fallback");
    if (i < 0) break;
    list = list.filter((_, k) => k !== i);
  }
  return { commit, tools: list, skipped };
}

// ───────── 방법 → 필요한 키 (도구 중계가 부른다) ─────────

/** 설명서 파일 목록 → { 도구: 설명서 }. 도구 중계가 호출마다 읽는다(파일 몇 개) */
export function loadManifestIndex(toolkitDir) {
  return readManifestFiles(toolkitDir).manifests;
}

/** 설명서에서 방법 id(대소문자 무시)에 해당하는 방법. 없으면 null */
export function manifestMethod(manifest, methodId) {
  if (!manifest || !methodId) return null;
  return (Array.isArray(manifest.methods) ? manifest.methods : []).find((m) => isRecord(m) && String(m.id).toLowerCase() === String(methodId).toLowerCase()) ?? null;
}

/**
 * 이 호출에서 쓰는 방법(method)에 필요한 선택 키 이름 — '방법 → 키'를 정하는 유일한 곳.
 *  1) 설명서 파일(manifest)이 그 방법에 적어 둔 secrets
 *  2) tools.json 의 optionalSecrets 중 OPTIONAL_SECRET_METHODS 가 그 방법으로 가리키는 것
 * 둘을 합친다. 필수 키(tool.secrets)는 이 함수와 상관없이 항상 필요하다.
 */
export function secretsForMethod(tool, method, manifest = null) {
  const out = new Set(secretNames(manifestMethod(manifest, method)?.secrets));
  for (const n of tool?.optionalSecrets ?? []) if (OPTIONAL_SECRET_METHODS[n] === method) out.add(n);
  for (const n of tool?.secrets ?? []) out.delete(n);
  return [...out];
}

/** 설명서 파일 전체에 적힌 키 이름(도구 전용 키라서 AI 환경에서 뺄 때 쓴다) */
export function manifestSecretNames(toolkitDir) {
  return [...new Set(Object.values(loadManifestIndex(toolkitDir)).flatMap((m) => (m.methods ?? []).flatMap((x) => secretNames(x?.secrets))))];
}

// ───────── 보고 ─────────

/** 보고 내용이 같은지 비교하는 지문(커밋 + 설명서 내용) */
export const manifestSignature = (report) => createHash("sha256").update(JSON.stringify([report.commit, report.tools])).digest("hex").slice(0, 16);

/** 감독 프로그램이 부른다. 처음 한 번, 그 뒤 1분마다 커밋·설명서가 바뀌었는지 보고 바뀌었거나 6시간이 지났으면 보낸다. 실패하면 점점 늦춰 다시 시도. 반환: { stop, tick } */
export function startManifestReport({ api, log = () => {}, toolkitDir, everyMs = MANIFEST_CHECK_MS, resendMs = MANIFEST_RESEND_MS, firstMs = 12_000 } = {}) {
  let lastSig = "";
  let lastAt = 0;
  let busy = false;
  let fails = 0;
  let retryAt = 0;
  const tick = async () => {
    if (busy || Date.now() < retryAt) return;
    busy = true;
    try {
      const dir = typeof toolkitDir === "function" ? toolkitDir() : toolkitDir;
      const report = collectManifests(dir);
      if (!report.tools.length) return; // 툴킷이 없거나 도구가 없다: 보낼 게 없다
      const sig = manifestSignature(report);
      if (sig === lastSig && Date.now() - lastAt < resendMs) return;
      const r = await api("POST", "/api/factory/tool-manifests", { commit: report.commit, tools: report.tools }, { timeoutMs: POST_TIMEOUT_MS });
      if (r?.status === 200) {
        lastSig = sig;
        lastAt = Date.now();
        fails = 0;
        log(`도구 설명서 ${report.tools.length}개를 홈페이지에 보냈어요(툴킷 ${report.commit || "커밋 모름"}, 설명서 파일 ${report.tools.filter((t) => t.source === "file").length}개${report.skipped.length ? `, 건너뜀 ${report.skipped.length}개` : ""}).`);
      } else {
        retryAt = Date.now() + Math.min(10 * 60_000, 30_000 * 2 ** Math.min(fails, 5));
        if (fails++ % 5 === 0) log(`도구 설명서 보내기 실패: ${r?.status ?? "응답 없음"} ${r?.data?.message ?? ""}`.trim());
      }
    } catch (e) {
      retryAt = Date.now() + Math.min(10 * 60_000, 30_000 * 2 ** Math.min(fails, 5));
      if (fails++ % 5 === 0) log(`도구 설명서 보내기 실패: ${e?.name === "TimeoutError" ? "시간 초과" : "연결 안 됨"}`);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(tick, firstMs);
  const id = setInterval(tick, everyMs);
  first.unref?.();
  id.unref?.();
  return { stop: () => (clearTimeout(first), clearInterval(id)), tick };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "once") {
    console.error("사용법: node toolmanifest.mjs once [툴킷폴더]   (감독 프로그램이 알아서 보내요)");
    process.exitCode = 2;
  } else {
    const report = collectManifests(path.resolve(process.argv[3] ?? "game-toolkit"));
    console.log(JSON.stringify({ commit: report.commit, skipped: report.skipped, tools: report.tools.map((t) => ({ name: t.name, source: t.source, methods: t.methods.map((m) => `${m.id}[${m.secrets.join(",")}]`) })) }, null, 2));
    console.error(`도구 ${report.tools.length}개, 본문 ${bytes({ commit: report.commit, tools: report.tools })}바이트`);
  }
}
