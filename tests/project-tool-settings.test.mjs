// 프로젝트별 도구 설정 시험: 검증(툴킷 스키마 사본), 저장·버전·이력·되돌리기(가짜 DB), 감독 프로그램에 내려 주는 값, 마이그레이션, 편집 화면.
// 가짜 데이터, 실제 DB·서버 없음. 실행: npm run test:project-tool-settings
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const schemaMod = loadTs("lib/factory/projectToolSettingsSchema.ts");
const lib = loadTs("lib/factory/projectToolSettings.ts", { "@/lib/factory/projectToolSettingsSchema": schemaMod });
const dbLib = loadTs("lib/factory/projectToolSettingsDb.ts", { "@/lib/factory/projectToolSettings": lib, "@/lib/factory/projectToolSettingsSchema": schemaMod });
const card = loadTs("components/admin/factory/ProjectToolSettingsCard.tsx", { "@/lib/factory/projectToolSettings": lib });

const example = JSON.parse(JSON.stringify(schemaMod.ONE_TINY_FRAME_SETTINGS));

/** 메모리 가짜 DB(SettingsDb 모양) */
function fakeDb() {
  const rows = new Map();
  const hist = [];
  let tick = 0;
  return {
    rows,
    hist,
    factoryProjectToolSetting: {
      findUnique: async ({ where }) => rows.get(where.appSlug) ?? null,
      findMany: async ({ where }) => [...rows.values()].filter((r) => where.appSlug.in.includes(r.appSlug)),
      upsert: async ({ where, create, update }) => {
        const cur = rows.get(where.appSlug);
        rows.set(where.appSlug, cur ? { ...cur, ...update } : { ...create, updatedAt: new Date(1_800_000_000_000 + ++tick) });
      },
    },
    factoryProjectToolSettingHistory: {
      findMany: async ({ where, take }) => hist.filter((r) => r.appSlug === where.appSlug).sort((a, b) => b.version - a.version).slice(0, take),
      findFirst: async ({ where }) => hist.find((r) => r.appSlug === where.appSlug && r.version === where.version) ?? null,
      create: async ({ data }) => void hist.push({ ...data, createdAt: new Date(1_800_000_000_000 + ++tick) }),
      deleteMany: async ({ where }) => {
        for (let i = hist.length - 1; i >= 0; i--) if (hist[i].appSlug === where.appSlug && hist[i].version <= where.version.lte) hist.splice(i, 1);
      },
    },
  };
}

test("툴킷 예시(one-tiny-frame) 설정은 그대로 통과하고, $schema 는 빠지고 version 은 1", () => {
  const r = lib.cleanProjectSettings({ $schema: "../schemas/x.json", ...example });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal("$schema" in r.settings, false);
  assert.equal(r.settings.version, 1);
  assert.deepEqual(r.settings.aliases, { 싹이: ["감자", "ssagi"] });
  assert.equal(r.settings.motion.pixel_motion.facing, "right");
});

