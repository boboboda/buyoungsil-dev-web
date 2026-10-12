#!/usr/bin/env node
// Both providers use this queue bridge. It never launches an AI or approves/deploys work.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { redactAiText } from "./ai-runner.mjs";

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const engines = ["claude", "codex"];
const expand = p => p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;

export function parseFactoryPrompt(prompt) {
  if (typeof prompt !== "string") return null;
  const prefix = /^(?:공장:|factory:|\/factory(?:\s|$))/.exec(prompt);
  if (!prefix) return null;
  const rest = prompt.slice(prefix[0].length).trim();
  const status = /^status\s+([A-Za-z0-9_-]{1,40})$/.exec(rest);
  if (status) return { action: "status", threadId: status[1] };
  let text = rest;
  let aiEngine;
  const engine = /^(claude|codex|default)(?:\s|$)/.exec(text);
  if (engine) { aiEngine = engine[1] === "default" ? undefined : engine[1]; text = text.slice(engine[0].length).trim(); }
  let threadId;
  const thread = /^--thread\s+([A-Za-z0-9_-]{1,40})(?:\s|$)/.exec(text);
  if (thread) { threadId = thread[1]; text = text.slice(thread[0].length).trim(); }
  if (text.startsWith("--") || text.length < 5 || text.length > 8000) throw new Error("사용법: 공장: [claude|codex|default] [--thread 정비ID] 지시내용(5~8000자), 공장: status 정비ID");
  return { action: "submit", text, ...(aiEngine ? { aiEngine } : {}), ...(threadId ? { threadId } : {}) };
}

export function hookRequestId(provider, event, nonce = randomUUID()) {
  // Provider + session + turn is the identity. No raw instruction is written to a receipt.
  return createHash("sha256").update(JSON.stringify([provider, event.session_id || "", event.turn_id || nonce, event.prompt || ""])).digest("hex");
}

