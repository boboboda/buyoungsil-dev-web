// 도구 설명서를 통제실 도구함에 연결(2-1b) 서버 쪽 시험: 보고 검사·저장·조회, 방법 → 키 자동 결정, 한계 검사(지시문·도구 설정), 화면·커넥터 배선.
// 감독 쪽(읽기·보고·키 결정)은 tools/factory-supervisor/tests/toolmanifest.test.mjs. 실행: npm run test:tool-manifests
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const lib = loadTs("lib/factory/toolManifest.ts", { "@/lib/factory/mask": { maskSecrets: (v) => v.replace(/(password=)\S+/gi, "$1***") } });

// pixel-art 설명서(툴킷 tools/manifests/pixel-art.json 을 줄인 사본)
const pixelArt = (extra = {}) => ({
  $schema: "../../schemas/tool-manifest.schema.json",
  name: "pixel-art",
  label: "도트 이미지 생성",
  description: "스튜디오 도구.",
  layer: "studio",
  version: 1,
  source: "file",
  methods: [
    { id: "codex", label: "코덱스", secrets: [], network: true, limits: { size: { min: 8, max: 256 }, frames: { min: 2, max: 8, default: 4 }, maxCallsPerJob: null, timeoutSec: 900 } },
    { id: "pixellab", label: "PixelLab", secrets: ["PIXELLAB_TOKEN"], network: true, limits: { size: { allowed: [32, 64, 96, 128], note: "SIZES 하드코딩" }, frames: { min: 4, max: 16, evenOnly: true, default: 8 }, maxCallsPerJob: 20, timeoutSec: 900 }, cost: { unit: "pixellab-generation", perCall: 1 } },
    { id: "claude", label: "코드 처리", secrets: [], network: false, limits: { frames: { min: 2, max: 64 } } },
  ],
  inputs: [
    { name: "kind", label: "결과 종류", type: "string", required: true, choices: ["image-prop", "motion-game"], description: "종류" },
    { name: "frames", label: "프레임 수", type: "int", required: false, range: { min: 2, max: 64 }, description: "프레임" },
  ],
  outputs: { formats: ["PNG", "GIF"], files: ["result.json"], resultFile: "result.json", resultFields: ["kind", "method"] },
  proposals: [{ id: "x", status: "proposal", summary: "메모" }],
  ...extra,
});
const slice = { name: "pixel-slice", label: "자르기", description: "d", layer: "internal", source: "fallback", methods: [{ id: "default", label: "기본", secrets: [], limits: {} }], inputs: [], outputs: {} };
const tools = () => lib.validateManifestReport({ commit: "8dfe69fabcde1", tools: [pixelArt(), slice] }).report.tools;
const savedReport = (extra) => lib.validateManifestReport({ commit: "aaaaaaa1", tools: [pixelArt(extra)] }).report;

test("보고 검사: 설명서는 정리되고 키는 이름만, 제안 메모·잘못된 항목은 버린다", () => {
  const r = lib.validateManifestReport({
    commit: "8dfe69fabcde1",
    tools: [
      pixelArt({ description: "x password=hunter2 y" }),
      { name: "Bad Name", methods: [{ id: "a", secrets: [] }] },
      { name: "no-methods", methods: [] },
      { name: "pixel-art", label: "겹침", methods: [{ id: "a", secrets: [] }] },
    ],
  });
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.report.tools), ["pixel-art"], "겹친 이름은 앞의 것만, 형식이 틀린 건 버림");
  const t = r.report.tools["pixel-art"];
  assert.equal(r.report.commit, "8dfe69fabcde");
  assert.ok(!t.description.includes("hunter2"), "비밀번호 모양은 가린다");
  assert.deepEqual(t.methods.find((m) => m.id === "pixellab").secrets, ["PIXELLAB_TOKEN"]);
  assert.ok(!("proposals" in t));
  assert.equal(t.methods[0].limits.maxCallsPerJob, null);
  assert.deepEqual(t.methods[1].limits.size.allowed, [32, 64, 96, 128]);
  // 소문자·잘못된 키 이름은 버린다(값처럼 보이는 글이 들어올 수 없다)
  const bad = lib.validateManifestReport({ tools: [pixelArt({ methods: [{ id: "pixellab", label: "p", secrets: ["pk_live_abc123", "ok_KEY", "GOOD_KEY"], limits: {} }] })] });
  assert.deepEqual(bad.report.tools["pixel-art"].methods[0].secrets, ["GOOD_KEY"]);
  assert.equal(lib.validateManifestReport({ tools: "x" }).ok, false);
  assert.equal(lib.validateManifestReport({ tools: [{ name: "x" }] }).ok, false, "하나도 못 읽으면 실패");
});

