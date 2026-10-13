#!/usr/bin/env node
// 작업 PC 에서 AI 구독 한도 사용률을 홈페이지 [사용량] 탭으로 보낸다. 감독 프로그램과는 따로 돈다.
//
//   node ai-limits.mjs statusline     Claude Code 상태줄(statusLine) 명령. stdin JSON 의 rate_limits 만 읽어
//                                     "5h 23% · 7d 41%" 를 출력하고, 값이 바뀌었거나 5분이 지났으면 서버로 보낸다.
//   node ai-limits.mjs codex [--once] Codex 사용량(비공식 chatgpt.com/backend-api/wham/usage)을 5분마다 읽어 보낸다.
//                                     실패하거나 응답 형식이 다르면 "수집 실패"만 보낸다.
//   node ai-limits.mjs check          필요한 환경변수가 있는지만 알려준다(값은 출력하지 않음).
//
// 환경변수(상태 훅과 같음): CLAUDE_STATUS_URL(…/api/claude-status), CLAUDE_STATUS_TOKEN, CLAUDE_DEVICE_NAME
//   보낼 주소는 CLAUDE_STATUS_URL 뒤에 /limits 를 붙인다. AI_LIMITS_URL 이 있으면 그걸 쓴다.
// 서버로는 사용률(%)과 초기화 시각(유닉스 초)만 보낸다. Codex 토큰은 서버로 보내지 않고 출력·로그에도 남기지 않는다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEND_EVERY_MS = 5 * 60 * 1000;
const CODEX_EVERY_MS = 5 * 60 * 1000;
const POST_TIMEOUT_MS = 3000;
const CODEX_TIMEOUT_MS = 15000;
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

const isObj = v => typeof v === "object" && v !== null && !Array.isArray(v);
const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function limitsUrl(env = process.env) {
  if (env.AI_LIMITS_URL) return env.AI_LIMITS_URL;
  if (!env.CLAUDE_STATUS_URL) return null;
  try {
    const u = new URL(env.CLAUDE_STATUS_URL);
    u.pathname = u.pathname.replace(/\/+$/, "") + "/limits";
    return u.toString();
  } catch {
    return null;
  }
}

// 창 하나 → { usedPct, resetsAt(초) } 또는 null
function windowOf(w) {
  if (!isObj(w)) return null;
  const usedPct = num(w.used_percentage);
  const resetsAt = num(w.resets_at);
  if (usedPct === null || resetsAt === null) return null;
  return { usedPct, resetsAt };
}

// Claude Code 상태줄 입력에서 rate_limits 만 뽑는다. 창마다 없을 수 있다.
export function parseClaudeStatusline(input) {
  const rl = isObj(input) ? input.rate_limits : null;
  if (!isObj(rl)) return null;
  const fiveHour = windowOf(rl.five_hour);
  const sevenDay = windowOf(rl.seven_day);
  if (!fiveHour && !sevenDay) return null;
  return { fiveHour, sevenDay };
}

export function statuslineText(limits) {
  if (!limits) return "";
  const parts = [];
  if (limits.fiveHour) parts.push(`5h ${Math.round(limits.fiveHour.usedPct)}%`);
  if (limits.sevenDay) parts.push(`7d ${Math.round(limits.sevenDay.usedPct)}%`);
  return parts.join(" · ");
}

// 값이 같으면 같은 문자열. 이걸로 "바뀌었을 때만 보내기"를 한다.
export const limitsSignature = l =>
  [l.fiveHour, l.sevenDay].map(w => (w ? `${Math.round(w.usedPct)}@${Math.round(w.resetsAt)}` : "-")).join("|");

// Codex 사용량 응답 → { fiveHour, sevenDay } 또는 null(형식이 다름).
// 알려진 형식: { rate_limit: { primary_window: { used_percent, limit_window_seconds, reset_at | reset_after_seconds }, secondary_window: {...} } }
export function parseCodexUsage(json, nowMs = Date.now()) {
  const rl = isObj(json) ? json.rate_limit : null;
  if (!isObj(rl)) return null;
  const out = { fiveHour: null, sevenDay: null };
  const slots = [["primary_window", "fiveHour"], ["secondary_window", "sevenDay"]];
  for (const [key, fallback] of slots) {
    const w = rl[key];
    if (!isObj(w)) continue;
    const usedPct = num(w.used_percent);
    const after = num(w.reset_after_seconds);
    const resetsAt = num(w.reset_at) ?? (after !== null ? Math.round(nowMs / 1000 + after) : null);
    if (usedPct === null || resetsAt === null || usedPct < 0) continue;
    const len = num(w.limit_window_seconds);
    // 창 길이가 있으면 그걸로 5시간/7일을 고른다. 없으면 primary=5시간, secondary=7일.
    const slot = len === null ? fallback : len <= 6 * 3600 ? "fiveHour" : len >= 6 * 86400 ? "sevenDay" : null;
    if (slot && !out[slot]) out[slot] = { usedPct: Math.min(100, usedPct), resetsAt };
  }
  return out.fiveHour || out.sevenDay ? out : null;
}

