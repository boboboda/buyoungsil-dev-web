// 도트 그림 저장소 시험: 후보 등록, 상태 전환(후보→승인→반려), 승인만 자동 참고 목록에 들어감, 대상 별칭 묶음, 최대 N장, picked 우선, 마이그레이션, 그림 카드.
// 가짜 데이터, 실제 DB·서버 없음. 실행: npm run test:factory-arts
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
const settingsLib = loadTs("lib/factory/projectToolSettings.ts", { "@/lib/factory/projectToolSettingsSchema": schemaMod });
const arts = loadTs("lib/factory/arts.ts", { "@/lib/factory/projectToolSettings": settingsLib });
const card = loadTs("components/admin/factory/StudioArtsCard.tsx", { "@/lib/factory/arts": arts });

const U = (n) => `https://www.example.com/upload-api/uploads/${n}.png`;

/** 메모리 가짜 DB(ArtDb·PickDb 모양) */
function fakeDb() {
  const rows = [];
  const settings = new Map();
  let n = 0;
  let tick = 0;
  return {
    rows,
    settings,
    factoryArt: {
      findUnique: async ({ where }) => rows.find((r) => ("id" in where ? r.id === where.id : r.srcKey === where.srcKey)) ?? null,
      findMany: async ({ where, take }) =>
        rows
          .filter((r) => (where.appSlug === undefined || r.appSlug === where.appSlug) && (where.status === undefined || r.status === where.status) && (where.id === undefined || where.id.in.includes(r.id)))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, take ?? 1000),
      count: async ({ where }) => rows.filter((r) => r.jobId === where.jobId).length,
      create: async ({ data }) => {
        const row = { id: `art${++n}`, createdAt: new Date(1_800_000_000_000 + ++tick * 1000), decidedBy: "", decidedAt: null, note: "", ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data),
    },
    factorySetting: {
      findMany: async ({ where }) => [...settings].filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value })),
      upsert: async ({ where, create, update }) => void settings.set(where.key, (settings.has(where.key) ? update : create).value),
    },
  };
}
const cand = (db, o = {}) => arts.registerArt(db, { appSlug: "one-tiny-frame", subject: "싹이", kind: "image-prop", method: "codex", url: U(`u${db.rows.length + 1}`), srcKey: `job1:out/${db.rows.length}.png:1`, jobId: "job1", ...o });
async function approved(db, o = {}, who = "부영실") {
  const r = await cand(db, o);
  assert.ok(r.ok, JSON.stringify(r));
  return (await arts.decideArt(db, r.art.id, "approve", who)).art;
}

test("후보 등록: 일감이 올린 그림은 언제나 '후보'(승인으로 보내도), 처음 값(일감 없음)만 바로 승인 가능", async () => {
  const db = fakeDb();
  const r = await cand(db, { status: "approved", summary: { steps: ["pixel-codex"], refs: ["①picked"], cost: 2, prompt: "SECRET" } });
  assert.ok(r.ok);
  assert.equal(r.art.status, "candidate", "일감이 승인 상태로 올릴 수 없다");
  assert.equal(r.art.decidedAt, null);
  assert.deepEqual(r.art.summary, { steps: ["pixel-codex"], refs: ["①picked"], refsFallback: "", cost: 2 });
  assert.ok(!JSON.stringify(db.rows[0]).includes("SECRET"), "요약에는 정해진 항목만");
  const seed = await arts.registerArt(db, { appSlug: "one-tiny-frame", subject: "싹이", kind: "image-prop", url: U("seed"), srcKey: "seed:one-tiny-frame:ssagi_ref", status: "approved", decidedBy: "처음 값" });
  assert.ok(seed.ok);
  assert.equal(seed.art.status, "approved");
  assert.equal(seed.art.decidedBy, "처음 값");
  assert.ok(seed.art.decidedAt);
  const again = await arts.registerArt(db, { appSlug: "one-tiny-frame", subject: "싹이", kind: "image-prop", url: U("other"), srcKey: "seed:one-tiny-frame:ssagi_ref", status: "candidate" });
  assert.equal(again.duplicate, true, "같은 srcKey 는 다시 만들지 않는다");
  assert.equal(again.art.status, "approved", "이미 승인한 그림이 다시 올려져도 상태는 그대로");
  assert.equal(db.rows.length, 2);
});