test("방법 → 필요한 키, 지시문이 부르는 방법의 키만 자동으로 고른다", () => {
  const t = tools();
  assert.deepEqual(lib.methodSecrets(t["pixel-art"], "PixelLab"), ["PIXELLAB_TOKEN"], "방법 id 대소문자 무시");
  assert.deepEqual(lib.methodSecrets(t["pixel-art"], "codex"), []);
  const names = (plan, pm) => lib.autoSecretsForPlan(plan, t, pm).map((x) => x.name);
  assert.deepEqual(names("pixel-art 로 pixellab 방식으로 소품 그려줘"), ["PIXELLAB_TOKEN"]);
  assert.deepEqual(names("PixelLab 으로 그려"), ["PIXELLAB_TOKEN"], "대소문자는 가리지 않는다");
  assert.deepEqual(names("pixel-art 를 codex 로 그려줘"), []);
  assert.deepEqual(names("pixellab-like 라는 말은 다른 단어"), [], "단어 일부는 아님");
  assert.deepEqual(names("pixel-art 로 이미지를 그려줘", { "pixel-art": "pixellab" }), ["PIXELLAB_TOKEN"], "도구를 부르는데 프로젝트 기본 방법이 pixellab");
  assert.deepEqual(names("이미지를 그려줘", { "pixel-art": "pixellab" }), [], "도구 이름이 없으면 프로젝트 기본만으로는 넣지 않는다");
  assert.deepEqual(lib.autoSecretsForPlan("pixellab", { x: { ...t["pixel-art"], name: "x", source: "fallback" } }), [], "최소 설명서(fallback)는 자동으로 넣지 않는다");
});

test("한계 검사: 크기 256 > 최대 128, 허용 값 밖, 프레임 범위·짝수", () => {
  const t = tools()["pixel-art"];
  assert.deepEqual(lib.checkValues(t, "pixellab", { size: 128 }), []);
  assert.match(lib.checkValues(t, "pixellab", { size: 256 })[0], /크기 256/);
  assert.match(lib.checkValues(t, "pixellab", { size: 48 })[0], /32·64·96·128/);
  assert.deepEqual(lib.checkValues(t, "codex", { size: 256 }), []);
  assert.match(lib.checkValues(t, "codex", { size: 300 })[0], /크기 300 > .*최대 256/);
  assert.match(lib.checkValues(t, "pixellab", { frames: 7 })[0], /짝수/);
  assert.match(lib.checkValues(t, "pixellab", { frames: 20 })[0], /프레임 수 20 > .*최대 16/);
  assert.deepEqual(lib.checkValues(t, "claude", { size: 9999 }), [], "claude 방법에는 크기 한계가 없다");
  assert.deepEqual(lib.checkValues(t, "없는방법", { size: 9999 }), []);
  // 최대값만 있는 설명서는 '크기 256 > 최대 128' 꼴로 말한다
  const maxOnly = { ...t, methods: [{ ...t.methods[1], limits: { size: { max: 128 } } }] };
  assert.match(lib.checkValues(maxOnly, "pixellab", { size: 256 })[0], /크기 256 > .*최대 128/);
});

test("지시문 한계 검사: 줄에 방법이 하나만 있고 크기 N 꼴일 때만 본다", () => {
  const t = tools();
  assert.match(lib.checkPlanLimits("소품은 pixellab 으로 크기 256 로 만들어 줘", t)[0], /256/);
  assert.match(lib.checkPlanLimits("- pixellab, cell_size: 256", t)[0], /256/);
  assert.deepEqual(lib.checkPlanLimits("소품은 pixellab 으로 크기 128 로 만들어 줘", t), []);
  assert.deepEqual(lib.checkPlanLimits("pixellab 과 codex 중 고르고 크기 256", t), [], "방법이 둘이면 애매하니 통과");
  assert.deepEqual(lib.checkPlanLimits("codex 로 크기 256", t), []);
  assert.deepEqual(lib.checkPlanLimits("그냥 크기 9999 로 해줘", t), [], "방법이 안 나오면 통과");
  assert.deepEqual(lib.checkPlanLimits("pixellab 으로 크기 64 도트, 다음 줄\n크기 4000 은 다른 이야기", t), []);
  assert.match(lib.checkPlanLimits("pixellab 으로 frames 7", t)[0], /짝수/);
});

