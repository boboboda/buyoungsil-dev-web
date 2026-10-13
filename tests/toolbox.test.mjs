// 통제실 [설정] '도구함 한눈에 보기' 시험: lib/factory/toolbox.ts(상태 정리·사용 횟수·칸별 실패) + ToolboxView(그림).
// - 중계 모드(꺼짐/보고만/허용)·AI 도구·ffmpeg 상태별 표시, 허용 목록/막힘 구분
// - 읽기 실패: 칸 하나만 '확인 못 함', 전체 실패여도 패널은 그린다
// - 비밀값·토큰·PC 경로·중계 메시지가 화면에 나오지 않는다
// - 허용 목록이 감독 프로그램(toolbroker.mjs ADAPTERS)과 같다
// 가짜 DB(메모리)로 돌린다. 실제 DB·네트워크는 쓰지 않는다.
// 실행: npm run test:toolbox
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const mask = loadTs("lib/factory/mask.ts");
const toolBroker = loadTs("lib/factory/toolBroker.ts", { "@/lib/factory/mask": mask });
const toolbox = loadTs("lib/factory/toolbox.ts", { "@/lib/factory/toolBroker": toolBroker });
const panel = loadTs("components/admin/factory/ToolboxPanel.tsx", { "@/lib/prisma": { __esModule: true, default: null }, "@/lib/factory/toolbox": toolbox });
const { ToolboxView } = panel;

const SECRET = "SECRET-DO-NOT-LEAK";
const NOW = Date.UTC(2026, 9, 13, 3, 0, 0);
const DAY = 24 * 3600_000;
const iso = (t) => new Date(t).toISOString();
const rec = (i, tool, status, at, message = null) => ({ id: `req-${i}`, tool, status, at: iso(at), ms: 120, message });

// 가짜 DB: factory_settings(키→값 문자열) + factory_jobs(toolRequests)
function fakeDb({ settings = {}, jobs = [], fail = {} } = {}) {
  return {
    factorySetting: {
      async findUnique({ where }) {
        if (fail[where.key]) throw Object.assign(new Error(`db down ${SECRET}`), { name: "PrismaClientKnownRequestError" });
        return Object.hasOwn(settings, where.key) ? { key: where.key, value: settings[where.key] } : null;
      },
    },
    factoryJob: {
      async findMany(args) {
        if (fail.jobs) throw Object.assign(new Error(`db down ${SECRET}`), { name: "PrismaClientInitializationError" });
        assert.deepEqual(args.select, { toolRequests: true }, "중계 기록 칸만 읽는다");
        return jobs.map((toolRequests) => ({ toolRequests }));
      },
    },
  };
}

const runtime = {
  startedAt: iso(NOW - DAY),
  claudeTool: "2.1.0 (Claude Code) · 로그인됨",
  codexTool: "없음",
  aiToolsAt: iso(NOW - 3600_000),
  ffmpeg: "7.1-full_build-www.gyan.dev | C:/Users/someone/tools/ffmpeg/bin/ffmpeg.exe",
  ffprobe: "없음",
  restartFail: `token=${SECRET}`, // 도구함과 상관없는 칸(읽지 않는다)
};
const jobs = [
  [rec(1, "echo", "ok", NOW - DAY), rec(2, "toolkit.run", "ok", NOW - 2 * DAY), rec(3, "toolkit.run", "failed", NOW - 3 * DAY, `키 ${SECRET} 실패`)],
  [rec(4, "?", "denied", NOW - DAY, "허용 목록에 없는 도구예요: shell"), rec(5, "toolkit.run", "timeout", NOW - DAY), rec(6, "echo", "ok", NOW - 40 * DAY)],
  null,
  "깨진 값",
  [{ id: "bad id!", tool: "echo", status: "ok", at: iso(NOW) }],
];
const settingsFor = (mode, extra = {}) => ({
  toolBroker: JSON.stringify({ mode, maxRequests: 30, toolTimeoutSec: 0, limitsVersion: 2, apiKey: SECRET, ...extra }),
  supervisorRuntime: JSON.stringify(runtime),
});

async function render(db, env = { DRAFT_API_TOKEN: SECRET }) {
  const src = await toolbox.readToolboxSource(db, env, NOW);
  const box = toolbox.buildToolbox(src);
  return { src, box, html: renderToStaticMarkup(h(ToolboxView, { toolbox: box })) };
}
const card = (box, key) => box.cards.find((c) => c.key === key);

async function quiet(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.map(String).join(" "));
  try {
    return { result: await fn(), logs };
  } finally {
    console.error = orig;
  }
}

test("허용 목록이 감독 프로그램(toolbroker.mjs ADAPTERS)과 같다", async () => {
  const broker = await import(pathToFileURL(path.join(repo, "tools/factory-supervisor/toolbroker.mjs")).href);
  assert.deepEqual([...toolbox.ALLOWED_TOOLS].sort(), Object.keys(broker.ADAPTERS).sort());
});