test("후보 등록: 형식 검사(앱 이름·대상 이름·결과 종류·주소·srcKey)와 일감당 상한", async () => {
  const db = fakeDb();
  const bad = async (o) => (await cand(db, o)).ok;
  assert.equal(await bad({ appSlug: "Bad Slug" }), false);
  assert.equal(await bad({ subject: "   " }), false);
  assert.equal(await bad({ kind: "image-weird" }), false);
  assert.equal(await bad({ url: "javascript:alert(1)" }), false);
  assert.equal(await bad({ url: "file:///c/x.png" }), false);
  assert.equal(await bad({ srcKey: "" }), false);
  assert.equal(await bad({ jobId: "../x" }), false);
  assert.equal(db.rows.length, 0);
  const long = await cand(db, { subject: "가".repeat(100), srcKey: "k-long" });
  assert.equal(long.art.subject.length, arts.MAX_SUBJECT);
  for (let i = 1; i < arts.MAX_ARTS_PER_JOB; i++) assert.ok((await cand(db, { srcKey: `k${i}` })).ok);
  const over = await cand(db, { srcKey: "k-over" });
  assert.equal(over.ok, false);
  assert.equal(over.status, 429);
  assert.ok((await cand(db, { srcKey: "k-other-job", jobId: "job2" })).ok, "다른 일감은 따로 센다");
});

test("상태 전환: 후보 → 승인 → 반려 → 후보, 승인자·시각이 남고 되돌리면 지워진다", async () => {
  const db = fakeDb();
  const r = await cand(db);
  const id = r.art.id;
  const ok = await arts.decideArt(db, id, "approve", "부영실");
  assert.deepEqual([ok.art.status, ok.art.decidedBy], ["approved", "부영실"]);
  assert.ok(ok.art.decidedAt);
  const rej = await arts.decideArt(db, id, "reject", "부영실");
  assert.equal(rej.art.status, "rejected");
  const back = await arts.decideArt(db, id, "reset", "부영실");
  assert.deepEqual([back.art.status, back.art.decidedBy, back.art.decidedAt], ["candidate", "", null]);
  assert.equal((await arts.decideArt(db, id, "delete", "x")).ok, false);
  assert.equal((await arts.decideArt(db, "nope", "approve", "x")).status, 404);
  assert.equal((await arts.decideArt(db, "../x", "approve", "x")).status, 400);
  const note = await arts.setArtNote(db, id, "  눈이  너무 커요 \n");
  assert.equal(note.art.note, "눈이 너무 커요");
  assert.equal((await arts.setArtNote(db, id, 5)).ok, false);
});

test("자동 참고 목록: 승인 그림만 들어가고 후보·반려는 절대 안 들어간다, 새 승인이 먼저, 최대 24장", async () => {
  const db = fakeDb();
  const c = await cand(db, { srcKey: "c" }); // 후보
  const r = await cand(db, { srcKey: "r" });
  await arts.decideArt(db, r.art.id, "reject", "x"); // 반려
  const a1 = await approved(db, { srcKey: "a1", subject: "싹이" });
  await new Promise((res) => setTimeout(res, 5));
  const a2 = await approved(db, { srcKey: "a2", subject: "싹이", kind: "motion-game" });
  const list = await arts.approvedArtsFor(db, "one-tiny-frame");
  assert.deepEqual(list.map((e) => e.url), [a2.url, a1.url]);
  assert.ok(!list.some((e) => [c.art.url, r.art.url].includes(e.url)), "후보·반려는 목록에 없다");
  assert.deepEqual(list.map((e) => Object.keys(e).sort()), [["approvedAt", "kind", "subject", "url"], ["approvedAt", "kind", "subject", "url"]]);
  // DB 가 잘못 섞어서 돌려줘도 순수 함수가 한 번 더 거른다
  const mixed = [...db.rows, { status: "approved", url: "ftp://x/y.png", subject: "s", kind: "image-prop", decidedAt: new Date() }, { status: "approved", url: U("z"), subject: "s", kind: "weird", decidedAt: new Date() }];
  assert.deepEqual(arts.approvedEntries(mixed).map((e) => e.url), [a2.url, a1.url]);
  const many = Array.from({ length: 40 }, (_, i) => ({ status: "approved", url: U(`m${i}`), subject: "s", kind: "image-prop", decidedAt: new Date(1_800_000_000_000 + i * 1000) }));
  assert.equal(arts.approvedEntries(many).length, arts.MAX_AUTO_ENTRIES);
  assert.equal(arts.approvedEntries(many)[0].url, U("m39"));
  assert.deepEqual(await arts.approvedArtsFor(db, "other-app"), []);
  assert.deepEqual(await arts.approvedArtsFor(db, "Bad Slug"), []);
  // 반려했다가 다시 승인하면 들어오고, 승인을 취소하면 빠진다
  await arts.decideArt(db, a1.id, "reject", "x");
  assert.deepEqual((await arts.approvedArtsFor(db, "one-tiny-frame")).map((e) => e.url), [a2.url]);
});

