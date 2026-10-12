#!/usr/bin/env node
// AI 쪽 도구 요청 도우미 (외부 의존 없음). 앱 폴더에서 실행한다.
// 요청서(.factory/requests/<id>.json)를 쓰고, 감독 프로그램이 응답(.factory/responses/<id>.json)을 쓸 때까지 이 명령 안에서 기다린다.
//
//   node toolreq.mjs submit --tool <이름> --args-file <json> [--id <요청ID>] [--timeout-sec 300] [--dir <앱폴더>]
//   node toolreq.mjs wait --id <요청ID> [--timeout-sec 300] [--dir <앱폴더>]   (끊긴 기다림 이어서)
//   node toolreq.mjs status --id <요청ID> [--dir <앱폴더>]                    (기다리지 않고 지금 상태만)
// 출력 마지막 줄: TOOLREQ {"id","status","response","message"} (status: ok|denied|failed|timeout|pending)
// 종료 코드: ok 0, denied·failed 1, timeout·pending 2, 사용법 오류 64
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const DEFAULT_WAIT_SEC = 300;
const MAX_WAIT_SEC = 1800;
const POLL_MS = 1000;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOOL_RE = /^[a-z][a-z0-9_.-]{0,39}$/;
const MAX_REQUEST_BYTES = 16 * 1024;

function usage(msg) {
  if (msg) console.error(msg);
  console.error("사용법: node toolreq.mjs submit --tool <이름> --args-file <json> [--id <요청ID>] [--timeout-sec 300]\n       node toolreq.mjs wait --id <요청ID> [--timeout-sec 300]\n       node toolreq.mjs status --id <요청ID>");
  process.exit(64);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m || i + 1 >= argv.length) usage(`알 수 없는 인자: ${argv[i]}`);
    out[m[1]] = argv[++i];
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finish(id, status, response, message) {
  console.log(`TOOLREQ ${JSON.stringify({ id, status, response, message })}`);
  process.exit(status === "ok" ? 0 : status === "denied" || status === "failed" ? 1 : 2);
}

function readResponse(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    return r && typeof r === "object" ? r : null;
  } catch {
    return null; // 아직 없음(감독은 다 쓴 뒤 이름을 바꿔서 놓는다)
  }
}

async function waitFor(dir, id, waitSec, once = false) {
  const file = path.join(dir, ".factory", "responses", `${id}.json`);
  const rel = path.relative(process.cwd(), file) || file;
  const until = Date.now() + waitSec * 1000;
  for (;;) {
    const r = readResponse(file);
    if (r) {
      if (Array.isArray(r.files) && r.files.length) console.log(`만든 파일: ${r.files.join(", ")}`);
      finish(id, ["ok", "denied", "failed", "timeout"].includes(r.status) ? r.status : "failed", rel, String(r.message ?? ""));
    }
    if (once) finish(id, "pending", rel, "아직 응답이 없어요.");
    if (Date.now() >= until) finish(id, "timeout", rel, `${waitSec}초 안에 응답이 없어요. 'wait --id ${id}' 로 더 기다릴 수 있어요(통제실의 도구 요청 중계가 꺼져 있을 수도 있어요).`);
    await sleep(POLL_MS);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (!["submit", "wait", "status"].includes(cmd)) usage();
const a = parseArgs(rest);
const dir = path.resolve(a.dir ?? process.cwd());
if (!fs.existsSync(path.join(dir, ".factory"))) usage(`앱 폴더가 아니에요(.factory 없음): ${dir}`);
const waitSec = a["timeout-sec"] === undefined ? DEFAULT_WAIT_SEC : Math.floor(Number(a["timeout-sec"]));
if (!Number.isFinite(waitSec) || waitSec < 1) usage("--timeout-sec 는 1 이상의 숫자예요.");
const wait = Math.min(MAX_WAIT_SEC, waitSec);

if (cmd === "submit") {
  if (!a.tool || !TOOL_RE.test(a.tool)) usage("--tool 이름이 필요해요(예: echo, toolkit.run).");
  let args = {};
  if (a["args-file"]) {
    try {
      args = JSON.parse(fs.readFileSync(path.resolve(a["args-file"]), "utf8").replace(/^﻿/, ""));
    } catch (e) {
      usage(`--args-file 을 JSON 으로 읽지 못했어요: ${e.message}`);
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) usage("--args-file 의 내용은 JSON 객체여야 해요.");
  }
  const id = a.id ?? `req-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  if (!ID_RE.test(id)) usage("--id 는 영문·숫자·_- 64자까지예요.");
  const body = JSON.stringify({ id, tool: a.tool, args }, null, 2) + "\n";
  if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) usage(`요청서가 너무 커요(${MAX_REQUEST_BYTES}바이트까지).`);
  const reqDir = path.join(dir, ".factory", "requests");
  fs.mkdirSync(reqDir, { recursive: true });
  const file = path.join(reqDir, `${id}.json`);
  if (fs.existsSync(file)) usage(`같은 id 의 요청서가 이미 있어요: ${id}. 'wait --id ${id}' 로 기다리세요.`);
  // 다 쓴 뒤 이름을 바꿔 놓는다(감독이 반쯤 쓴 파일을 읽지 않게)
  const tmp = path.join(reqDir, `.${id}.tmp`);
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);
  console.log(`요청을 보냈어요: ${id} (${a.tool}). 응답을 최대 ${wait}초 기다려요.`);
  await waitFor(dir, id, wait);
} else {
  if (!a.id || !ID_RE.test(a.id)) usage("--id 가 필요해요.");
  await waitFor(dir, a.id, wait, cmd === "status");
}