test("커넥터 도구 이름이 MCP 코드에 실제로 있다", () => {
  const src = read("lib/drafts/mcp.ts") + read("lib/factory/mcp.ts") + read("lib/factory/maintenance-mcp.ts");
  for (const name of Object.values(toolbox.CONNECTOR_TOOLS).flat()) assert.ok(src.includes(`"${name}"`), name);
});

test("중계 모드별 상태: 꺼짐 / 보고만 / 허용", async () => {
  const expected = { off: ["꺼짐", "muted", "쉬는 중"], report: ["보고만", "warn", "쉬는 중"], allow: ["허용", "ok", "자동"] };
  for (const [mode, [label, tone, upload]] of Object.entries(expected)) {
    const { box, html } = await render(fakeDb({ settings: settingsFor(mode), jobs }));
    assert.equal(box.broker.mode, label);
    assert.equal(box.broker.limits, "일감당 요청 30개 · 제한 시간 제한 없음");
    for (const k of ["echo", "toolkit.run"]) {
      assert.equal(card(box, k).tone, tone, `${mode} ${k}`);
      assert.match(card(box, k).state, new RegExp(`^${label}`));
      assert.equal(card(box, k).group, "allowed");
    }
    assert.match(card(box, "asset-upload").state, new RegExp(upload));
    assert.equal(card(box, "blocked").state, "막힘");
    assert.match(html, new RegExp(`도구 요청 중계: <b class="${tone === "muted" ? "fx-muted" : `fx-${tone}`}">${label}</b>`));
  }
});

test("설정이 없으면 기본(꺼짐), 예전 저장값은 모드만 읽는다", async () => {
  let { box } = await render(fakeDb({ jobs: [] }));
  assert.equal(box.broker.mode, "꺼짐");
  ({ box } = await render(fakeDb({ settings: { toolBroker: JSON.stringify({ mode: "allow", maxRequests: 30, toolTimeoutSec: 180 }) } })));
  assert.equal(box.broker.mode, "허용");
  assert.equal(box.broker.limits, "일감당 요청 제한 없음 · 제한 시간 제한 없음");
});

test("작업 PC 도구 상태: 로그인됨·없음·버전만(경로 없음)·아직 확인 안 함", async () => {
  let { box, html } = await render(fakeDb({ settings: settingsFor("allow"), jobs }));
  assert.deepEqual([card(box, "claude").tone, card(box, "claude").state], ["ok", "2.1.0 (Claude Code) · 로그인됨"]);
  assert.deepEqual([card(box, "codex").tone, card(box, "codex").state], ["bad", "없음(설치 안 됨)"]);
  assert.deepEqual([card(box, "ffmpeg").tone, card(box, "ffmpeg").state], ["ok", "있음 · 7.1-full_build-www.gyan.dev"]);
  assert.deepEqual([card(box, "ffprobe").tone, card(box, "ffprobe").state], ["bad", "없음"]);
  assert.doesNotMatch(html, /ffmpeg\.exe|C:\/Users/, "PC 경로는 보이지 않는다");
  assert.equal(toolbox.aiToolState("2.0 · 로그인 안 됨", true).tone, "bad");
  assert.equal(toolbox.aiToolState("2.0 · 로그인 확인 안 함", true).tone, "warn");

  ({ box } = await render(fakeDb({ settings: { toolBroker: JSON.stringify({ mode: "off" }) } })));
  for (const k of ["claude", "codex", "ffmpeg", "ffprobe"]) assert.equal(card(box, k).state, "아직 확인 안 함", k);
});

test("최근 30일 사용 횟수: 중계 기록에서 도구별로, 목록 밖은 '막힘' 칸으로", async () => {
  const { box, html } = await render(fakeDb({ settings: settingsFor("allow"), jobs }));
  assert.deepEqual(card(box, "echo").usage, { total: 1, ok: 1, denied: 0, failed: 0 }, "40일 전 기록과 형식이 틀린 기록은 뺀다");
  assert.deepEqual(card(box, "toolkit.run").usage, { total: 3, ok: 1, denied: 0, failed: 2 });
  assert.deepEqual(card(box, "blocked").usage, { total: 1, ok: 0, denied: 1, failed: 0 });
  assert.equal(card(box, "claude").usage, undefined, "기록이 없는 도구는 횟수 칸이 없다");
  assert.match(html, /최근 30일 사용: 3회 \(성공 1 · 거절 0 · 실패 2\)/);
  assert.doesNotMatch(html, /허용 목록에 없는 도구예요: shell/, "중계 메시지는 그리지 않는다");

  const empty = await render(fakeDb({ settings: settingsFor("off"), jobs: [] }));
  assert.match(empty.html, /최근 30일 사용: 0회/);
});