function device(env = process.env) {
  return env.CLAUDE_DEVICE_NAME || os.hostname() || "unknown";
}

async function postLimits(body, env = process.env) {
  const url = limitsUrl(env);
  const token = env.CLAUDE_STATUS_TOKEN;
  if (!url || !token) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, device: device(env) }),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Claude 상태줄 ─────────────────────────────
const stampFile = () => path.join(os.tmpdir(), "ai-limits-statusline.json");

function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(stampFile(), "utf8"));
  } catch {
    return {};
  }
}

async function runStatusline() {
  let input = null;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    /* 입력이 없거나 깨졌으면 빈 줄 */
  }
  const limits = parseClaudeStatusline(input);
  // 화면 출력을 먼저 한다. 보내기는 그다음(실패해도 상태줄에는 영향 없음).
  process.stdout.write(statuslineText(limits) + "\n");
  if (!limits) return;

  const sig = limitsSignature(limits);
  const stamp = readStamp();
  if (stamp.sig === sig && Date.now() - (stamp.at || 0) < SEND_EVERY_MS) return;

  if (await postLimits({ provider: "claude", status: "ok", ...limits })) {
    try {
      fs.writeFileSync(stampFile(), JSON.stringify({ sig, at: Date.now() }));
    } catch {
      /* 무시 */
    }
  }
}

// ── Codex 수집 ────────────────────────────────
function readCodexAuth(env = process.env) {
  const home = env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const auth = JSON.parse(fs.readFileSync(path.join(home, "auth.json"), "utf8"));
  const tokens = isObj(auth) && isObj(auth.tokens) ? auth.tokens : null;
  if (!tokens || typeof tokens.access_token !== "string" || !tokens.access_token) throw new Error("auth.json 에 ChatGPT 로그인 토큰이 없음");
  return { accessToken: tokens.access_token, accountId: typeof tokens.account_id === "string" ? tokens.account_id : null };
}

// 한 번 읽어서 보낸다. 반환: "ok" | 실패 이유(토큰 값은 절대 넣지 않음)
export async function collectCodexOnce({ env = process.env, fetchImpl = fetch, post = postLimits } = {}) {
  let reason = null;
  let limits = null;
  try {
    const { accessToken, accountId } = readCodexAuth(env);
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "codex-limits" };
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;
    const res = await fetchImpl(CODEX_USAGE_URL, { headers, signal: AbortSignal.timeout(CODEX_TIMEOUT_MS) });
    if (!res.ok) reason = `HTTP ${res.status}`;
    else {
      limits = parseCodexUsage(await res.json().catch(() => null));
      if (!limits) reason = "응답 형식이 다름";
    }
  } catch (e) {
    reason = e?.code === "ENOENT" ? "auth.json 없음" : e?.name === "TimeoutError" ? "시간 초과" : "읽기 실패";
  }
  const body = limits ? { provider: "codex", status: "ok", ...limits } : { provider: "codex", status: "failed" };
  const sent = await post(body, env);
  return { result: limits ? "ok" : reason, sent };
}

async function runCodex(once) {
  for (;;) {
    const { result, sent } = await collectCodexOnce().catch(() => ({ result: "알 수 없는 오류", sent: false }));
    console.log(`[${new Date().toLocaleTimeString("ko-KR", { hour12: false })}] codex 한도: ${result === "ok" ? "읽음" : `수집 실패(${result})`} · 서버 전송 ${sent ? "됨" : "안 됨"}`);
    if (once) return;
    await new Promise(r => setTimeout(r, CODEX_EVERY_MS));
  }
}

function runCheck(env = process.env) {
  const has = k => (env[k] ? "있음" : "없음");
  console.log(`CLAUDE_STATUS_URL: ${has("CLAUDE_STATUS_URL")}, CLAUDE_STATUS_TOKEN: ${has("CLAUDE_STATUS_TOKEN")}, CLAUDE_DEVICE_NAME: ${has("CLAUDE_DEVICE_NAME")}`);
  console.log(`보낼 주소: ${limitsUrl(env) ? "정해짐" : "없음(CLAUDE_STATUS_URL 확인)"}`);
  const home = env.CODEX_HOME || path.join(os.homedir(), ".codex");
  console.log(`Codex auth.json: ${fs.existsSync(path.join(home, "auth.json")) ? "있음" : "없음"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const run = cmd === "statusline" ? runStatusline() : cmd === "codex" ? runCodex(rest.includes("--once")) : cmd === "check" ? Promise.resolve(runCheck()) : null;
  if (!run) {
    console.error("사용법: node ai-limits.mjs statusline | codex [--once] | check");
    process.exitCode = 2;
  } else {
    run.catch(() => {
      // 상태줄·수집 실패가 다른 걸 막지 않게 조용히 끝낸다
    });
  }
}