test("대상 별칭 묶음: 대소문자 무시, 별칭은 대표 이름으로 합쳐 보이고 승인→후보→반려 순", async () => {
  const aliases = { 싹이: ["감자", "Ssagi"] };
  assert.equal(arts.canonicalSubject("SSAGI", aliases), "싹이");
  assert.equal(arts.canonicalSubject("감자", aliases), "싹이");
  assert.equal(arts.canonicalSubject("싹이", aliases), "싹이");
  assert.equal(arts.canonicalSubject("물뿌리개", aliases), "물뿌리개");
  assert.equal(arts.canonicalSubject(" x ", null), "x");
  const db = fakeDb();
  await cand(db, { srcKey: "1", subject: "감자" });
  await approved(db, { srcKey: "2", subject: "싹이" });
  const rej = await cand(db, { srcKey: "3", subject: "ssagi" });
  await arts.decideArt(db, rej.art.id, "reject", "x");
  await cand(db, { srcKey: "4", subject: "물뿌리개" });
  const groups = arts.groupBySubject(await arts.listArts(db, "one-tiny-frame"), aliases);
  assert.deepEqual(groups.map((g) => g.subject), ["싹이", "물뿌리개"], "승인 그림이 있는 대상이 위");
  assert.deepEqual(groups[0].arts.map((a) => a.status), ["approved", "candidate", "rejected"]);
  assert.equal(arts.groupBySubject(await arts.listArts(db, "one-tiny-frame"), {}).length, 4, "별칭이 없으면 이름대로");
});

test("참고 고르기 규칙(툴킷 pick_refs 와 같음): picked 먼저 → 같은 대상(별칭) → 같은 종류, 최대 4장, auto_max, 중복 없음", () => {
  const A = (n, subject, kind) => ({ url: U(n), subject, kind });
  const approvedList = [A("s1", "싹이", "image-prop"), A("s2", "감자", "motion-game"), A("k1", "물뿌리개", "image-prop"), A("k2", "다른", "image-prop"), A("k3", "또", "image-prop"), A("k4", "또또", "image-prop")];
  const settings = { aliases: { 싹이: ["감자"] } };
  const sel = (o) => arts.selectReferences({ approved: approvedList, subject: "싹이", kind: "image-prop", settings, ...o });
  assert.deepEqual(sel({}).map((r) => r.reason), ["②subject", "②subject", "③kind", "③kind"], "별칭(감자)도 같은 대상이고 최대 4장");
  assert.deepEqual(sel({}).map((r) => r.url), [U("s1"), U("s2"), U("k1"), U("k2")]);
  const withPicked = sel({ picked: [U("k4"), U("k3")] });
  assert.deepEqual(withPicked.map((r) => r.reason), ["①picked", "①picked", "②subject", "②subject"], "picked 가 먼저, 합쳐서 4장");
  assert.deepEqual(withPicked.slice(0, 2).map((r) => r.url), [U("k4"), U("k3")]);
  assert.deepEqual(sel({ picked: [U("s1")] }).map((r) => r.url).filter((u) => u === U("s1")).length, 1, "같은 그림은 한 번만");
  assert.equal(sel({ settings: { ...settings, references: { auto_max: 1 } } }).length, 1, "자동으로 붙이는 수는 auto_max 까지");
  assert.equal(sel({ settings: { ...settings, references: { auto_max: 0 } } }).length, 0);
  assert.equal(sel({ settings: { ...settings, references: { auto_max: 0 } }, picked: [U("k1")] }).length, 1, "picked 는 auto_max 와 무관");
  assert.deepEqual(sel({ approved: [], picked: [] }), [], "아무것도 없으면 프롬프트만");
  assert.equal(sel({ picked: [1, 2, 3, 4, 5, 6].map((i) => U(`p${i}`)) }).length, arts.MAX_REFS);
});