test("도구 설정 한계 검사: 결과 종류의 기본 방법으로 cell_size·motion.frames 를 본다", () => {
  const t = tools();
  const s = (extra) => ({ version: 1, methods: { "image-prop": { default: "pixellab" } }, spec: { cell_size: 256 }, ...extra });
  assert.match(lib.checkSettingsLimits(s(), t)[0], /설정\(image-prop\).*256/);
  assert.deepEqual(lib.checkSettingsLimits(s({ spec: { cell_size: 64 } }), t), []);
  assert.deepEqual(lib.checkSettingsLimits(s({ methods: { "image-prop": { default: "codex" } } }), t), [], "codex 는 256 까지");
  assert.deepEqual(lib.checkSettingsLimits(s({ methods: { "image-scene": { default: "pixellab" } } }), t), [], "장면에는 칸 크기를 적용하지 않는다");
  assert.equal(lib.checkSettingsLimits(s({ methods: { "image-prop": { allowed: ["pixellab", "codex"] } } }), t).length, 1, "default 가 없으면 허용 목록 첫 방법");
  assert.match(lib.checkSettingsLimits({ methods: { "motion-game": { default: "pixellab" } }, motion: { frames: 7 } }, t)[0], /motion-game.*짝수/);
  assert.deepEqual(lib.checkSettingsLimits(s(), {}), [], "설명서가 없으면 검사하지 않는다");
  assert.deepEqual(lib.checkSettingsLimits(null, t), []);
});

test("화면 자료: 방법별 키 준비 상태는 등록된 이름만으로 정하고 값은 어디에도 없다", () => {
  const report = { commit: "abc1234", reportedAt: "2026-10-15T00:00:00.000Z", tools: tools() };
  const view = lib.buildManifestsView(report, new Set(["PIXELLAB_TOKEN"]));
  const pa = view.tools.find((x) => x.name === "pixel-art");
  assert.deepEqual(pa.methods.map((m) => [m.id, m.ready]), [["codex", true], ["pixellab", true], ["claude", true]]);
  const none = lib.buildManifestsView(report, new Set()).tools.find((x) => x.name === "pixel-art");
  assert.equal(none.methods.find((m) => m.id === "pixellab").ready, false);
  assert.deepEqual(none.methods.find((m) => m.id === "pixellab").secretStates, [{ name: "PIXELLAB_TOKEN", ready: false }]);
  assert.deepEqual(lib.buildManifestsView(null, new Set()), { commit: "", reportedAt: null, tools: [] });
  assert.deepEqual(lib.limitLines(pa.methods[1]), ["크기 32·64·96·128 (SIZES 하드코딩)", "프레임 4~16 짝수 (기본 8)", "일감당 최대 20회", "제한 시간 900초"]);
  assert.ok(lib.limitLines(pa.methods[0]).includes("일감당 호출 제한 없음"));
});

// ── 가짜 DB 로 저장·조회·검사를 실제 코드 그대로 ──
function fakePrisma(settings = {}) {
  const store = new Map(Object.entries(settings));
  const projectRows = new Map();
  return {
    store,
    projectRows,
    factorySetting: {
      findUnique: async ({ where }) => (store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null),
      upsert: async ({ where, create, update }) => void store.set(where.key, (store.has(where.key) ? update : create).value),
    },
    factoryProjectToolSetting: { findUnique: async ({ where }) => projectRows.get(where.appSlug) ?? null },
  };
}
const dbLib = (prisma, names = ["PIXELLAB_TOKEN"]) =>
  loadTs("lib/factory/toolManifestDb.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/secretEntries": { knownSecretNames: async () => names.map((name) => ({ name, description: "" })) },
    "@/lib/factory/toolManifest": lib,
    "@/lib/factory/projectToolSettings": { readStoredSettings: (text) => (text ? JSON.parse(text) : null) },
  });

