#!/usr/bin/env node
// 작업 PC 에서 AI 구독 한도 사용률을 홈페이지 [사용량] 탭으로 보낸다. 감독 프로그램과는 따로 돈다.
//
//   node ai-limits.mjs statusline     Claude Code 상태줄(statusLine) 명령. stdin JSON 의 rate_limits 만 읽어
//                                     "5h 23% · 7d 41%" 를 출력하고, 값이 바뀌었거나 5분이 지났으면 서버로 보낸다.
//   node ai-limits.mjs codex [--once] Codex 사용량(비공식 chatgpt.com/backend-api/wham/usage)을 5분마다 읽어 보낸다.
//                                     실패하거나 응답 형식이 다르면 "수집 실패"만 보낸다.
//   node ai-limits.mjs all [--once]   Claude(비공식 api.anthropic.com/api/oauth/usage, 화면 없이) + Codex 를 한 번에 읽어 보낸다.
//                                     작업 스케줄러가 5분마다 --once 로 부른다. 감독 프로그램도 일감·정비가 끝날 때 같은 일을 한다.
//                                     잠금 파일 + 최소 간격 60초라 동시에 두 번 돌아도 한 번만 읽는다. 429/401 이면 5분→15분→30분 쉰다.
//   node ai-limits.mjs check          필요한 환경변수가 있는지만 알려준다(값은 출력하지 않음).
//
// 환경변수(상태 훅과 같음): CLAUDE_STATUS_URL(…/api/claude-status), CLAUDE_STATUS_TOKEN, CLAUDE_DEVICE_NAME
//   보낼 주소는 CLAUDE_STATUS_URL 뒤에 /limits 를 붙인다. AI_LIMITS_URL 이 있으면 그걸 쓴다.
// 서버로는 사용률(%)과 초기화 시각(유닉스 초)만 보낸다. Claude·Codex 토큰은 서버로 보내지 않고 출력·로그에도 남기지 않는다.
// Claude 토큰이 만료됐으면 갱신하지 않고 '로그인 필요' 로 보고한다(Claude Code 를 한 번 쓰면 Claude Code 가 갱신한다).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEND_EVERY_MS = 5 * 60 * 1000;
const CODEX_EVERY_MS = 5 * 60 * 1000;
const POST_TIMEOUT_MS = 3000;
const CODEX_TIMEOUT_MS = 15000;
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CLAUDE_TIMEOUT_MS = 10000;
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const LOGIN_NEEDED = "로그인 필요(Claude Code 를 한 번 쓰면 갱신돼요)";
export const BACKOFF_STEPS_MS = [5, 15, 30].map(m => m * 60 * 1000);
export const MIN_GAP_MS = 60 * 1000;
const LOCK_STALE_MS = 2 * 60 * 1000;
const STREAM_FRESH_MS = 10 * 60 * 1000;
const REFRESH_TIMEOUT_MS = 15000;
const MAX_EXTRA = 8;

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

  if (await postLimits({ provider: "claude", source: "statusline", status: "ok", measuredAt: Math.round(Date.now() / 1000), ...limits })) {
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
// skipIfNoAuth: auth.json 이 없으면(Codex 를 안 씀) 실패를 보내지 않고 건너뛴다('all' 에서 씀)
export async function collectCodexOnce({ env = process.env, fetchImpl = fetch, post = postLimits, skipIfNoAuth = false } = {}) {
  let reason = null;
  let limits = null;
  if (skipIfNoAuth && !fs.existsSync(path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "auth.json"))) return { result: "auth.json 없음(건너뜀)", sent: false, skipped: true };
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
  const measuredAt = Math.round(Date.now() / 1000);
  const body = limits ? { provider: "codex", source: "auto", status: "ok", measuredAt, ...limits } : { provider: "codex", source: "auto", status: "failed", reason };
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

// ── Claude 자동 수집(화면 없이) ─────────────────
// 시각 → 유닉스 초. ISO 문자열, 초, 밀리초(1e12 넘음) 모두 받는다.
export function toEpochSec(v) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v > 1e12 ? v / 1000 : v);
  if (typeof v !== "string" || !v.trim()) return null;
  if (/^\d+(\.\d+)?$/.test(v.trim())) return toEpochSec(Number(v));
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