test("자동 참고에는 승인 그림만: 후보·반려를 섞어 넣어도 고르기 결과에 없다", async () => {
  const db = fakeDb();
  const candidate = await cand(db, { srcKey: "c" });
  const rejected = await cand(db, { srcKey: "r" });
  await arts.decideArt(db, rejected.art.id, "reject", "x");
  const ok = await approved(db, { srcKey: "a" });
  const chosen = arts.selectReferences({ approved: await arts.approvedArtsFor(db, "one-tiny-frame"), subject: "싹이", kind: "image-prop" });
  assert.deepEqual(chosen.map((r) => r.url), [ok.url]);
  assert.ok(!chosen.some((r) => [candidate.art.url, rejected.art.url].includes(r.url)));
});

test("설정에 합치기: 승인 그림이 앞, 설정의 항목은 뒤, 감독 프로그램(toolbroker.mjs)의 합치기와 같은 결과", async () => {
  const stored = { version: 1, references: { auto_max: 3, approved: [{ path: "style-anchors/ssagi/side.png", subject: "싹이", kind: "motion-game", project: "one-tiny-frame" }] }, aliases: { 싹이: ["감자"] } };
  const entries = [{ url: U("a"), subject: "싹이", kind: "image-prop", approvedAt: "2026-10-14T00:00:00.000Z" }, { url: U("b"), subject: "물뿌리개", kind: "image-prop", approvedAt: "2026-10-13T00:00:00.000Z" }];
  const server = arts.mergeApprovedIntoSettings(stored, entries);
  assert.deepEqual(server.references.approved.map((e) => e.path), [U("a"), U("b"), "style-anchors/ssagi/side.png"]);
  assert.equal(server.references.auto_max, 3);
  assert.equal(arts.mergeApprovedIntoSettings(stored, []), stored);
  assert.deepEqual(arts.mergeApprovedIntoSettings(null, entries).references.approved.length, 2);
  const { mergeApprovedArts } = await import("../tools/factory-supervisor/toolbroker.mjs");
  assert.deepEqual(mergeApprovedArts(stored, entries), server);
  assert.deepEqual(mergeApprovedArts(null, entries), arts.mergeApprovedIntoSettings(null, entries));
});