test("형식 검사: 스키마가 막는 것을 모두 막는다", () => {
  const bad = (patch, re) => {
    const r = lib.cleanProjectSettings({ version: 1, ...patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
    if (re) assert.match(r.errors.join("\n"), re, JSON.stringify(patch));
  };
  bad({ mystery: 1 }, /mystery: 모르는 항목/);
  bad({ spec: { cell_size: 4 } }, /spec\.cell_size: 8 이상/);
  bad({ spec: { cell_size: 12.5 } }, /정수/);
  bad({ spec: { canvas: 5000 } }, /1254 이하/);
  bad({ style: { outline_color: "red" } }, /style\.outline_color: 형식/);
  bad({ style: { max_colors: 1 } }, /2 이상/);
  bad({ methods: { "image-prop": { allowed: ["magic"] } } }, /codex \| pixellab/);
  bad({ methods: { "image-prop": { allowed: ["codex", "codex"] } } }, /두 번/);
  bad({ methods: { unknown: { allowed: ["codex"] } } }, /모르는 항목/);
  bad({ motion: { loop: "spin" } }, /pingpong \| forward/);
  bad({ motion: { pixel_motion: { stride: 99 } } }, /32 이하/);
  bad({ motion: { pixel_motion: { facing: "up" } } }, /right \| left/);
  bad({ cost: { pixellab_per_job: -1 } }, /0 이상/);
  bad({ references: { auto_max: 5 } }, /4 이하/);
  bad({ references: { approved: [{ subject: "x" }] } }, /path: 꼭 필요/);
  bad({ aliases: { 싹이: "감자" } }, /목록/);
  bad({ spec: "big" }, /묶음/);
  assert.equal(lib.cleanProjectSettings(null).ok, false);
  assert.equal(lib.cleanProjectSettings([]).ok, false);
});

test("연결 검사: 기본 방식은 허용 안에, 기본 종류는 허용 종류 안에, 별칭·참고 그림 한도", () => {
  const err = (patch) => lib.cleanProjectSettings({ version: 1, ...patch });
  assert.equal(err({ methods: { "image-prop": { allowed: ["codex"], default: "pixellab" } } }).ok, false);
  assert.equal(err({ methods: { "image-prop": { allowed: ["codex"], default: "codex" } } }).ok, true);
  assert.equal(err({ methods: { "image-prop": { default: "pixellab" } } }).ok, true, "허용 목록이 없으면 기본만 정해도 된다");
  assert.equal(err({ results: { allowed_kinds: ["image-prop"], default_kind: "motion-clip" } }).ok, false);
  assert.equal(err({ aliases: { a: ["x".repeat(61)] } }).ok, false);
  assert.equal(err({ aliases: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`n${i}`, ["a"]])) }).ok, false);
  assert.equal(err({ references: { approved: Array.from({ length: 51 }, (_, i) => ({ path: `p${i}.png` })) } }).ok, false);
  assert.equal(err({ style: { notes: "가".repeat(1001) } }).ok, false);
  const big = err({ references: { approved: Array.from({ length: 50 }, (_, i) => ({ path: `style-anchors/${"a".repeat(250)}${i}.png`, subject: "s".repeat(100) })) } });
  assert.equal(big.ok, false, "16KB 를 넘으면 거절");
});

test("빈 칸 정리: 빈 문자열·빈 묶음은 버리고, 전부 비면 version 만 남는다(= 도구 기본값)", () => {
  const r = lib.cleanProjectSettings({ version: 1, spec: { size_group: "", cell_size: 32 }, style: { notes: "" }, aliases: {}, methods: { "image-prop": { allowed: [] } } });
  assert.ok(r.ok);
  assert.deepEqual(r.settings, { version: 1, spec: { cell_size: 32 } });
  const empty = lib.cleanProjectSettings({});
  assert.deepEqual(empty.settings, { version: 1 });
  assert.equal(lib.isEmptySettings(empty.settings), true);
  assert.equal(lib.isEmptySettings(example), false);
});

test("changedGroups·readStoredSettings·schemaWarning", () => {
  assert.deepEqual(lib.changedGroups({ spec: { cell_size: 32 } }, { spec: { cell_size: 48 }, cost: { pixellab_per_job: 1 } }), ["규격", "비용"]);
  assert.deepEqual(lib.changedGroups(example, example), []);
  assert.deepEqual(lib.changedGroups(null, { aliases: { a: ["b"] } }), ["대상 별칭"]);
  assert.equal(lib.readStoredSettings("깨짐"), null);
  assert.equal(lib.readStoredSettings(JSON.stringify({ version: 1, spec: { cell_size: 1 } })), null, "검증을 못 넘는 저장값은 쓰지 않는다");
  assert.deepEqual(lib.readStoredSettings(JSON.stringify(example)).spec, example.spec);
  assert.equal(lib.schemaWarning(undefined, "aaaa"), null, "보고가 없으면 경고하지 않는다");
  assert.equal(lib.schemaWarning("aaaa", "aaaa"), null);
  assert.match(lib.schemaWarning("bbbb", "aaaa"), /스키마가 홈페이지에 있는 사본과 달라요|사본과 달라요/);
});