test("저장·조회: 도구마다 최신 설명서와 판 번호, 다시 보내면 최신으로 바뀐다", async () => {
  const prisma = fakePrisma();
  const db = dbLib(prisma);
  assert.equal(await db.readManifestReport(), null);
  assert.deepEqual(await db.readManifestTools(), {});
  await db.saveManifestReport(savedReport());
  let v = await db.readManifestsView();
  assert.equal(v.commit, "aaaaaaa1");
  assert.equal(v.tools[0].methods.find((m) => m.id === "pixellab").ready, true);
  await db.saveManifestReport(lib.validateManifestReport({ commit: "bbbbbbb2", tools: [pixelArt({ version: 2 })] }).report);
  v = await db.readManifestsView();
  assert.deepEqual([v.commit, v.tools[0].version, v.tools.length], ["bbbbbbb2", 2, 1]);
  const noKey = dbLib(prisma, []);
  assert.equal((await noKey.readManifestsView()).tools[0].methods.find((m) => m.id === "pixellab").ready, false);
  prisma.store.set("toolManifests", "{깨짐");
  assert.equal(await db.readManifestReport(), null, "저장값이 깨져도 던지지 않는다");
});

test("등록 직전 검사(inspectPlan): 한계 위반과 자동 키, 프로젝트 기본 방법", async () => {
  const prisma = fakePrisma();
  const db = dbLib(prisma);
  assert.deepEqual(await db.inspectPlan("alpha-app", "pixellab 크기 256"), { violations: [], autoSecrets: [] }, "설명서가 아직 없으면 검사하지 않는다");
  await db.saveManifestReport(savedReport());
  const a = await db.inspectPlan("alpha-app", "소품은 pixellab 으로 크기 256 로");
  assert.equal(a.violations.length, 1);
  assert.deepEqual(a.autoSecrets.map((x) => x.name), ["PIXELLAB_TOKEN"]);
  assert.deepEqual((await db.inspectPlan("alpha-app", "codex 로 크기 256 그려줘")).autoSecrets, []);
  prisma.projectRows.set("alpha-app", { settings: JSON.stringify({ version: 1, methods: { "image-prop": { default: "pixellab" } } }) });
  assert.deepEqual((await db.inspectPlan("alpha-app", "pixel-art 로 소품을 그려줘")).autoSecrets.map((x) => x.name), ["PIXELLAB_TOKEN"], "이 앱의 기본 방법이 pixellab");
  assert.deepEqual((await db.inspectPlan("beta-app", "pixel-art 로 소품을 그려줘")).autoSecrets, [], "다른 앱의 설정은 보지 않는다");
  assert.equal((await db.settingsLimitViolations({ version: 1, methods: { "image-prop": { default: "pixellab" } }, spec: { cell_size: 256 } })).length, 1);
});

// ── 일감 등록(enqueue): 실제 mcp.ts 를 가짜 DB 로 ──
const matchRow = (r, where = {}) => Object.entries(where).every(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) && "in" in v ? v.in.includes(r[k]) : v && typeof v === "object" && !Array.isArray(v) && "not" in v ? r[k] !== v.not : r[k] === v));
function enqueueCtx(names) {
  const jobs = [];
  let seq = 0;
  const prisma = {
    ...fakePrisma(),
    factoryJob: {
      count: async ({ where }) => jobs.filter((j) => matchRow(j, where)).length,
      findFirst: async ({ where }) => jobs.filter((j) => matchRow(j, where))[0] ?? null,
      findMany: async ({ where }) => jobs.filter((j) => matchRow(j, where)),
      findUnique: async ({ where }) => jobs.find((j) => j.id === where.id) ?? null,
      create: async ({ data }) => {
        const row = { id: `j${++seq}`, status: "pending", priority: 0, createdAt: new Date(seq), ...data };
        jobs.push(row);
        return { id: row.id };
      },
    },
  };
  prisma.$transaction = async (fn) => fn(prisma);
  prisma.$executeRaw = async () => 0;
  const db = dbLib(prisma, names);
  const mcp = loadTs("lib/factory/mcp.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/ai": { isAiEngine: (v) => v === "claude" || v === "codex" },
    "@/lib/factory/settings": { getDefaultAiEngine: async () => "claude" },
    "@/lib/factory/secretEntries": { knownSecretNames: async () => names.map((name) => ({ name, description: "" })) },
    "@/lib/factory/telegram": { notifyJobEvent: async () => {} },
    "@/lib/factory/projectLinks": {},
    "@/lib/factory/projectLinksDb": {},
    "@/lib/factory/toolManifest": lib,
    "@/lib/factory/toolManifestDb": db,
    "@/lib/factory/supervisor": { runSupervisorAction: async () => ({}), SUPERVISOR_ACTIONS: [] },
    "@/lib/factory/release": {},
    "@/lib/factory/storeAssets": {},
    "@/lib/factory/storeTarget": {},
    "@/lib/factory/lab": { LAB_KIND: "lab", LAB_SLUG: "lab" },
    "@/lib/factory/queue": { appQueue: async () => [], allAppQueues: async () => ({}), numberQueue: () => [{ id: "j1", position: 1 }] },
    "@/lib/factory/jobs": {
      ACTIVE_STATUSES: ["pending", "approved", "running"],
      APP_SLUG_RE: /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/,
      ID_RE: /^[a-z0-9]{1,40}$/i,
      JOB_KINDS: ["new", "revision", "release", "lab"],
      adminAction: () => null,
      JOB_STATUSES: [],
      MAX_PENDING_JOBS: 30,
      MAX_PLAN: 60_000,
      MIN_PLAN: 50,
      STACK_LABELS: {},
      STACKS: ["flutter", "game"],
    },
    "@/lib/factory/parallel": { MAX_GROUP_SIZE: 4, newGroupId: () => "g", PARALLEL_KIND: "revision", SOURCE_MANUAL: "manual" },
  });
  return { prisma, db, mcp, jobs };
}
let seqText = 0;
const body = (text, extra = {}) => ({ appSlug: "alpha-app", title: "알파", kind: "new", stack: "flutter", planMarkdown: `# 기획 ${++seqText}\n\n${text}\n` + "충분히 길게 적어서 최소 글자 수를 넘깁니다. ".repeat(4), ...extra });
const newApp = (n) => ({ appSlug: `app-${n}` });