export function readBridgeConfig(env = process.env) {
  const cfg = JSON.parse(fs.readFileSync(expand(env.FACTORY_CONFIG || "~/dev/factory/supervisor.config.json"), "utf8"));
  const url = new URL(cfg.serverUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("훅 서버 주소는 HTTPS 또는 로컬 HTTP여야 해요.");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("훅 서버 주소는 인증정보 없는 서버 origin이어야 해요.");
  if (typeof cfg.token !== "string" || cfg.token.length < 16) throw new Error("기존 작업 PC 연결 설정이 필요해요.");
  return { origin: url.origin, token: cfg.token };
}

export async function bridgeRequest(cfg, action, body, transport = fetch) {
  const url = new URL("/api/factory/hooks", cfg.origin);
  if (action === "status") url.searchParams.set("threadId", body.threadId);
  const res = await transport(url, { method: action === "submit" ? "POST" : "GET", headers: { Authorization: `Bearer ${cfg.token}`, ...(action === "submit" ? { "Content-Type": "application/json" } : {}) }, ...(action === "submit" ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `훅 연결 실패 (${res.status})`);
  return data;
}

async function readInput(input) {
  let text = "";
  for await (const chunk of input) {
    text += chunk;
    if (Buffer.byteLength(text) > 64 * 1024) throw new Error("훅 입력이 너무 커요.");
  }
  return text;
}

function receiptNonce(provider, event) {
  if (event.turn_id) return event.turn_id;
  if (event.transcript_path) {
    try { const s = fs.statSync(event.transcript_path); return `${s.size}:${s.mtimeMs}`; } catch { /* no transcript */ }
  }
  // Claude without a turn id: persist a short retry window so a timed-out submission
  // can be retried without creating two instructions. An intentional later repeat is new.
  const key = createHash("sha256").update(JSON.stringify([provider, event.session_id, event.prompt])).digest("hex");
  const root = expand("~/dev/factory/hook-receipts");
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, `${key}.json`);
  try { const old = JSON.parse(fs.readFileSync(file, "utf8")); if (Date.now() - old.at < 60000) return old.nonce; } catch { /* first event */ }
  const nonce = randomUUID();
  fs.writeFileSync(file, JSON.stringify({ nonce, at: Date.now() }), { mode: 0o600 });
  return nonce;
}

export async function runBridge(argv, input, output, error, env = process.env) {
  const native = argv.includes("--hook");
  const providerAt = argv.indexOf("--provider");
  const provider = providerAt >= 0 ? argv[providerAt + 1] : "codex";
  if (!engines.includes(provider)) throw new Error("훅 제공자는 claude 또는 codex여야 해요.");
  const raw = native || argv[0] === "submit" ? await readInput(input) : "";
  let request;
  let event;
  if (native) {
    event = JSON.parse(raw);
    // Supervisor tasks must not recursively turn their own prompts into new jobs.
    if (env.FACTORY_LAUNCHER === "1") return 0;
    if (event.hook_event_name === "SessionStart") {
      try {
        const info = await bridgeRequest(readBridgeConfig(env), "settings", {});
        output(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `앱 공장 주사용 AI: ${info.defaultAiEngine}. 공장: [claude|codex|default] 지시내용으로 공장 정비를 등록할 수 있습니다. 등록 후 통제실 승인과 감독 실행을 기다리며 이 세션에서 중복 실행하지 않습니다. 공장: status 정비ID로 결과를 조회합니다.` } }));
      } catch { output(JSON.stringify({ systemMessage: "공장 훅 연결을 확인하지 못했습니다. 일반 대화는 계속할 수 있습니다." })); }
      return 0;
    }
    if (event.hook_event_name !== "UserPromptSubmit") return 0;
    // Never read credentials or call the server for ordinary conversation.
    request = parseFactoryPrompt(event.prompt);
    if (!request) return 0;
  } else {
    const action = argv[0];
    if (action === "status") {
      if (!ID.test(argv[1] || "")) throw new Error("정비 ID를 적어 주세요.");
      request = { action: "status", threadId: argv[1] };
    } else if (action === "submit") {
      let aiEngine, threadId, requestId;
      for (let i = 1; i < argv.length; i += 2) {
        const key = argv[i], value = argv[i + 1];
        if (key === "--provider") continue;
        if (key === "--ai" && [...engines, "default"].includes(value)) aiEngine = value === "default" ? undefined : value;
        else if (key === "--thread" && ID.test(value || "")) threadId = value;
        else if (key === "--request-id" && /^[A-Za-z0-9_-]{16,100}$/.test(value || "")) requestId = value;
        else throw new Error("사용법: factory-hook.mjs submit [--ai claude|codex|default] [--thread 정비ID] [--request-id 요청ID] (지시는 stdin)");
      }
      if (raw.trim().length < 5 || raw.length > 8000) throw new Error("지시를 5~8000자로 적어 주세요.");
      request = { action, text: raw.trim(), aiEngine, threadId, requestId };
    } else throw new Error("factory-hook.mjs submit 또는 status 정비ID를 사용하세요.");
  }
  const cfg = readBridgeConfig(env);
  const safe = s => redactAiText(String(s), { ...env, FACTORY_WORKER_TOKEN: cfg.token });
  try {
    const { action, ...body } = request;
    const data = await bridgeRequest(cfg, action, action === "submit" ? { ...body, text: safe(body.text), provider, requestId: body.requestId || (native ? hookRequestId(provider, event, receiptNonce(provider, event)) : randomUUID()) } : body);
    if (native) {
      const message = action === "submit" ? `${data.message} AI: ${data.aiEngine}, 정비: ${data.threadId}, 지시: ${data.turnId}.` : JSON.stringify(data);
      // Block the tagged prompt after handing it off so the current AI does not also execute it.
      output(JSON.stringify({ decision: "block", reason: safe(message) }));
      return 0;
    }
    output(safe(JSON.stringify(data)));
    return 0;
  } catch (e) {
    const reason = safe(`공장 훅 처리 실패: ${e.message}. 지시를 현재 세션에서 대신 실행하지 마세요.`);
    if (native) { output(JSON.stringify({ decision: "block", reason })); return 0; }
    error(reason); return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBridge(process.argv.slice(2), process.stdin, console.log, console.error).then(code => { process.exitCode = code; }).catch(e => {
    // Tagged hook failures must not leak into normal AI execution, even before config is loaded.
    if (process.argv.includes("--hook")) { console.log(JSON.stringify({ decision: "block", reason: "공장 훅 입력 또는 연결 설정 오류입니다. 이 지시를 직접 실행하지 말고 작업 PC 연결 설정을 확인하세요." })); }
    else { console.error("공장 훅 입력 또는 연결 설정을 확인하세요."); process.exitCode = 1; }
  });
}
