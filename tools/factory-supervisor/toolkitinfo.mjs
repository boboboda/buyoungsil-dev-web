#!/usr/bin/env node
// 게임 툴킷(game-toolkit/tools.json)의 도구별 상세를 읽어 통제실 도구함 패널로 보낸다(읽기 전용, 도구·파이썬은 실행하지 않는다).
// 감독 프로그램이 시작할 때 startToolkitReport() 로 붙인다. 보고 경로는 장비 상태와 같은 POST /api/factory/device-stats
// ({ device:"main-pc", toolkit:{…} }, 작업 PC 토큰). 본문은 8KB 이하로 줄여서 보낸다(넘으면 설명·주석·옵션부터 줄이고 마지막에 도구를 자른다).
//
//   node toolkitinfo.mjs once [툴킷폴더]   읽어서 화면에 보여 준다(서버로 보내지 않음, 값 확인용)
//
// 보내는 것: 도구 id·설명·인자(이름:종류)·네트워크 여부·키 '이름'·진입/스크립트 파일(툴킷 폴더 기준 상대 경로)·파이썬 맨 위 설명·argparse 옵션 이름·수정일.
// 키 값·절대 경로·환경변수는 읽지도 보내지도 않는다. 파이썬은 글자로만 훑는다(정규식), 실행하지 않는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { maskText } from "./release.mjs";

export const TOOLKIT_REPORT_EVERY_MS = 10 * 60_000;
export const TOOLKIT_RESEND_MS = 60 * 60_000; // 바뀌지 않아도 1시간에 한 번은 다시 보낸다(서버가 '최근 확인'을 알 수 있게)
export const TOOLKIT_BODY_BYTES = 7600; // 서버 한도 8KB(8192바이트)보다 조금 아래
const POST_TIMEOUT_MS = 10_000;
const MAX_TOOLS = 40;
const MAX_FILE_BYTES = 256 * 1024;
const ID_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const ARG_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
const OUTPUT_ARGS = new Set(["output", "out", "output_dir", "dest_dir"]);