test("스키마 사본: 툴킷 파일이 있으면 같은 내용(지문이 같음), 지문은 키 순서와 무관", () => {
  const toolkit = path.resolve(repo, "..", "game-toolkit", "schemas", "project-settings.schema.json");
  if (fs.existsSync(toolkit)) {
    const actual = JSON.parse(fs.readFileSync(toolkit, "utf8"));
    assert.equal(dbLib.schemaHash(actual), dbLib.schemaHash(), "홈페이지 사본이 툴킷 스키마와 같아야 해요(다르면 사본을 갱신)");
    const ex = JSON.parse(fs.readFileSync(path.resolve(repo, "..", "game-toolkit", "examples", "project-settings.one-tiny-frame.json"), "utf8"));
    delete ex.$schema;
    assert.deepEqual(ex, example);
  }
  assert.equal(dbLib.schemaHash({ b: 1, a: [{ d: 1, c: 2 }] }), dbLib.schemaHash({ a: [{ c: 2, d: 1 }], b: 1 }));
  assert.notEqual(dbLib.schemaHash({ a: 1 }), dbLib.schemaHash({ a: 2 }));
  assert.match(dbLib.schemaHash(), /^[0-9a-f]{16}$/);
});

test("저장: 검증 통과해야 하고, 버전·수정자가 기록되고, 같은 값이면 버전이 오르지 않는다", async () => {
  const db = fakeDb();
  const bad = await dbLib.saveProjectToolSettings(db, "saessak-hub", { spec: { cell_size: 1 } }, "관리자");
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);
  assert.equal(db.rows.size, 0, "거절된 값은 저장되지 않는다");
  assert.equal((await dbLib.saveProjectToolSettings(db, "Bad Slug", {}, "관리자")).ok, false);

  const first = await dbLib.saveProjectToolSettings(db, "saessak-hub", { spec: { cell_size: 48 } }, "관리자A");
  assert.ok(first.ok);
  assert.equal(first.record.version, 1);
  assert.equal(first.record.updatedBy, "관리자A");
  assert.deepEqual(first.record.settings, { version: 1, spec: { cell_size: 48 } });
  const same = await dbLib.saveProjectToolSettings(db, "saessak-hub", { version: 1, spec: { cell_size: 48 } }, "관리자B");
  assert.ok(same.ok && same.unchanged);
  assert.equal(db.hist.length, 1, "바뀐 게 없으면 이력도 늘지 않는다");
  const second = await dbLib.saveProjectToolSettings(db, "saessak-hub", { spec: { cell_size: 64 }, cost: { pixellab_per_job: 2 } }, "관리자B");
  assert.equal(second.record.version, 2);
  assert.equal(db.rows.get("saessak-hub").updatedBy, "관리자B");
  assert.equal(db.rows.get("saessak-hub").version, 2);
  // 다른 프로젝트는 영향 없음
  assert.equal(await dbLib.getProjectToolSettings(db, "memo-app"), null);
});

test("이력(최근 N개·달라진 묶음)과 되돌리기(새 버전으로 다시 저장, 이력은 지우지 않음)", async () => {
  const db = fakeDb();
  await dbLib.saveProjectToolSettings(db, "memo-app", { spec: { cell_size: 32 } }, "나");
  await dbLib.saveProjectToolSettings(db, "memo-app", { spec: { cell_size: 32 }, cost: { pixellab_per_month: 9 } }, "나");
  await dbLib.saveProjectToolSettings(db, "memo-app", {}, "나");
  const history = await dbLib.getProjectToolSettingsHistory(db, "memo-app");
  assert.deepEqual(history.map((x) => x.version), [3, 2, 1]);
  assert.deepEqual(history[1].changed, ["비용"]);
  assert.deepEqual(history[0].changed, ["규격", "비용"]);
  assert.equal(history[0].empty, true, "v3 은 비운 설정");
  assert.equal(history[2].note, "저장");

  const rev = await dbLib.revertProjectToolSettings(db, "memo-app", 1, "되돌린 사람");
  assert.ok(rev.ok);
  assert.equal(rev.record.version, 4, "되돌리기도 새 버전");
  assert.deepEqual(rev.record.settings, { version: 1, spec: { cell_size: 32 } });
  assert.equal(db.hist.at(-1).note, "되돌리기: 버전 1");
  assert.equal(db.hist.length, 4, "이력은 지우지 않고 한 줄 더한다");
  assert.equal((await dbLib.getProjectToolSettingsHistory(db, "memo-app", 2)).length, 2, "최근 N개만");
  assert.equal((await dbLib.revertProjectToolSettings(db, "memo-app", 99, "x")).status, 404);
  assert.equal((await dbLib.revertProjectToolSettings(db, "memo-app", "1", "x")).ok, false);
  assert.equal((await dbLib.revertProjectToolSettings(db, "memo-app", 0, "x")).ok, false);
});

