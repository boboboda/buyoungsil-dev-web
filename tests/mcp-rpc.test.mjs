// MCP JSON-RPC 껍데기 분리(lib/mcp/rpc.ts) 시험: /api/mcp 가 지금처럼 33개 도구를 한 토큰으로 제공한다.
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

const NAMES = ["list_categories","list_existing_titles","create_sub_category","save_draft","list_factory_jobs","get_factory_job","get_inbox","get_usage_by_block","list_templates","enqueue_from_template","novel_list","novel_get_episode","novel_add_note","novel_enqueue","novel_get_job","list_secret_names","enqueue_app_job","set_job_priority","enqueue_lab_job","generate_with_card","get_release_status","get_project_links","list_tools","get_tool_manifest","list_cards","get_card","create_card","update_card","enqueue_release_job","supervisor_control","maintenance_list","maintenance_get","maintenance_send"];
const mcp = load("lib/drafts/mcp.ts");

test("tools/list: 33개, 이름과 순서가 이전과 같다(초안함 4 + 공장·정비 29)", async () => {
  const r = await mcp.handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(r.status, 200);
  const names = r.body.result.tools.map((t) => t.name);
  assert.equal(names.length, 33);
  assert.deepEqual(names, NAMES);
  assert.deepEqual(mcp.DRAFT_TOOLS.map((t) => t.name), NAMES.slice(0, 4));
  assert.deepEqual(mcp.FACTORY_BUNDLE_TOOLS.map((t) => t.name), NAMES.slice(4));
});

test("initialize: 안내문은 초안함 + 공장 순서로 이어지고 서버 이름·버전이 그대로다", async () => {
  const r = await mcp.handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  const res = r.body.result;
  assert.equal(res.protocolVersion, "2025-03-26");
  assert.deepEqual(res.serverInfo, { name: "buyoungsil-drafts", version: "1.1.0" });
  assert.equal(res.instructions, mcp.DRAFT_INSTRUCTIONS + mcp.FACTORY_BUNDLE_INSTRUCTIONS);
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