test("enqueue: 설명서 한계를 넘는 지시문은 등록하지 않고 이유를 알려 준다", async () => {
  const ctx = enqueueCtx(["PIXELLAB_TOKEN"]);
  await ctx.db.saveManifestReport(savedReport());
  const r = await ctx.mcp.enqueue(body("소품은 pixellab 으로 크기 256 로 만든다.", newApp("aaa")));
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /도구 설명서의 한계를 넘어서 등록하지 않았어요: .*256/);
  assert.equal(ctx.jobs.length, 0, "저장되지 않는다");
  const ok = await ctx.mcp.enqueue(body("소품은 pixellab 으로 크기 128 로 만든다.", newApp("aaa")));
  assert.ok(!ok.isError, ok.content[0].text);
});

test("enqueue: 지시문이 부르는 방법의 키가 requiredSecrets 에 자동으로 들어간다(등록된 이름만, 중복 없이)", async () => {
  const ctx = enqueueCtx(["PIXELLAB_TOKEN", "OTHER_KEY"]);
  await ctx.db.saveManifestReport(savedReport());
  const r = await ctx.mcp.enqueue(body("소품은 pixellab 방식으로 그린다.", newApp("bbb")));
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(ctx.jobs[0].requiredSecrets, ["PIXELLAB_TOKEN"]);
  assert.match(r.content[0].text, /도구 설명서에 따라 필요한 키를 자동으로 넣었어요: PIXELLAB_TOKEN/);

  const manual = await ctx.mcp.enqueue(body("소품은 pixellab 방식으로 그린다.", { ...newApp("ccc"), requiredSecrets: ["PIXELLAB_TOKEN", "OTHER_KEY"] }));
  assert.ok(!manual.isError, manual.content[0].text);
  assert.deepEqual(ctx.jobs[1].requiredSecrets, ["PIXELLAB_TOKEN", "OTHER_KEY"], "직접 적은 키는 그대로, 중복 없이");
  assert.doesNotMatch(manual.content[0].text, /자동으로 넣었어요/);

  const codex = await ctx.mcp.enqueue(body("소품은 codex 방식으로 그린다.", newApp("ddd")));
  assert.ok(!codex.isError, codex.content[0].text);
  assert.deepEqual(ctx.jobs[2].requiredSecrets, [], "키가 필요 없는 방법이면 넣지 않는다");

  const unregistered = enqueueCtx([]);
  await unregistered.db.saveManifestReport(savedReport());
  const u = await unregistered.mcp.enqueue(body("소품은 pixellab 방식으로 그린다.", newApp("eee")));
  assert.ok(!u.isError, "등록되지 않은 키 이름은 넣지 않아 일감이 키 때문에 바로 실패하지 않는다");
  assert.deepEqual(unregistered.jobs[0].requiredSecrets, []);
});