test("이력은 앱마다 최근 30개만 남긴다", async () => {
  const db = fakeDb();
  for (let i = 0; i < 35; i++) await dbLib.saveProjectToolSettings(db, "memo-app", { spec: { cell_size: 8 + i } }, "나");
  assert.equal(db.hist.length, dbLib.HISTORY_KEEP);
  assert.equal(Math.min(...db.hist.map((x) => x.version)), 6);
  assert.equal(db.rows.get("memo-app").version, 35);
});

test("감독 프로그램에 내려 주는 값: 설정이 있는 앱만, 비었거나 깨진 건 뺀다", async () => {
  const db = fakeDb();
  await dbLib.saveProjectToolSettings(db, "one-tiny-frame", example, "시스템");
  await dbLib.saveProjectToolSettings(db, "empty-app", {}, "나");
  db.rows.set("broken-app", { appSlug: "broken-app", version: 3, settings: "{깨짐", updatedAt: new Date(), updatedBy: "" });
  const m = await dbLib.projectSettingsForNext(db, ["one-tiny-frame", "empty-app", "broken-app", "no-settings", "Bad Slug", "one-tiny-frame"]);
  assert.deepEqual([...m.keys()], ["one-tiny-frame"]);
  assert.equal(m.get("one-tiny-frame").version, 1);
  assert.equal(m.get("one-tiny-frame").settings.cost.pixellab_per_job, 3);
  assert.equal((await dbLib.projectSettingsForNext(db, [])).size, 0);
});