const clip = (s, n) => {
  const t = maskText(String(s ?? "")).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t;
};

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
    return { text: fs.readFileSync(full, "utf8").replace(/^﻿/, ""), mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/** 파이썬 파일 맨 위 설명: 첫 문자열 리터럴(""" 또는 ''') 아니면 맨 위 # 주석 줄들. 코드는 실행하지 않는다 */
export function leadingDoc(text) {
  const src = String(text ?? "").replace(/^#!.*\r?\n/, "");
  const m = /^\s*(?:#.*\r?\n\s*)*(?:[rRuU])?("""|''')([\s\S]*?)\1/.exec(src);
  if (m) return m[2];
  const lines = [];
  for (const line of src.split(/\r?\n/)) {
    const c = /^\s*#\s?(.*)$/.exec(line);
    if (!c) {
      if (line.trim() === "" && !lines.length) continue;
      break;
    }
    lines.push(c[1]);
  }
  return lines.join(" ");
}

/** 진입 파일(cli.py)에서 하위 명령 → 모듈 파일, 하위 명령 → argparse 옵션 이름을 글자로 뽑는다 */
export function scanEntry(text) {
  const src = String(text ?? "");
  const modules = {};
  const re = /(?:if|elif)\s+\w+\.command\s*==\s*["']([a-z0-9_-]+)["']\s*:\s*\r?\n\s*from\s+([A-Za-z0-9_.]+)\s+import\s+\w+/g;
  for (let m; (m = re.exec(src)); ) modules[m[1]] = `${m[2].replace(/\./g, "/")}.py`;
  const fallback = /\belse\s*:\s*\r?\n\s*from\s+([A-Za-z0-9_.]+)\s+import\s+\w+/.exec(src);
  const vars = {};
  for (let m, r = /(\w+)\s*=\s*\w+\.add_parser\(\s*["']([a-z0-9_-]+)["']/g; (m = r.exec(src)); ) vars[m[1]] = m[2];
  const options = {};
  for (let m, r = /(\w+)\.add_argument\(\s*["']--([A-Za-z0-9_-]+)["']/g; (m = r.exec(src)); ) {
    const cmd = vars[m[1]];
    if (cmd) (options[cmd] ??= []).push(m[2]);
  }
  return { modules, fallbackModule: fallback ? `${fallback[1].replace(/\./g, "/")}.py` : null, options };
}

// 설명·인자에서 찾는 말 → 용도 추정에 쓰는 표시. 비교용 '시트'(번호 붙은 검토 그림)는 게임용 시트가 아니라서 영어/구체적 말만 본다
const TAGS = [
  ["sheet", /sprite\s*sheet|spritesheet|스프라이트\s*시트|layout\s*=\s*sheet/i],
  ["atlas", /atlas|아틀라스/i],
  ["tilemap", /tile\s*map|tilemap|타일맵|타일\s*셋|tileset/i],
  ["sprite", /sprite|스프라이트/i],
  ["gif", /\bgif\b|움짤/i],
  ["webp", /\bwebp\b/i],
  ["apng", /\bapng\b/i],
  ["cut", /장면\s*컷|한\s*컷|단일\s*컷|\bcut\b|일러스트/i],
];
export const tagsOf = (text) => TAGS.filter(([, re]) => re.test(text)).map(([k]) => k);

const MODE_PURPOSE = { game: "game", clip: "cut", cut: "cut", common: "common" }; // tools.json 의 clip → 통제실 표기 cut
const MAX_MODES = 8;
const ioText = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : "");

/** tools.json 의 modes 배열 → 모드 목록. 모드가 없거나 형식이 깨진 항목은 건너뛴다(도구 자체는 그대로 읽는다) */
export function readModes(raw) {
  if (!Array.isArray(raw)) return [];
  const modes = [];
  for (const m of raw) {
    if (!m || typeof m !== "object" || Array.isArray(m) || !ARG_NAME_RE.test(m.id ?? "") || modes.some((x) => x.id === m.id)) continue;
    const io = m.io && typeof m.io === "object" ? m.io : {};
    modes.push({
      id: m.id,
      purpose: MODE_PURPOSE[m.purpose] ?? "unclassified",
      when: typeof m.when === "string" ? m.when : "",
      legacy: typeof m.legacy === "string" ? m.legacy : "",
      ioIn: ioText(io.in),
      ioOut: ioText(io.out),
    });
    if (modes.length >= MAX_MODES) break;
  }
  return modes;
}

const MAX_STUDIO = 4;
const MAX_KINDS = 8;
const MAX_METHODS = 6;
const LAYERS = ["internal", "studio"];

/** tools.json 최상위 studioTools → 스튜디오 도구 목록(사람이 쓰는 도구). 없거나 깨졌으면 [] (옛 tools.json 은 지금처럼 동작). 항목이 깨져도 나머지는 살린다 */
export function readStudioTools(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out = [];
  for (const [id, t] of Object.entries(raw)) {
    if (!ID_RE.test(id) || !t || typeof t !== "object" || Array.isArray(t)) continue;
    const kinds = [];
    for (const [kid, k] of Object.entries(t.kinds && typeof t.kinds === "object" && !Array.isArray(t.kinds) ? t.kinds : {})) {
      if (!ID_RE.test(kid) || !k || typeof k !== "object" || Array.isArray(k)) continue;
      const methods = (Array.isArray(k.methods) ? k.methods : []).filter((m) => typeof m === "string" && ARG_NAME_RE.test(m)).slice(0, MAX_METHODS);
      kinds.push({
        id: kid,
        label: typeof k.label === "string" ? k.label : "",
        output: typeof k.output === "string" ? k.output : "",
        background: typeof k.background === "string" ? k.background : "",
        defaultMethod: typeof k.defaultMethod === "string" && ARG_NAME_RE.test(k.defaultMethod) ? k.defaultMethod : "",
        methods,
      });
      if (kinds.length >= MAX_KINDS) break;
    }
    const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && /^[A-Za-z0-9가-힣①②③④_-]{1,24}$/.test(x)).slice(0, 8) : []);
    out.push({
      id,
      title: typeof t.title === "string" ? t.title : id,
      desc: typeof t.description === "string" ? t.description : "",
      methodOrder: names(t.methodOrder),
      refOrder: names(t.refOrder),
      refsMax: Number.isInteger(t.refsMax) && t.refsMax > 0 && t.refsMax <= 20 ? t.refsMax : 0,
      kinds,
    });
    if (out.length >= MAX_STUDIO) break;
  }
  return out;
}

/** tools.json 한 항목(+진입·스크립트 글자) → 보고용 도구 */
function describeTool(root, id, t, entryScan, entryFile) {
  const args = [];
  for (const a of Array.isArray(t.args) ? t.args : []) {
    if (!a || typeof a !== "object" || !ARG_NAME_RE.test(a.name ?? "")) continue;
    args.push({ name: a.name, type: ["string", "int", "path"].includes(a.type) ? a.type : "string", required: a.required === true, desc: typeof a.description === "string" ? a.description : "" });
  }
  const entry = typeof t.entry === "string" ? t.entry.slice(0, 100) : "";
  const modRel = entryScan.modules[id] ?? (entryScan.fallbackModule && !(id in entryScan.modules) ? entryScan.fallbackModule : null);
  const mod = modRel ? readInside(root, modRel) : null;
  const scriptRel = mod ? modRel : entry;
  const scriptFile = mod ?? entryFile;
  const full = [id, t.description, ...args.map((a) => `${a.name} ${a.desc}`)].join(" ");

  return {
    id,
    desc: String(t.description ?? ""),
    entry,
    script: scriptRel.slice(0, 100),
    dir: scriptRel.includes("/") ? scriptRel.slice(0, scriptRel.lastIndexOf("/")) : ".",
    doc: scriptFile ? leadingDoc(scriptFile.text) : "",
    opts: entryScan.options[id] ?? [],
    args,
    out: args.filter((a) => OUTPUT_ARGS.has(a.name)).map((a) => a.name),
    tags: tagsOf(full),
    net: t.network === true,
    sec: (Array.isArray(t.secrets) ? t.secrets : []).filter((s) => typeof s === "string" && SECRET_NAME_RE.test(s)).slice(0, 8), // 이름만
    optSec: (Array.isArray(t.optionalSecrets) ? t.optionalSecrets : []).filter((s) => typeof s === "string" && SECRET_NAME_RE.test(s)).slice(0, 8), // 선택 키(이름만)
    layer: LAYERS.includes(t.layer) ? t.layer : "",
    to: Number.isInteger(t.timeoutSec) ? t.timeoutSec : 0,
    en: t.enabled !== false,
    modes: readModes(t.modes),
    mod: scriptFile ? new Date(scriptFile.mtimeMs).toISOString().slice(0, 10) : "",
  };
}

// 본문이 클 때 줄이는 단계: 앞 단계일수록 정보를 많이 남긴다
const LEVELS = [
  { desc: 220, doc: 200, opts: 30, argDesc: 0, args: 30, mWhen: 100, mLegacy: 100, mIo: 60, stDesc: 160 },
  { desc: 140, doc: 100, opts: 15, argDesc: 0, args: 20, mWhen: 70, mLegacy: 70, mIo: 40, stDesc: 100 },
  { desc: 90, doc: 0, opts: 0, argDesc: 0, args: 12, mWhen: 40, mLegacy: 40, mIo: 0, stDesc: 60 },
  { desc: 50, doc: 0, opts: 0, argDesc: 0, args: 6, mWhen: 24, mLegacy: 24, mIo: 0, stDesc: 0 },
];

function shape(tool, lv) {
  return {
    id: tool.id,
    desc: clip(tool.desc, lv.desc),
    entry: tool.entry,
    script: tool.script,
    dir: tool.dir,
    ...(lv.doc ? { doc: clip(tool.doc, lv.doc) } : {}),
    ...(lv.opts ? { opts: tool.opts.slice(0, lv.opts) } : {}),
    a: tool.args.slice(0, lv.args).map((a) => `${a.name}:${a.type}${a.required ? "*" : ""}`),
    ...(tool.args.length > lv.args ? { aMore: tool.args.length - lv.args } : {}),
    out: tool.out,
    tags: tool.tags,
    net: tool.net,
    sec: tool.sec,
    ...(tool.optSec?.length ? { osec: tool.optSec } : {}),
    ...(tool.layer ? { ly: tool.layer } : {}),
    to: tool.to,
    en: tool.en,
    ...(tool.modes?.length
      ? {
          m: tool.modes.map((m) => ({
            id: m.id,
            p: m.purpose,
            w: clip(m.when, lv.mWhen),
            lg: clip(m.legacy, lv.mLegacy),
            ...(lv.mIo ? { io: clip(`${m.ioIn} → ${m.ioOut}`, lv.mIo) } : {}),
          })),
        }
      : {}),
    mod: tool.mod,
  };
}

const bytes = (o) => Buffer.byteLength(JSON.stringify(o), "utf8");

/** 스튜디오 도구 → 보고용(짧은 키). 결과 종류별 배경·방식 목록·기본 방식 */
function shapeStudio(list, lv) {
  return list.map((s) => ({
    id: s.id,
    title: clip(s.title, 40),
    ...(lv.stDesc ? { desc: clip(s.desc, lv.stDesc) } : {}),
    mo: s.methodOrder,
    ro: s.refOrder,
    rm: s.refsMax,
    k: s.kinds.map((k) => ({ id: k.id, l: clip(k.label, 30), ...(lv.stDesc ? { o: clip(k.output, 40) } : {}), bg: clip(k.background, 20), def: k.defaultMethod, m: k.methods })),
  }));
}

/** 도구 목록 → 8KB 이하 보고서. 단계별로 줄이고, 그래도 크면 뒤쪽 도구를 자른다(omitted) */
export function fitReport(tools, base, limit = TOOLKIT_BODY_BYTES, studio = []) {
  const head = (lv) => ({ ...base, ...(studio.length ? { studio: shapeStudio(studio, lv) } : {}) });
  for (const lv of LEVELS) {
    const report = { ...head(lv), count: tools.length, tools: tools.map((t) => shape(t, lv)) };
    if (bytes(report) <= limit) return report;
  }
  const lv = LEVELS[LEVELS.length - 1];
  let shown = tools.map((t) => shape(t, lv));
  while (shown.length > 0 && bytes({ ...head(lv), count: tools.length, omitted: tools.length - shown.length, tools: shown }) > limit) shown = shown.slice(0, -1);

  return { ...head(lv), count: tools.length, omitted: tools.length - shown.length, tools: shown };
}

const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);

/** 툴킷의 프로젝트 설정 스키마(schemas/project-settings.schema.json) 지문: 키를 정렬한 JSON 의 sha256 앞 16자. 없거나 못 읽으면 "". 홈페이지 사본과 다른지 비교하는 데만 쓴다 */
export function projectSettingsSchemaHash(toolkitDir) {
  try {
    const f = readInside(toolkitDir, "schemas/project-settings.schema.json");
    if (!f) return "";
    return createHash("sha256").update(JSON.stringify(stable(JSON.parse(f.text.replace(/^﻿/, ""))))).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

/** 툴킷 폴더 → 보고서. { state: ok|missing|error, ... }. 던지지 않는다 */
export function collectToolkitInfo(toolkitDir) {
  const file = path.join(toolkitDir || "", "tools.json");
  try {
    if (!toolkitDir || !fs.existsSync(file)) return { state: "missing", count: 0, tools: [] };
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_FILE_BYTES) return { state: "error", reason: "tools.json 이 실제 파일이 아니거나 너무 커요.", count: 0, tools: [] };
    const manifest = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    if (!manifest || typeof manifest !== "object" || !manifest.tools || typeof manifest.tools !== "object" || Array.isArray(manifest.tools)) {
      return { state: "error", reason: "tools.json 형식이 맞지 않아요.", count: 0, tools: [] };
    }
    const entries = Object.entries(manifest.tools).filter(([id, t]) => ID_RE.test(id) && t && typeof t === "object").slice(0, MAX_TOOLS);
    const scans = new Map(); // 진입 파일마다 한 번만 훑는다
    const tools = entries.map(([id, t]) => {
      const entryRel = typeof t.entry === "string" ? t.entry : "";
      if (!scans.has(entryRel)) {
        const f = entryRel ? readInside(toolkitDir, entryRel) : null;
        scans.set(entryRel, { file: f, scan: scanEntry(f?.text ?? "") });
      }
      const { file: entryFile, scan } = scans.get(entryRel);
      return describeTool(toolkitDir, id, t, scan, entryFile);
    });

    const psh = projectSettingsSchemaHash(toolkitDir);
    return fitReport(tools, { state: "ok", manifestMod: new Date(st.mtimeMs).toISOString().slice(0, 10), ...(psh ? { psh } : {}) }, TOOLKIT_BODY_BYTES, readStudioTools(manifest.studioTools));
  } catch (e) {
    return { state: "error", reason: clip(e?.message ?? "읽지 못했어요.", 120), count: 0, tools: [] };
  }
}

/** 감독 프로그램이 부른다. 처음 한 번, 그 뒤 10분마다 확인해 바뀌었거나 1시간이 지났으면 보낸다. 반환: stop() */
export function startToolkitReport({ api, log = () => {}, toolkitDir, everyMs = TOOLKIT_REPORT_EVERY_MS, resendMs = TOOLKIT_RESEND_MS } = {}) {
  let lastSig = "";
  let lastAt = 0;
  let busy = false;
  let fails = 0;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const report = collectToolkitInfo(typeof toolkitDir === "function" ? toolkitDir() : toolkitDir);
      const sig = JSON.stringify(report);
      if (sig === lastSig && Date.now() - lastAt < resendMs) return;
      const r = await api("POST", "/api/factory/device-stats", { device: "main-pc", toolkit: report }, { timeoutMs: POST_TIMEOUT_MS });
      if (r?.status === 200) {
        lastSig = sig;
        lastAt = Date.now();
        fails = 0;
      } else if (fails++ % 10 === 0) log(`툴킷 도구 목록 보내기 실패: ${r?.status ?? "응답 없음"} ${r?.data?.message ?? ""}`.trim());
    } catch (e) {
      if (fails++ % 10 === 0) log(`툴킷 도구 목록 보내기 실패: ${e?.name === "TimeoutError" ? "시간 초과" : "연결 안 됨"}`);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(tick, 8000);
  const id = setInterval(tick, everyMs);
  first.unref?.();
  id.unref?.();
  return { stop: () => (clearTimeout(first), clearInterval(id)), tick };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "once") {
    console.error("사용법: node toolkitinfo.mjs once [툴킷폴더]   (감독 프로그램이 알아서 보내요)");
    process.exitCode = 2;
  } else {
    const report = collectToolkitInfo(path.resolve(process.argv[3] ?? "game-toolkit"));
    console.log(JSON.stringify(report, null, 2));
    console.error(`도구 ${report.count}개, 본문 ${bytes({ device: "main-pc", toolkit: report })}바이트`);
  }
}