test("읽기 실패: 그 칸만 '확인 못 함', 로그엔 오류 종류만", async () => {
  const { result, logs } = await quiet(() => render(fakeDb({ settings: settingsFor("allow"), jobs, fail: { toolBroker: true, jobs: true } })));
  const { box, html } = result;
  assert.equal(box.broker, null);
  assert.equal(card(box, "echo").state, "확인 못 함");
  assert.equal(card(box, "asset-upload").state, "확인 못 함");
  assert.equal(card(box, "echo").usage, null);
  assert.equal(card(box, "claude").tone, "ok", "읽은 칸은 그대로");
  assert.match(html, /도구 요청 중계: <b class="fx-muted">확인 못 함<\/b>/);
  assert.match(html, /최근 30일 사용: 확인 못 함/);
  assert.equal(logs.length, 2);
  for (const l of logs) assert.ok(!l.includes(SECRET) && /Prisma/.test(l), l);

  const rt = await quiet(() => render(fakeDb({ settings: settingsFor("allow"), fail: { supervisorRuntime: true } })));
  for (const k of ["claude", "codex", "ffmpeg", "ffprobe"]) assert.equal(card(rt.result.box, k).state, "확인 못 함", k);
});

test("전체 실패여도 패널과 관리 안내는 그린다", () => {
  const html = renderToStaticMarkup(h(ToolboxView, { toolbox: null }));
  assert.match(html, /id="toolbox"/);
  assert.match(html, /확인 못 함/);
  assert.match(html, /id="toolbox-guide"/);
  assert.match(html, /도구함 관리 방법/);
});

test("ToolboxPanel: 읽기가 통째로 던져도 화면은 '확인 못 함'", async () => {
  const throwing = loadTs("components/admin/factory/ToolboxPanel.tsx", {
    "@/lib/prisma": { __esModule: true, default: null },
    "@/lib/factory/toolbox": { ...toolbox, readToolboxSource: async () => { throw new TypeError(`boom ${SECRET}`); } },
  });
  const { result, logs } = await quiet(async () => renderToStaticMarkup(await throwing.default()));
  assert.match(result, /확인 못 함 — 도구 상태를 읽지 못했어요/);
  assert.ok(logs.every((l) => !l.includes(SECRET)));
});

test("비밀값·토큰이 화면에 나오지 않는다(커넥터 토큰은 설정됨/없음만)", async () => {
  const on = await render(fakeDb({ settings: settingsFor("allow"), jobs }), { DRAFT_API_TOKEN: SECRET });
  assert.equal(card(on.box, "connector").state, "연결 가능(토큰 설정됨)");
  assert.ok(!on.html.includes(SECRET));
  assert.ok(!JSON.stringify(on.box).includes(SECRET), "화면에 넘기는 값에도 없다");
  assert.ok(!JSON.stringify(on.src).includes(SECRET), "읽은 값에도 없다(필요한 칸만 꺼냄)");

  const off = await render(fakeDb({ settings: settingsFor("allow") }), { DRAFT_API_TOKEN: "  " });
  assert.deepEqual([card(off.box, "connector").state, card(off.box, "connector").tone], ["꺼짐(토큰 없음)", "bad"]);
});

test("허용 목록과 막힘을 나눠 그리고, 카드마다 이름·하는 일·상태·관리·설정 링크", async () => {
  const { box, html } = await render(fakeDb({ settings: settingsFor("report"), jobs }));
  const order = [...html.matchAll(/data-group="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["allowed", "blocked", "pc", "connector"]);
  assert.match(html, /허용 목록 · 감독 프로그램이 대신 실행/);
  assert.match(html, /막힘 · 허용 목록 밖/);
  assert.match(html, /허용 목록에 없는 도구예요/);
  for (const c of box.cards) {
    assert.ok(c.name && c.does && c.state && c.managers.length && c.where.href, c.key);
    assert.match(html, new RegExp(`data-tool="${c.key.replace(".", "\\.")}"`));
  }
  assert.match(html, /href="\/admin\/factory\?tab=settings#tool-broker"/);
  assert.match(html, /href="\/admin\/factory\?tab=settings#ai-tools"/);
  assert.match(html, /관리: 코드 · 통제실 스위치 · 작업 PC 설정/);
  assert.doesNotMatch(html, /<(button|input|select|form)\b/, "읽기 전용");
});

test("통제실 [설정] 맨 위에 붙고, 링크가 가리키는 앵커가 있다", () => {
  const consoleSrc = read("components/admin/factory/FactoryConsole.tsx");
  assert.match(consoleSrc, /tab === "settings"[\s\S]*?<ToolboxPanel \/>\s*(?:<ToolkitToolsPanel \/>\s*)?<DefaultAiSettings \/>/);
  assert.match(read("components/admin/factory/ToolBrokerSettings.tsx"), /id="tool-broker"/);
  assert.match(read("components/admin/factory/SecretEntries.tsx"), /id="ai-tools"/);
});