test("enqueue: 설명서가 아직 없으면 예전 그대로 등록된다", async () => {
  const ctx = enqueueCtx(["PIXELLAB_TOKEN"]);
  const r = await ctx.mcp.enqueue(body("pixellab 으로 크기 256 도트", newApp("fff")));
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual(ctx.jobs[0].requiredSecrets, []);
});

test("채팅 커넥터: list_tools·get_tool_manifest 는 읽기 전용이고 키 값이 아닌 이름·준비 상태만 돌려준다", async () => {
  const ctx = enqueueCtx(["PIXELLAB_TOKEN"]);
  const defs = ctx.mcp.FACTORY_TOOLS.filter((t) => ["list_tools", "get_tool_manifest"].includes(t.name));
  assert.equal(defs.length, 2);
  for (const d of defs) assert.equal(d.annotations.readOnlyHint, true, d.name);
  assert.ok(ctx.mcp.isFactoryTool("list_tools") && ctx.mcp.isFactoryTool("get_tool_manifest"));
  const empty = await ctx.mcp.callFactoryTool("list_tools", {});
  assert.equal(empty.isError, true);
  await ctx.db.saveManifestReport(savedReport());
  const list = JSON.parse((await ctx.mcp.callFactoryTool("list_tools", {})).content[0].text);
  assert.equal(list.툴킷판, "aaaaaaa1");
  assert.deepEqual(list.도구[0].방법.find((m) => m.id === "pixellab").필요한키, ["PIXELLAB_TOKEN(등록됨)"]);
  const one = JSON.parse((await ctx.mcp.callFactoryTool("get_tool_manifest", { name: "pixel-art" })).content[0].text);
  assert.deepEqual(one.방법.find((m) => m.id === "pixellab").필요한키, [{ name: "PIXELLAB_TOKEN", 등록됨: true }]);
  assert.ok(one.방법.find((m) => m.id === "pixellab").한계.some((l) => l.startsWith("크기 32·64·96·128")));
  assert.equal(one.입력.length, 2);
  assert.equal((await ctx.mcp.callFactoryTool("get_tool_manifest", { name: "없는도구" })).isError, true);
  assert.equal((await ctx.mcp.callFactoryTool("get_tool_manifest", {})).isError, true);
});

test("도구 설정 저장: 설명서 한계를 넘으면 저장하지 않는다(관리자·감독 경로 모두 같은 검사)", async () => {
  const schema = loadTs("lib/factory/projectToolSettingsSchema.ts");
  const settingsLib = loadTs("lib/factory/projectToolSettings.ts", { "@/lib/factory/projectToolSettingsSchema": schema });
  const settingsDb = loadTs("lib/factory/projectToolSettingsDb.ts", { "@/lib/factory/projectToolSettings": settingsLib, "@/lib/factory/projectToolSettingsSchema": schema });
  const rows = new Map();
  const fake = {
    factoryProjectToolSetting: {
      findUnique: async ({ where }) => rows.get(where.appSlug) ?? null,
      upsert: async ({ where, create, update }) => void rows.set(where.appSlug, { appSlug: where.appSlug, updatedAt: new Date(), updatedBy: "x", ...(rows.get(where.appSlug) ?? create), ...update }),
    },
    factoryProjectToolSettingHistory: { create: async () => ({}), deleteMany: async () => ({}), findFirst: async () => null, findMany: async () => [] },
  };
  const db = dbLib(fakePrisma());
  await db.saveManifestReport(savedReport());
  const guard = db.settingsLimitViolations;
  const bad = await settingsDb.saveProjectToolSettings(fake, "alpha-app", { version: 1, methods: { "image-prop": { default: "pixellab" } }, spec: { cell_size: 256 } }, "관리자", "저장", guard);
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  assert.match(bad.errors[0], /256/);
  assert.equal(rows.size, 0, "저장되지 않았다");
  const good = await settingsDb.saveProjectToolSettings(fake, "alpha-app", { version: 1, methods: { "image-prop": { default: "pixellab" } }, spec: { cell_size: 64 } }, "관리자", "저장", guard);
  assert.ok(good.ok, JSON.stringify(good));
  const patch = await settingsDb.patchProjectToolSettings(fake, "alpha-app", { spec: { cell_size: 200 } }, "정비", "일부", guard);
  assert.equal(patch.ok, false, "감독 경로(patch)도 같은 검사");
  assert.match(patch.errors[0], /200/);
  const noGuard = await settingsDb.patchProjectToolSettings(fake, "alpha-app", { spec: { cell_size: 200 } }, "정비", "일부");
  assert.ok(noGuard.ok, "guard 를 안 주면 예전 그대로");
});

