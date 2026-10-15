// MCP JSON-RPC 껍데기 분리(lib/mcp/rpc.ts) 시험: /api/mcp 는 초안함 도구 4개만 제공한다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stub = () => new Proxy({ __esModule: true, default: {} }, { get: (t, k) => (k in t ? t[k] : () => {}) });
const STUBBED = new Set(["@/lib/prisma", "@/lib/auth/get-sesstion", "@prisma/client", "next/server", "next/headers"]);

// "@/..." 는 저장소 파일을 그대로 읽고, DB·세션만 가짜로 바꾼다
function load(rel, cache = {}) {
  const out = ts.transpileModule(fs.readFileSync(path.join(repo, rel), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  cache[rel] = module.exports;
  new Function("require", "module", "exports", out)((name) => {
    if (STUBBED.has(name)) return stub();
    if (name.startsWith("@/")) {
      const f = `${name.slice(2)}.ts`;
      return cache[f] ?? load(f, cache);
    }
    return require(name);
  }, module, module.exports);
  cache[rel] = module.exports;
  return module.exports;
}

const NAMES = ["list_categories", "list_existing_titles", "create_sub_category", "save_draft"];
const mcp = load("lib/drafts/mcp.ts");

test("tools/list: 초안함 도구 4개만, 이름과 순서가 이전과 같다(공장·정비 도구 없음)", async () => {
  const r = await mcp.handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(r.status, 200);
  const names = r.body.result.tools.map((t) => t.name);
  assert.equal(names.length, 4);
  assert.deepEqual(names, NAMES);
  assert.deepEqual(mcp.DRAFT_TOOLS.map((t) => t.name), NAMES);
});

test("initialize: 안내문은 초안함 문구뿐(공장 문구 없음)이고 서버 이름·버전이 그대로다", async () => {
  const r = await mcp.handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  const res = r.body.result;
  assert.equal(res.protocolVersion, "2025-03-26");
  assert.deepEqual(res.serverInfo, { name: "buyoungsil-drafts", version: "1.1.0" });
  assert.equal(res.instructions, mcp.DRAFT_INSTRUCTIONS);
  assert.doesNotMatch(res.instructions, /공장|정비|통제실/);
  assert.ok(res.instructions.startsWith("부영실 개발 홈페이지의 초안함 커넥터예요."));
});

test("JSON-RPC 껍데기: 알림 202, 빈 배치 400, 모르는 메서드 -32601, 모르는 도구는 오류 결과", async () => {
  assert.equal((await mcp.handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  assert.equal((await mcp.handleRpc([])).status, 400);
  assert.equal((await mcp.handleRpc("x")).status, 400);
  assert.equal((await mcp.handleRpc({ jsonrpc: "2.0", id: 2, method: "nope" })).body.error.code, -32601);
  assert.equal((await mcp.handleRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: {} })).body.error.code, -32602);
  const bad = await mcp.handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "zzz" } });
  assert.equal(bad.body.result.isError, true);
  const batch = await mcp.handleRpc([{ jsonrpc: "2.0", id: 5, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }]);
  assert.equal(batch.body.length, 1);
});

test("rpc.ts 는 도구 묶음을 모르고, drafts/mcp.ts 가 껍데기를 쓴다", () => {
  const rpc = fs.readFileSync(path.join(repo, "lib/mcp/rpc.ts"), "utf8");
  assert.doesNotMatch(rpc, /@\/lib\/(factory|drafts|prisma)/);
  assert.match(fs.readFileSync(path.join(repo, "lib/drafts/mcp.ts"), "utf8"), /createRpcHandler\(/);
});