test("마이그레이션: 새 표만 만들고 지우지 않으며, one-tiny-frame 처음 값은 툴킷 예시와 같다", () => {
  const dir = fs.readdirSync(path.join(repo, "prisma", "migrations")).find((d) => d.endsWith("_add_project_tool_settings"));
  assert.ok(dir);
  const sql = read(`prisma/migrations/${dir}/migration.sql`);
  assert.match(sql, /CREATE TABLE "factory_project_tool_settings"/);
  assert.match(sql, /CREATE TABLE "factory_project_tool_setting_history"/);
  assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b|\bTRUNCATE\b|ALTER TABLE/i, "기존 데이터를 지우거나 바꾸지 않는다");
  assert.match(sql, /ON CONFLICT \("appSlug"\) DO NOTHING/);
  const json = /VALUES \('one-tiny-frame', 1, '(.+?)', '시스템/.exec(sql)?.[1];
  assert.ok(json);
  assert.deepEqual(JSON.parse(json), example);
  assert.ok(lib.cleanProjectSettings(JSON.parse(json)).ok, "처음 값도 스키마 검증을 통과");
  const prisma = read("prisma/schema.prisma");
  assert.match(prisma, /model FactoryProjectToolSetting \{[\s\S]*@@map\("factory_project_tool_settings"\)/);
  assert.match(prisma, /model FactoryProjectToolSettingHistory \{[\s\S]*@@index\(\[appSlug, version\]\)/);
});

test("API 연결: 관리자 전용, next 응답에 projectToolSettings, 도구함 보고에 스키마 지문", () => {
  const route = read("app/api/admin/factory/tool-settings/route.ts");
  for (const fn of ["GET", "PUT", "POST"]) assert.match(route, new RegExp(`export async function ${fn}[\\s\\S]*?requireAdmin\\(\\)`));
  assert.match(route, /saveProjectToolSettings/);
  assert.match(route, /revertProjectToolSettings/);
  const next = read("app/api/factory/next/route.ts");
  assert.match(next, /projectSettingsForNext/);
  assert.match(next, /projectToolSettings/);
  assert.match(next, /j\.kind !== LAB_KIND/, "실험 일감에는 붙이지 않는다");
  const info = read("lib/factory/toolkit.ts");
  assert.match(info, /settingsSchemaHash/);
});

test("편집 화면: 스튜디오 프로젝트 상세에 붙고, 묶음(방식·결과·규격·스타일·모션·비용·참고 그림·대상 별칭)과 이력·되돌리기가 있다", () => {
  assert.match(read("components/admin/factory/StudioWorkbench.tsx"), /<ProjectToolSettingsCard /);
  const src = read("components/admin/factory/ProjectToolSettingsCard.tsx");
  for (const g of ["methods", "results", "spec", "style", "motion", "cost", "references", "aliases"]) assert.match(src, new RegExp(`"${g}",\\s*\\n?\\s*"`), g);
  assert.match(src, /data-history-revert/);
  assert.match(src, /data-settings-save/);
  const html = renderToStaticMarkup(h(card.default, { appSlug: "one-tiny-frame" }));
  assert.match(html, /도구 설정 \(pixel-art\)/);
  assert.match(html, /data-project-tool-settings="one-tiny-frame"/);
  assert.match(html, /불러오는 중/);
});

test("편집 화면의 별칭 글 ↔ 설정", () => {
  assert.deepEqual(card.parseAliases("싹이 = 감자, ssagi\n\n  흙이=  \n나쁨\nA=b"), { 싹이: ["감자", "ssagi"], A: ["b"] });
  assert.equal(card.aliasesToText({ 싹이: ["감자", "ssagi"] }), "싹이 = 감자, ssagi");
  assert.equal(card.aliasesToText(undefined), "");
  const r = lib.cleanProjectSettings({ aliases: card.parseAliases("싹이 = 감자, ssagi") });
  assert.deepEqual(r.settings.aliases, { 싹이: ["감자", "ssagi"] });
});

test("일부 수정(patch): 지정한 항목만 바꾸고 나머지는 그대로, 수정자·이력이 남고, 없는 프로젝트·잘못된 값은 거절", async () => {
  const db = fakeDb();
  assert.equal((await dbLib.patchProjectToolSettings(db, "one-tiny-frame", { spec: { cell_size: 128 } }, "정비")).status, 404, "저장된 설정이 없으면 만들지 않는다");
  await dbLib.saveProjectToolSettings(db, "one-tiny-frame", { spec: { cell_size: 32, size_group: "small", canvas: 1024 }, style: { max_colors: 16 } }, "관리자");
  const r = await dbLib.patchProjectToolSettings(db, "one-tiny-frame", { spec: { cell_size: 128 } }, "정비", "규격 칸 크기 128");
  assert.ok(r.ok && !r.unchanged);
  assert.deepEqual(r.record.settings, { version: 1, spec: { cell_size: 128, size_group: "small", canvas: 1024 }, style: { max_colors: 16 } });
  assert.equal(r.record.version, 2);
  assert.equal(db.rows.get("one-tiny-frame").updatedBy, "정비");
  assert.equal(db.hist.at(-1).createdBy, "정비");
  assert.equal(db.hist.at(-1).note, "규격 칸 크기 128");
  assert.ok((await dbLib.patchProjectToolSettings(db, "one-tiny-frame", { spec: { cell_size: 128 } }, "정비")).unchanged, "같은 값이면 버전을 올리지 않는다");
  assert.equal((await dbLib.patchProjectToolSettings(db, "one-tiny-frame", { spec: { cell_size: 4 } }, "정비")).status, 400);
  assert.equal(db.rows.get("one-tiny-frame").version, 2);
});