test("'참고로 고르기': 같은 프로젝트의 승인 그림만, 최대 4장, 고른 순서대로 — 일감에 묶고 시작할 때 다시 확인", async () => {
  const db = fakeDb();
  const a = await approved(db, { srcKey: "a" });
  const b = await approved(db, { srcKey: "b" });
  const cnd = await cand(db, { srcKey: "c" });
  const other = await approved(db, { srcKey: "o", appSlug: "other-app" });
  const rejected = await approved(db, { srcKey: "x" });
  await arts.decideArt(db, rejected.id, "reject", "x");
  const got = await arts.resolvePicked(db, "one-tiny-frame", [b.id, a.id, cnd.art.id, other.id, rejected.id, "../bad", 5]);
  assert.deepEqual(got.map((x) => x.id), [b.id, a.id], "후보·반려·다른 프로젝트·이상한 id 는 버리고 고른 순서를 지킨다");
  const five = [];
  for (let i = 0; i < 6; i++) five.push((await approved(db, { srcKey: `m${i}` })).id);
  assert.equal((await arts.resolvePicked(db, "one-tiny-frame", five)).length, arts.MAX_REFS);
  assert.deepEqual(await arts.resolvePicked(db, "one-tiny-frame", "x"), []);
  // 일감에 묶기 → 시작할 때 목록
  await arts.savePicks(db, "jobA", [a.id, b.id]);
  await arts.savePicks(db, "jobB", []);
  let picked = await arts.pickedForJobs(db, [{ id: "jobA", appSlug: "one-tiny-frame" }, { id: "jobB", appSlug: "one-tiny-frame" }, { id: "jobC", appSlug: "one-tiny-frame" }]);
  assert.deepEqual([...picked.keys()], ["jobA"]);
  assert.deepEqual(picked.get("jobA").map((p) => p.url), [a.url, b.url]);
  assert.deepEqual(Object.keys(picked.get("jobA")[0]).sort(), ["kind", "subject", "url"]);
  // 그 사이에 반려했으면 빠진다
  await arts.decideArt(db, a.id, "reject", "x");
  picked = await arts.pickedForJobs(db, [{ id: "jobA", appSlug: "one-tiny-frame" }]);
  assert.deepEqual(picked.get("jobA").map((p) => p.url), [b.url]);
  // 다른 프로젝트 일감에는 실리지 않는다
  assert.equal((await arts.pickedForJobs(db, [{ id: "jobA", appSlug: "other-app" }])).size, 0);
  const next = await arts.approvedForNext(db, ["one-tiny-frame", "one-tiny-frame", "empty-app"]);
  assert.deepEqual([...next.keys()], ["one-tiny-frame"]);
});

test("마이그레이션: 새 표만 만들고 기존 데이터는 건드리지 않는다, 스키마에 모델이 있다", () => {
  const dir = path.join(repo, "prisma/migrations");
  const name = fs.readdirSync(dir).find((d) => /add_factory_arts$/.test(d));
  assert.ok(name, "마이그레이션 폴더");
  const sql = read(`prisma/migrations/${name}/migration.sql`).replace(/--.*$/gm, "");
  assert.match(sql, /CREATE TABLE "factory_arts"/);
  assert.match(sql, /"status" TEXT NOT NULL DEFAULT 'candidate'/);
  assert.match(sql, /UNIQUE INDEX "factory_arts_srcKey_key"/);
  assert.ok(!/\b(DROP|DELETE|TRUNCATE|ALTER|UPDATE)\b/i.test(sql), "기존 데이터를 지우거나 바꾸지 않는다");
  const sorted = fs.readdirSync(dir).filter((d) => /^\d{14}_/.test(d)).sort();
  assert.ok(sorted.includes(name), "정렬 목록에 있다(이후 마이그레이션이 더 생겨도 된다)");
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model FactoryArt \{[\s\S]*?@@map\("factory_arts"\)/);
});