const utilOf = w => (isObj(w) ? (num(w.utilization) ?? num(w.used_percent) ?? num(w.percent)) : null);

// api/oauth/usage 응답 → { fiveHour, sevenDay, extra:[{ key, usedPct, resetsAt|null }] } 또는 null(형식이 다름).
// 커뮤니티 도구 기준 형식이라 방어적으로 읽는다: 창이 없거나 값이 이상하면 그 창만 건너뛴다.
// 사용률은 0~100. 응답의 값이 모두 0~1 이고 소수가 있으면 0~1 로 보고 100 을 곱한다.
// extra: seven_day_opus 같은 모델별 주간 창(키 그대로) + limits[] 의 weekly_scoped 항목("weekly_scoped · Fable").
export function parseClaudeUsage(json) {
  if (!isObj(json) || (!isObj(json.five_hour) && !isObj(json.seven_day))) return null;
  const extraKeys = Object.keys(json).filter(k => /^seven_day_[a-z0-9_]+$/.test(k) && isObj(json[k]));
  const all = [json.five_hour, json.seven_day, ...extraKeys.map(k => json[k])].map(utilOf).filter(v => v !== null);
  const scale = all.length > 0 && all.every(v => v >= 0 && v <= 1) && all.some(v => !Number.isInteger(v)) ? 100 : 1;
  const pct = v => (v === null || v < 0 ? null : Math.min(100, Math.round(v * scale * 10) / 10));
  const win = w => {
    const usedPct = pct(utilOf(w));
    const resetsAt = isObj(w) ? toEpochSec(w.resets_at ?? w.reset_at ?? w.resetsAt) : null;
    return usedPct === null || resetsAt === null ? null : { usedPct, resetsAt };
  };
  const extra = [];
  for (const k of extraKeys) {
    const usedPct = pct(utilOf(json[k]));
    if (usedPct !== null) extra.push({ key: k, usedPct, resetsAt: toEpochSec(json[k].resets_at) });
  }
  for (const l of Array.isArray(json.limits) ? json.limits : []) {
    if (!isObj(l) || l.kind !== "weekly_scoped") continue;
    const scope = isObj(l.scope) ? l.scope : {};
    const name = [isObj(scope.model) ? scope.model.display_name : null, isObj(scope.surface) ? scope.surface.display_name : scope.surface].find(v => typeof v === "string" && v.trim());
    const usedPct = num(l.percent);
    if (!name || usedPct === null || usedPct < 0) continue;
    extra.push({ key: `weekly_scoped · ${String(name).slice(0, 30)}`, usedPct: Math.min(100, usedPct), resetsAt: toEpochSec(l.resets_at) });
  }
  return { fiveHour: win(json.five_hour), sevenDay: win(json.seven_day), extra: extra.slice(0, MAX_EXTRA) };
}

// claude -p --output-format stream-json 의 rate_limit_event → { fiveHour, sevenDay } 또는 null.
// 확인한 형식(Claude Code 2.1.x): { type:"rate_limit_event", rate_limit_info:{ unifiedWindows:{ five_hour:{ utilization:0.09, resetsAt:초 }, seven_day:{…} } } }
// 여기서 utilization 은 0~1 이다(같은 시각 oauth/usage 의 9% = 0.09).
export function parseRateLimitEvent(ev) {
  const uw = isObj(ev) && ev.type === "rate_limit_event" && isObj(ev.rate_limit_info) ? ev.rate_limit_info.unifiedWindows : null;
  if (!isObj(uw)) return null;
  const win = w => {
    const u = isObj(w) ? num(w.utilization) : null;
    const resetsAt = isObj(w) ? toEpochSec(w.resetsAt ?? w.resets_at) : null;
    return u === null || u < 0 || resetsAt === null ? null : { usedPct: Math.min(100, Math.round(u * 1000) / 10), resetsAt };
  };
  const out = { fiveHour: win(uw.five_hour), sevenDay: win(uw.seven_day) };
  return out.fiveHour || out.sevenDay ? out : null;
}