test("배선: 보고·조회 주소, 통제실 패널, 감독 시작, 도구함 커넥터 목록, 키 값을 다루는 코드 없음", () => {
  const post = read("app/api/factory/tool-manifests/route.ts");
  assert.match(post, /guardWorker\(req\)/);
  assert.match(post, /validateManifestReport/);
  const admin = read("app/api/admin/factory/tool-manifests/route.ts");
  assert.match(admin, /requireAdmin\(\)/);
  assert.doesNotMatch(admin, /export async function (POST|PUT|DELETE|PATCH)/, "조회 전용");
  assert.match(read("components/admin/factory/FactoryConsole.tsx"), /<ToolManifestPanel \/>/);
  assert.match(read("tools/factory-supervisor/supervisor.mjs"), /startManifestReport\(\{ api, log, toolkitDir/);
  assert.match(read("app/api/admin/factory/tool-settings/route.ts"), /settingsLimitViolations/);
  assert.match(read("app/api/factory/tool-settings/route.ts"), /settingsLimitViolations/);
  assert.match(read("lib/factory/toolbox.ts"), /"list_tools", "get_tool_manifest"/);
  for (const f of ["lib/factory/toolManifest.ts", "lib/factory/toolManifestDb.ts", "components/admin/factory/ToolManifestPanel.tsx", "tools/factory-supervisor/toolmanifest.mjs"]) {
    assert.doesNotMatch(read(f), /readSecrets|secrets\.env|process\.env|readServerSecret/, f);
  }
});

test("통제실 패널: 방법·키 준비 상태·한계·입력 항목이 나오고 키 값은 없다", () => {
  const src = read("components/admin/factory/ToolManifestPanel.tsx");
  const compiled = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const React = require("react");
  new Function("require", "module", "exports", compiled)((name) => (name === "@/lib/factory/toolManifest" ? lib : name === "@/lib/factory/toolManifestDb" || name === "@/lib/factory/secretEntries" ? {} : require(name)), module, module.exports);
  const { renderToStaticMarkup } = require("react-dom/server");
  const report = { commit: "8dfe69fabcde", reportedAt: "2026-10-15T00:00:00.000Z", tools: tools() };
  const render = (props) => renderToStaticMarkup(React.createElement(module.exports.ToolManifestsView, props));
  const html = render({ view: lib.buildManifestsView(report, new Set()) });
  assert.match(html, /data-manifest-tool="pixel-art"/);
  assert.match(html, /data-manifest-tool="pixel-slice"/);
  assert.match(html, /최소 설명서/);
  assert.match(html, /data-method-ready="no"/);
  assert.match(html, /PIXELLAB_TOKEN\(없음\)/);
  assert.match(html, /크기 32·64·96·128/);
  assert.match(html, /data-manifest-input="frames"/);
  assert.match(html, /툴킷 판 8dfe69fabcde/);
  assert.match(render({ view: lib.buildManifestsView(report, new Set(["PIXELLAB_TOKEN"])) }), /PIXELLAB_TOKEN\(등록됨\)/);
  assert.match(render({ view: { commit: "", reportedAt: null, tools: [] } }), /아직 못 받았어요/);
  assert.match(render({ failed: true, view: { commit: "", reportedAt: null, tools: [] } }), /확인 못 함/);
});

test("진짜 툴킷 설명서 파일이 있으면 전부 보고 검사를 통과한다(읽기만)", { skip: !fs.existsSync(path.join(repo, "..", "game-toolkit", "tools", "manifests")) }, () => {
  const dir = path.join(repo, "..", "game-toolkit", "tools", "manifests");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 1);
  const raw = files.map((f) => ({ ...JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")), source: "file" }));
  const r = lib.validateManifestReport({ commit: "8dfe69fabcde", tools: raw });
  assert.ok(r.ok);
  assert.equal(Object.keys(r.report.tools).length, files.length, "버려진 설명서가 없다");
  const pa = r.report.tools["pixel-art"];
  if (pa) assert.deepEqual(lib.methodSecrets(pa, "pixellab"), ["PIXELLAB_TOKEN"]);
});