test("연결: 일감 가져가기에 approvedArts·pickedArts, 일감 보내기에 refArtIds(승인만), 승인·반려 API 는 관리자만", () => {
  const next = read("app/api/factory/next/route.ts");
  assert.match(next, /approvedForNext\(/);
  assert.match(next, /pickedForJobs\(/);
  assert.match(next, /\.\.\.arts/);
  const control = read("app/api/admin/factory/control/route.ts");
  assert.match(control, /resolvePicked\(prisma as unknown as ArtDb, slug, input\.refArtIds\)/);
  assert.match(control, /savePicks\(/);
  for (const f of ["app/api/admin/factory/arts/route.ts"]) assert.equal((read(f).match(/requireAdmin\(\)/g) ?? []).length, 2, "GET·POST 모두 관리자 확인");
  const worker = read("app/api/factory/art/route.ts");
  assert.equal((worker.match(/guardWorker\(req\)/g) ?? []).length, 2, "감독 프로그램 토큰 확인");
  assert.match(worker, /touchRunningJob\(jobId\)/, "실행 중인 일감만 올린다");
  const requests = read("lib/studio/requests.ts");
  assert.match(requests, /pickedRefsBlock\(v\)/);
  assert.ok(!/pickedRefs/.test(requests.slice(requests.indexOf("function parseExtras"), requests.indexOf("function parsePlacement"))), "공개 입구는 참고 그림을 받지 않는다");
  assert.match(read("tools/factory-supervisor/supervisor.mjs"), /onArt:/);
});

test("그림 카드: 대상별 묶음, 상태별 버튼, 승인 그림만 '참고로 고르기', 도트 확대(pixelated)", () => {
  const view = (id, status, subject, extra = {}) => ({ id, appSlug: "one-tiny-frame", subject, kind: "image-prop", status, url: U(id), method: "codex", summary: { steps: ["pixel-codex"], refs: ["①picked"], refsFallback: "", cost: 1 }, jobId: "cmjob123456", createdAt: "2026-10-14T01:02:03.000Z", decidedBy: status === "candidate" ? "" : "부영실", decidedAt: status === "candidate" ? null : "2026-10-14T02:00:00.000Z", note: "", ...extra });
  const list = [view("a1", "approved", "싹이"), view("c1", "candidate", "감자"), view("r1", "rejected", "싹이", { note: "색이 달라요" }), view("c2", "candidate", "물뿌리개")];
  const html = renderToStaticMarkup(h(card.default, { appSlug: "one-tiny-frame", picked: ["a1"], onPickedChange: () => {}, initialArts: list, initialAliases: { 싹이: ["감자"] } }));
  assert.match(html, /그림 \(승인 1 · 후보 2 · 반려 1\)/);
  assert.equal((html.match(/data-arts-subject="/g) ?? []).length, 2, "별칭(감자)은 싹이 묶음 안에");
  assert.match(html, /data-arts-subject="싹이"/);
  assert.match(html, /image-rendering:pixelated/);
  const section = (id) => html.slice(html.indexOf(`data-art="${id}"`), html.indexOf("</li>", html.indexOf(`data-art="${id}"`)));
  const buttons = (id) => [...section(id).matchAll(/data-art-action="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(buttons("a1"), ["reject", "reset", "note"], "승인 그림: 반려·후보로·메모");
  assert.deepEqual(buttons("c1"), ["approve", "reject", "note"]);
  assert.deepEqual(buttons("r1"), ["approve", "reset", "note"]);
  assert.match(section("a1"), /data-art-pick/);
  assert.match(section("a1"), /checked/);
  assert.ok(!/data-art-pick/.test(section("c1") + section("r1") + section("c2")), "후보·반려는 참고로 고를 수 없다");
  assert.match(section("r1"), /메모: 색이 달라요/);
  assert.match(html, /다음 \[일감 보내기\]에 참고로 1장/);
  const empty = renderToStaticMarkup(h(card.default, { appSlug: "x-app", picked: [], onPickedChange: () => {}, initialArts: [] }));
  assert.match(empty, /data-arts-empty/);
  const wb = read("components/admin/factory/StudioWorkbench.tsx");
  assert.match(wb, /<StudioArtsCard /);
  assert.match(wb, /refArtIds: pickedArts/);
});

test("가져오기: 일감 없는 처음 값만 원래 만든·승인 시각을 쓰고, 일감 그림·잘못된 시각은 무시한다", async () => {
  const db = fakeDb();
  const made = "2026-10-09T10:08:14.982Z";
  const decided = "2026-10-10T00:07:15.316Z";
  const r = await arts.registerArt(db, { appSlug: "one-tiny-frame", subject: "싹이", kind: "image-scene", method: "pixellab", url: U("h1"), srcKey: "hancut:1", status: "approved", createdAt: made, decidedAt: decided });
  assert.ok(r.ok);
  assert.equal(r.art.createdAt, made);
  assert.equal(r.art.decidedAt, decided);
  const job = await arts.registerArt(db, { appSlug: "one-tiny-frame", subject: "싹이", kind: "image-scene", url: U("h2"), srcKey: "j:1", jobId: "job1", createdAt: made, decidedAt: decided });
  assert.notEqual(job.art.createdAt, made, "일감이 올린 그림은 시각을 정할 수 없다");
  assert.equal(job.art.status, "candidate");
  const bad = await arts.registerArt(db, { appSlug: "one-tiny-frame", subject: "싹이", kind: "image-scene", url: U("h3"), srcKey: "hancut:3", status: "approved", createdAt: "2999-01-01T00:00:00.000Z", decidedAt: "어제" });
  assert.ok(bad.ok);
  assert.ok(new Date(bad.art.decidedAt).getTime() <= Date.now(), "잘못된 승인 시각은 지금으로");
  const again = await arts.registerArt(db, { appSlug: "one-tiny-frame", subject: "싹이", kind: "image-scene", url: U("h1b"), srcKey: "hancut:1", status: "approved" });
  assert.ok(again.duplicate, "같은 srcKey 는 중복 등록되지 않는다");
});

test("자동 참고: 가져온 장면 컷들(옛 승인 시각)이 있어도 새로 승인한 정면 그림이 먼저 고른다", () => {
  const rows = [{ status: "approved", url: U("ref"), subject: "싹이", kind: "image-prop", decidedAt: new Date("2026-10-14T04:31:00Z") }];
  for (let i = 1; i <= 45; i++) rows.push({ status: "approved", url: U(`c${i}`), subject: "싹이", kind: "image-scene", decidedAt: new Date(Date.UTC(2026, 9, 9, 10, i)) });
  const list = arts.approvedEntries(rows);
  assert.equal(list.length, 24);
  assert.equal(list[0].url, U("ref"));
  const refs = arts.selectReferences({ approved: list, subject: "싹이", kind: "image-prop" });
  assert.equal(refs.length, 4);
  assert.equal(refs[0].url, U("ref"));
});

test("그림 크기: 칸 너비에 맞는 정수 배율, 장면은 큰 칸(모바일 1열)·소품은 작은 칸(모바일 2열 이상), 확대 화면은 좌우 넘기기", () => {
  assert.equal(card.integerScale(300, 128), 2);
  assert.equal(card.integerScale(520, 128), 4);
  assert.equal(card.integerScale(127, 128), 1, "칸보다 커도 1배 아래로는 안 줄인다");
  assert.equal(card.integerScale(0, 128), 1);
  assert.equal(card.integerScale(300, 0), 1, "원본 크기를 모르면 1배");
  const view = (id, kind) => ({ id, appSlug: "one-tiny-frame", subject: "싹이", kind, status: "approved", url: U(id), method: "codex", summary: null, jobId: null, createdAt: "2026-10-14T01:02:03.000Z", decidedBy: "부영실", decidedAt: "2026-10-14T02:00:00.000Z", note: "" });
  const html = renderToStaticMarkup(h(card.default, { appSlug: "one-tiny-frame", picked: [], onPickedChange: () => {}, initialArts: [view("s1", "image-scene"), view("p1", "image-prop"), view("m1", "motion-game")], initialAliases: {} }));
  const grid = (name) => html.slice(html.indexOf(`data-arts-grid="${name}"`), html.indexOf("</ul>", html.indexOf(`data-arts-grid="${name}"`)));
  assert.match(html, /<ul class="[^"]*grid-cols-1 sm:grid-cols-2[^"]*" data-arts-grid="scene"/, "장면: 큰 칸");
  assert.match(html, /<ul class="[^"]*grid-cols-2 sm:grid-cols-3 lg:grid-cols-4[^"]*" data-arts-grid="prop"/, "소품·캐릭터: 작은 칸, 모바일도 2열");
  assert.ok(grid("scene").includes('data-art="s1"') && !grid("scene").includes('data-art="p1"'));
  assert.ok(grid("prop").includes('data-art="p1"') && grid("prop").includes('data-art="m1"'));
  assert.ok(!/h-32 w-32/.test(html), "고정 128px 칸 아님");
  assert.match(html, /data-art-img="true"[^>]*style="image-rendering:pixelated;width:100%/, "측정 전에는 칸 너비 + pixelated");
  const src = read("components/admin/factory/StudioArtsCard.tsx");
  for (const k of ["ArrowLeft", "ArrowRight", "Escape", "data-art-prev", "data-art-next", "data-art-close", 'aria-modal="true"', "fixed inset-0"]) assert.ok(src.includes(k), k);
});