// 감독 프로그램이 일감 출력에서 본 마지막 rate_limit_event. 자동 수집이 실패·쉬는 중일 때 대신 보낸다.
let lastStream = null;
export function noteRateLimitEvent(ev, now = Date.now()) {
  if (!isObj(ev) || ev.type !== "rate_limit_event") return;
  const limits = parseRateLimitEvent(ev);
  if (limits) lastStream = { at: now, limits };
}
export const latestStreamLimits = () => lastStream;

function readClaudeCredentials(env = process.env) {
  const dir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const cred = JSON.parse(fs.readFileSync(path.join(dir, ".credentials.json"), "utf8"));
  const o = isObj(cred) && isObj(cred.claudeAiOauth) ? cred.claudeAiOauth : null;
  if (!o || typeof o.accessToken !== "string" || !o.accessToken) throw Object.assign(new Error("no token"), { code: "NO_TOKEN" });
  return { accessToken: o.accessToken, expiresAt: num(o.expiresAt) };
}

// 429/401 이 이어진 횟수 → 쉬는 시간(5분→15분→30분)
export const backoffMs = fails => BACKOFF_STEPS_MS[Math.min(Math.max(fails, 1), BACKOFF_STEPS_MS.length) - 1];

// 한 번 읽어서 보낸다. state.claude 의 쉬는 시간을 지키고 갱신한다. 반환 result: "ok" | 실패 이유(토큰 값은 절대 넣지 않음)
export async function collectClaudeOnce({ env = process.env, fetchImpl = fetch, post = postLimits, now = Date.now(), state = {}, stream = latestStreamLimits() } = {}) {
  const prev = isObj(state.claude) ? state.claude : {};
  // 자동 수집이 안 될 때: 일감 출력에서 본 값이 10분 안이면 그걸 보낸다(서버가 더 최근 값과 비교)
  const sendStream = async () => (stream && now - stream.at <= STREAM_FRESH_MS ? post({ provider: "claude", source: "stream", status: "ok", measuredAt: Math.round(stream.at / 1000), ...stream.limits }, env) : false);
  if (prev.until && now < prev.until) {
    const streamSent = await sendStream();
    return { result: `쉬는 중(${prev.reason ?? "요청 제한"} · ${Math.ceil((prev.until - now) / 60000)}분 뒤 다시)`, sent: false, skipped: true, streamSent };
  }
  let reason = null;
  let limits = null;
  let backoff = false;
  try {
    const cred = readClaudeCredentials(env);
    if (cred.expiresAt !== null && cred.expiresAt <= now) reason = LOGIN_NEEDED;
    else {
      const headers = { Authorization: `Bearer ${cred.accessToken}`, "anthropic-beta": "oauth-2025-04-20", Accept: "application/json", "User-Agent": "claude-code-limits" };
      const res = await fetchImpl(CLAUDE_USAGE_URL, { headers, signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS) });
      if (res.status === 401 || res.status === 403) [reason, backoff] = [LOGIN_NEEDED, true];
      else if (res.status === 429) [reason, backoff] = ["HTTP 429 요청 제한", true];
      else if (!res.ok) reason = `HTTP ${res.status}`;
      else {
        limits = parseClaudeUsage(await res.json().catch(() => null));
        if (!limits) reason = "응답 형식이 다름";
        else if (!limits.fiveHour && !limits.sevenDay) [limits, reason] = [null, "한도 값 없음"];
      }
    }
  } catch (e) {
    reason = e?.code === "ENOENT" ? "credentials 없음(Claude Code 로그인 필요)" : e?.code === "NO_TOKEN" ? LOGIN_NEEDED : e?.name === "TimeoutError" ? "시간 초과" : "읽기 실패";
  }
  if (limits) {
    state.claude = {};
    const sent = await post({ provider: "claude", source: "auto", status: "ok", measuredAt: Math.round(now / 1000), ...limits }, env);
    return { result: "ok", sent };
  }
  if (backoff) {
    const fails = (prev.fails || 0) + 1;
    const wait = backoffMs(fails);
    state.claude = { fails, until: now + wait, reason };
    reason = `${reason} · ${Math.round(wait / 60000)}분 뒤 다시`;
  } else state.claude = {};
  const sent = await post({ provider: "claude", source: "auto", status: "failed", reason }, env);
  const streamSent = await sendStream();
  return { result: reason, sent, streamSent };
}

// ── 잠금·상태 파일 ─────────────────────────────
export const stateDir = (env = process.env) => env.AI_LIMITS_STATE_DIR || os.tmpdir();
const statePath = dir => path.join(dir, "ai-limits-state.json");
const lockPath = dir => path.join(dir, "ai-limits.lock");

export function readState(dir) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(dir), "utf8"));
    return isObj(s) ? s : {};
  } catch {
    return {};
  }
}

function writeState(dir, s) {
  try {
    fs.writeFileSync(statePath(dir), JSON.stringify(s));
  } catch {
    /* 상태를 못 써도 다음 실행이 다시 읽을 뿐 */
  }
}

// 잠금 파일을 만든다(이미 있으면 null). 2분 넘은 잠금은 끝나지 못한 실행의 흔적으로 보고 지운다.
export function acquireLock(dir, now = Date.now()) {
  const file = lockPath(dir);
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: now }), { flag: "wx" });
      return { release: () => fs.rmSync(file, { force: true }) };
    } catch (e) {
      if (e?.code !== "EEXIST") return null;
      let at = 0;
      try {
        at = Number(JSON.parse(fs.readFileSync(file, "utf8")).at) || fs.statSync(file).mtimeMs;
      } catch {
        at = 0;
      }
      if (now - at < LOCK_STALE_MS) return null;
      fs.rmSync(file, { force: true });
    }
  }
  return null;
}

// Claude + Codex 를 한 번 읽어 보낸다. 다른 실행이 잠금을 잡고 있거나 60초 안에 이미 돌았으면 건너뛴다.
export async function runAllOnce({ env = process.env, fetchImpl = fetch, post = postLimits, now = Date.now(), stream = latestStreamLimits() } = {}) {
  const dir = stateDir(env);
  const lock = acquireLock(dir, now);
  if (!lock) return { skipped: "다른 수집이 진행 중" };
  try {
    const state = readState(dir);
    if (typeof state.lastRunAt === "number" && now >= state.lastRunAt && now - state.lastRunAt < MIN_GAP_MS) return { skipped: "1분 안에 이미 읽음" };
    state.lastRunAt = now;
    writeState(dir, state);
    const fail = () => ({ result: "알 수 없는 오류", sent: false });
    const [claude, codex] = await Promise.all([
      collectClaudeOnce({ env, fetchImpl, post, now, state, stream }).catch(fail),
      collectCodexOnce({ env, fetchImpl, post, skipIfNoAuth: true }).catch(fail),
    ]);
    writeState(dir, state);
    return { claude, codex };
  } finally {
    lock.release();
  }
}

const partText = (name, r) => (!r ? "" : r.result === "ok" ? `${name} 성공${r.sent ? "" : "(서버 전송 안 됨)"}` : r.skipped && r.result?.startsWith("auth.json") ? "" : `${name} 실패(${r.result}${r.streamSent ? " · 일감 출력 값 보냄" : ""})`);

// 한 줄 요약: "AI 한도 갱신: Claude 성공 · Codex 실패(HTTP 401)"
export function summaryLine(r) {
  if (!r) return "AI 한도 갱신: 실패(알 수 없는 오류)";
  if (r.skipped) return `AI 한도 갱신: 건너뜀(${r.skipped})`;
  const parts = [partText("Claude", r.claude), partText("Codex", r.codex)].filter(Boolean);
  return `AI 한도 갱신: ${parts.join(" · ") || "읽을 것 없음"}`;
}

// 감독 프로그램이 일감·정비가 끝날 때 부른다. 절대 던지지 않고, 15초가 넘으면 기다리지 않는다. 로그는 한 줄.
export async function refreshAfterTask({ log = console.log, env = process.env, fetchImpl = fetch, post = postLimits, timeoutMs = REFRESH_TIMEOUT_MS } = {}) {
  let timer;
  try {
    if (post === postLimits && (!limitsUrl(env) || !env.CLAUDE_STATUS_TOKEN)) {
      const line = "AI 한도 갱신: 건너뜀(보낼 주소·토큰 없음)";
      log(line);
      return line;
    }
    const r = await Promise.race([
      runAllOnce({ env, fetchImpl, post }),
      new Promise(resolve => (timer = setTimeout(() => resolve({ skipped: `시간 초과 ${Math.round(timeoutMs / 1000)}초` }), timeoutMs))),
    ]);
    const line = summaryLine(r);
    log(line);
    return line;
  } catch {
    const line = "AI 한도 갱신: 실패(알 수 없는 오류)";
    try {
      log(line);
    } catch {
      /* 로그 실패도 무시 */
    }
    return line;
  } finally {
    clearTimeout(timer);
  }
}

async function runAll(once) {
  for (;;) {
    const r = await runAllOnce().catch(() => null);
    console.log(`[${new Date().toLocaleTimeString("ko-KR", { hour12: false })}] ${summaryLine(r)}`);
    if (once) return;
    await new Promise(r2 => setTimeout(r2, SEND_EVERY_MS));
  }
}

function runCheck(env = process.env) {
  const has = k => (env[k] ? "있음" : "없음");
  console.log(`CLAUDE_STATUS_URL: ${has("CLAUDE_STATUS_URL")}, CLAUDE_STATUS_TOKEN: ${has("CLAUDE_STATUS_TOKEN")}, CLAUDE_DEVICE_NAME: ${has("CLAUDE_DEVICE_NAME")}`);
  console.log(`보낼 주소: ${limitsUrl(env) ? "정해짐" : "없음(CLAUDE_STATUS_URL 확인)"}`);
  const home = env.CODEX_HOME || path.join(os.homedir(), ".codex");
  console.log(`Codex auth.json: ${fs.existsSync(path.join(home, "auth.json")) ? "있음" : "없음"}`);
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  console.log(`Claude .credentials.json: ${fs.existsSync(path.join(claudeDir, ".credentials.json")) ? "있음" : "없음"}`);
  const st = readState(stateDir(env)).claude;
  if (isObj(st) && st.until > Date.now()) console.log(`Claude 자동 수집: 쉬는 중(${st.reason ?? ""} · ${Math.ceil((st.until - Date.now()) / 60000)}분 남음)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const once = rest.includes("--once");
  const run = cmd === "statusline" ? runStatusline() : cmd === "codex" ? runCodex(once) : cmd === "all" ? runAll(once) : cmd === "check" ? Promise.resolve(runCheck()) : null;
  if (!run) {
    console.error("사용법: node ai-limits.mjs statusline | codex [--once] | all [--once] | check");
    process.exitCode = 2;
  } else {
    run.catch(() => {
      // 상태줄·수집 실패가 다른 걸 막지 않게 조용히 끝낸다
    });
  }
}
