// 결과물 카드 + 프로젝트 연결 설정(2-2) 서버 쪽 시험: 카드 검사(설명서 한계)·설정 만들기·저장/이력/판 번호·기본 카드 옮김·일감 실행용 카드·연결 설정 검사·배선.
// 감독 쪽(카드 파일·card 인자·그림에 카드 붙이기)은 tools/factory-supervisor/tests/cards.test.mjs. 실행: npm run test:result-cards
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

// "@/..." 는 저장소 파일을 같은 방식으로 불러오고, overrides 에 있는 이름은 가짜로 바꾼다
function loadTs(relative, overrides = {}) {
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const req = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith("@/")) return loadTs(`${name.slice(2)}.ts`, overrides);

    return require(name);
  };

  new Function("require", "module", "exports", output)(req, module, module.exports);

  return module.exports;
}

const cards = loadTs("lib/factory/cards.ts");
const links = loadTs("lib/factory/projectLinks.ts");
const toolManifest = loadTs("lib/factory/toolManifest.ts");

// pixel-art 설명서(툴킷 tools/manifests/pixel-art.json 을 줄인 사본)
const manifest = () =>
  toolManifest.validateManifestReport({
    commit: "8dfe69fabcde1",
    tools: [
      {
        name: "pixel-art",
        label: "도트 이미지 생성",
        description: "스튜디오 도구",
        layer: "studio",
        version: 1,
        source: "file",
        methods: [
          { id: "codex", label: "코덱스", secrets: [], limits: { size: { min: 8, max: 256 }, frames: { min: 2, max: 8 } } },
          { id: "pixellab", label: "PixelLab", secrets: ["PIXELLAB_TOKEN"], limits: { size: { allowed: [32, 64, 96, 128] }, frames: { min: 4, max: 16, evenOnly: true } } },
          { id: "claude", label: "코드 처리", secrets: [], limits: { frames: { min: 2, max: 64 } } },
        ],
        inputs: [
          { name: "kind", label: "결과 종류", type: "string", required: true, choices: ["image-prop", "image-scene", "motion-game", "motion-clip"], description: "종류" },
          { name: "subject", label: "대상 이름", type: "string", required: true, description: "대상" },
          { name: "prompt", label: "그림 설명", type: "string", required: false, description: "설명" },
          { name: "method", label: "방법", type: "string", required: false, choices: ["codex", "pixellab", "claude"], description: "방법" },
          { name: "settings", label: "프로젝트 설정", type: "path", required: false, description: "설정" },
          { name: "preset", label: "모션 프리셋", type: "string", required: false, choices: ["walk", "idle"], description: "프리셋" },
          { name: "frames", label: "프레임 수", type: "int", required: false, range: { min: 2, max: 64 }, description: "프레임" },
          { name: "output_dir", label: "결과 폴더", type: "path", required: true, description: "출력" },
        ],
        outputs: { formats: ["PNG"], files: ["result.json"], resultFile: "result.json", resultFields: ["kind"] },
      },
    ],
  }).report.tools;
const TOOLS = manifest();

// 한 컷의 현재 도구 설정(허용 방식에 pixellab 이 없다)
const LEGACY = { version: 1, methods: { "image-prop": { allowed: ["codex", "claude"], default: "codex" } }, spec: { cell_size: 32 }, style: { preset: "ssagi", notes: "둥근 몸" }, references: { auto_max: 3 }, aliases: { 싹이: ["감자"] } };

const SPROUT = { name: "싹이 단독 짤", tool: "pixel-art", method: "pixellab", options: { kind: "image-prop", background: "transparent" }, refRules: { pinDefault: true, defaultArtId: "art_one", sameSubject: true, sameKind: false, maxRefs: 3 }, settings: LEGACY };

// ───────── 입력칸·검사 ─────────

test("입력칸: 도구·방법을 고르면 설명서에서 생긴다(런타임 값은 빼고, 크기는 방법의 한계에서)", () => {
  const pix = cards.cardFields(TOOLS["pixel-art"], "pixellab");
  assert.deepEqual(pix.map((f) => f.name), ["kind", "preset", "frames", "size", "background"], "subject·prompt·method·settings·output_dir 은 카드 옵션이 아니다");
  assert.deepEqual(pix.find((f) => f.name === "size").choices.map((c) => c.value), [32, 64, 96, 128], "PixelLab 은 허용 값 목록");
  assert.deepEqual(pix.find((f) => f.name === "frames").range, { min: 4, max: 16 }, "프레임 범위는 방법의 한계");
  assert.deepEqual(cards.cardFields(TOOLS["pixel-art"], "codex").find((f) => f.name === "size").range, { min: 8, max: 256 });
  assert.equal(cards.cardFields(TOOLS["pixel-art"], "claude").some((f) => f.name === "size"), false, "크기 한계가 없는 방법엔 크기 칸이 없다");
  assert.ok(cards.cardFields(null, "").some((f) => f.name === "kind"), "설명서가 없으면 기본 칸");
});

test("카드 검사: 정상 카드는 정리돼 통과하고, 방법에 필요한 키는 설명서에서 나온다(저장하지 않는다)", () => {
  const r = cards.validateCard(SPROUT, TOOLS);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.deepEqual(r.secrets, ["PIXELLAB_TOKEN"]);
  assert.equal(r.data.refRules.maxRefs, 3);
  assert.ok(!JSON.stringify(r.data).includes("PIXELLAB_TOKEN"), "키 이름도 카드에 담지 않는다");
  assert.deepEqual(cards.validateCard({ name: "코덱스 짤", method: "codex" }, TOOLS).secrets, []);
});

test("카드 검사: 설명서 한계(크기·프레임)·모르는 옵션·모르는 방법·형식 오류는 저장 못 한다", () => {
  const bad = (input) => cards.validateCard({ name: "카드", tool: "pixel-art", method: "pixellab", ...input }, TOOLS);
  assert.match(bad({ options: { size: 256 } }).errors.join("\n"), /32·64·96·128 중 하나/, "PixelLab 크기 256");
  assert.match(bad({ options: { size: 48 } }).errors.join("\n"), /32·64·96·128/);
  assert.match(bad({ options: { frames: 7 } }).errors.join("\n"), /짝수/);
  assert.match(bad({ options: { frames: 20 } }).errors.join("\n"), /16 이하/);
  assert.match(bad({ options: { color: "red" } }).errors.join("\n"), /입력 항목에 없어요/);
  assert.match(bad({ options: { kind: "weird" } }).errors.join("\n"), /중 하나여야/);
  assert.match(bad({ method: "nope" }).errors.join("\n"), /없는 방법/);
  assert.match(bad({ tool: "pixel-zzz" }).errors.join("\n"), /설명서에 없는 도구/);
  assert.match(bad({ name: "  " }).errors.join("\n"), /카드 이름/);
  assert.match(bad({ refRules: { maxRefs: 9 } }).errors.join("\n"), /maxRefs/);
  assert.match(bad({ refRules: { pinDefault: "yes" } }).errors.join("\n"), /true\/false/);
  assert.match(bad({ settings: { version: 1, spec: { cell_size: 9999 } } }).errors.join("\n"), /설정 묶음/);
  // 카드가 갖는 설정 묶음의 한계도 설명서로 본다: 기본 방식이 pixellab 인 카드에 cell_size 100
  assert.match(bad({ settings: { version: 1, spec: { cell_size: 100 } } }).errors.join("\n"), /카드 설정 묶음: .*크기 100/);
  assert.ok(bad({ options: { size: 128 } }).ok, "한계 안의 값은 통과");
  // 설명서가 아직 없으면 한계 검사는 건너뛰고 pixel-art 만 쓴다
  assert.ok(cards.validateCard({ name: "임시", method: "pixellab", options: { size: 200 } }, {}).ok, "설명서가 없으면 크기 한계를 모른다");
  assert.match(cards.validateCard({ name: "다른", tool: "other-tool" }, {}).errors.join("\n"), /pixel-art 만/);
});

test("일부 수정: 보내지 않은 칸은 기존 값을 쓴다", () => {
  const base = cards.validateCard(SPROUT, TOOLS).data;
  const r = cards.validateCard({ description: "새 설명" }, TOOLS, base);
  assert.ok(r.ok);
  assert.equal(r.data.description, "새 설명");
  assert.equal(r.data.method, "pixellab");
  assert.deepEqual(r.data.options, base.options);
  assert.equal(cards.validateCard({ settings: {} }, TOOLS, base).data.settings, null, "{} 로 비운다");
  assert.deepEqual(cards.changedCardFields(base, r.data), ["설명"]);
  assert.deepEqual(cards.changedCardFields(base, base), []);
});

// ───────── 카드 → 프로젝트 설정 ─────────

test("카드로 만든 설정: 방법·종류·크기·배경·참고 규칙이 설정 위에 얹히고 스키마를 통과한다", () => {
  const data = cards.validateCard({ ...SPROUT, name: "여러 환경 짤 128", options: { kind: "image-prop", size: 128, background: "scene" }, refRules: { pinDefault: false, sameSubject: true, sameKind: true, maxRefs: 2 } }, TOOLS).data;
  const out = cards.compileCardSettings(data);
  assert.ok(out.ok, JSON.stringify(out.errors));
  const s = out.settings;
  assert.deepEqual(s.methods["image-prop"], { allowed: ["pixellab"], default: "pixellab" }, "한 컷의 허용 방식(codex·claude)을 카드의 방법이 덮는다");
  assert.deepEqual(s.results, { allowed_kinds: ["image-prop"], default_kind: "image-prop" });
  assert.equal(s.spec.cell_size, 128);
  assert.match(s.style.notes, /둥근 몸\. 배경: 있음/, "배경은 스타일 메모에 붙는다(툴킷 설정에 배경 칸이 없다)");
  assert.equal(s.style.preset, "ssagi", "카드 설정 묶음의 다른 값은 그대로");
  assert.equal(s.references.auto_max, 2);
  assert.deepEqual(s.aliases, { 싹이: ["감자"] });
  assert.equal(data.settings.spec.cell_size, 32, "원본 카드 설정은 바뀌지 않는다");
  // 투명 배경
  const clear = cards.compileCardSettings(cards.validateCard(SPROUT, TOOLS).data).settings;
  assert.match(clear.style.notes, /배경: 투명/);
});

test("참고 규칙 → auto_max: 고정 그림은 한 자리를 쓰고, 둘 다 끄면 자동 참고 0장", () => {
  const compile = (refRules, settings = LEGACY) => cards.compileCardSettings({ method: "", options: {}, settings, refRules: { ...cards.DEFAULT_REF_RULES, ...refRules } }).settings.references?.auto_max;
  assert.equal(compile({ pinDefault: true, defaultArtId: "a", maxRefs: 3 }), 2, "고정 1장 + 자동 2장");
  assert.equal(compile({ pinDefault: true, defaultArtId: null, maxRefs: 3 }), 3, "기본 그림을 안 골랐으면 고정 자리는 안 쓴다");
  assert.equal(compile({ maxRefs: 4 }), 4);
  assert.equal(compile({ sameSubject: false, sameKind: false }), 0);
  assert.equal(compile({}), 3, "규칙이 기본이면 설정의 값을 건드리지 않는다");
  assert.equal(compile({ maxRefs: 0 }), 0);
});

test("카드 설정 읽기: 이상한 저장값은 안전한 기본값, 이력 snapshot 은 다시 읽힌다", () => {
  const d = cards.readCardData({ name: "x", description: "", tool: "pixel-art", method: "", options: { size: 64, bad: { a: 1 } }, refRules: { maxRefs: 99 }, settings: "{not json", enabled: true });
  assert.deepEqual(d.options, { size: 64 });
  assert.deepEqual(d.refRules, cards.DEFAULT_REF_RULES);
  assert.equal(d.settings, null);
  const data = cards.validateCard(SPROUT, TOOLS).data;
  assert.deepEqual(cards.readSnapshot(cards.cardSnapshot(data)), data);
  assert.equal(cards.readSnapshot("nope"), null);
  // 마이그레이션이 옮긴 첫 판의 snapshot 은 설정이 글자(JSON 글자)로 들어 있다
  const first = cards.readSnapshot({ name: "기본 카드", tool: "pixel-art", method: "", options: {}, refRules: {}, settings: JSON.stringify(LEGACY), enabled: true });
  assert.equal(first.settings.spec.cell_size, 32);
  assert.deepEqual(cards.changedCardFields(first, { ...first, settings: { ...first.settings, spec: { cell_size: 64 } } }), ["설정 묶음"], "다음 판과 비교해도 설정이 널로 읽히지 않는다");
});

// ───────── 저장·이력(가짜 DB) ─────────

function fakePrisma() {
  const db = { cards: [], history: [], arts: [], legacy: [], seq: 0 };
  const key = (c) => `${c.appSlug}/${c.name}`;
  const dup = () => Object.assign(new Error("unique"), { code: "P2002" });
  const prisma = {
    factoryCard: {
      findUnique: async ({ where }) => (where.appSlug_name ? db.cards.find((c) => key(c) === `${where.appSlug_name.appSlug}/${where.appSlug_name.name}`) : db.cards.find((c) => c.id === where.id)) ?? null,
      findUniqueOrThrow: async ({ where }) => db.cards.find((c) => c.id === where.id),
      findFirst: async ({ where }) => db.cards.find((c) => c.id === where.id && (!where.appSlug || c.appSlug === where.appSlug)) ?? null,
      findMany: async ({ where = {}, select, take } = {}) => {
        let rows = db.cards.filter((c) => (!where.appSlug || c.appSlug === where.appSlug) && (where.enabled === undefined || c.enabled === where.enabled) && (!where.id?.in || where.id.in.includes(c.id)));
        rows = rows.slice(0, take ?? 1000);

        return select ? rows.map((c) => ({ name: c.name })) : rows;
      },
      count: async ({ where }) => db.cards.filter((c) => c.appSlug === where.appSlug).length,
      create: async ({ data }) => {
        if (db.cards.some((c) => key(c) === key(data))) throw dup();
        const row = { description: "", tool: "pixel-art", method: "", options: {}, refRules: {}, settings: "", enabled: true, version: 1, createdAt: new Date(), updatedAt: new Date(), updatedBy: "", ...data };

        db.cards.push(row);

        return row;
      },
      update: async ({ where, data }) => Object.assign(db.cards.find((c) => c.id === where.id), data),
      updateMany: async ({ where, data }) => {
        const row = db.cards.find((c) => c.id === where.id && c.version === where.version);

        if (!row) return { count: 0 };
        if (data.name && db.cards.some((c) => c !== row && key(c) === `${row.appSlug}/${data.name}`)) throw dup();
        Object.assign(row, data);

        return { count: 1 };
      },
    },
    factoryCardHistory: {
      create: async ({ data }) => db.history.push({ id: ++db.seq, createdAt: new Date(db.seq * 1000), ...data }),
      findMany: async ({ where, take }) => db.history.filter((h) => h.cardId === where.cardId).sort((a, b) => b.version - a.version).slice(0, take),
      deleteMany: async ({ where }) => {
        db.history = db.history.filter((h) => !(h.cardId === where.cardId && h.version <= where.version.lte));
      },
    },
    factoryArt: { findFirst: async ({ where }) => db.arts.find((a) => a.id === where.id && a.appSlug === where.appSlug && (!where.status || a.status === where.status)) ?? null },
    factoryProjectToolSetting: { findUnique: async ({ where }) => db.legacy.find((l) => l.appSlug === where.appSlug) ?? null },
  };

  return { db, prisma };
}
const loadDb = (env) =>
  loadTs("lib/factory/cardsDb.ts", {
    "@/lib/prisma": env.prisma,
    "@/lib/factory/secretEntries": { knownSecretNames: async () => [{ name: "PIXELLAB_TOKEN" }] },
    "@/lib/factory/toolManifestDb": { readManifestTools: async () => TOOLS },
    "@/lib/factory/mask": { maskSecrets: (v) => v },
  });

test("만들기·고치기: 판 번호와 이력(누가: 통제실/채팅/정비), 같은 내용이면 올리지 않는다", async () => {
  const env = fakePrisma();
  const lib = loadDb(env);
  env.db.arts.push({ id: "art_one", appSlug: "one-tiny-frame", status: "approved", url: "https://img.example/a.png", subject: "싹이", kind: "image-prop" });
  const made = await lib.createCard("one-tiny-frame", SPROUT, "채팅", "채팅(커넥터)");
  assert.ok(made.ok, JSON.stringify(made.errors));
  assert.equal(made.card.version, 1);
  assert.deepEqual(made.card.secrets, [{ name: "PIXELLAB_TOKEN", ready: true }], "키는 설명서가 정한 이름과 등록 여부만");
  assert.equal(made.card.pinnedArt.id, "art_one");
  assert.ok(!made.card.warnings.length);
  assert.equal((await lib.createCard("one-tiny-frame", SPROUT, "통제실", "관리자")).status, 409, "같은 이름은 못 만든다");
  assert.equal((await lib.createCard("one-tiny-frame", { ...SPROUT, name: "나쁜 카드", options: { size: 256 } }, "채팅", "x")).ok, false, "설명서 한계를 넘으면 저장 안 됨");
  assert.equal(env.db.cards.length, 1);

  const same = await lib.updateCard("one-tiny-frame", "싹이 단독 짤", { description: "" }, "통제실", "관리자");
  assert.ok(same.ok && same.unchanged, "바뀐 게 없으면 판을 올리지 않는다");
  const up = await lib.updateCard("one-tiny-frame", made.card.id, { description: "싹이 혼자", options: { kind: "image-prop", size: 64 } }, "통제실", "관리자", "크기 64");
  assert.ok(up.ok, JSON.stringify(up.errors));
  assert.equal(up.card.version, 2);
  const rejected = await lib.updateCard("one-tiny-frame", "싹이 단독 짤", { options: { size: 256 } }, "채팅", "채팅(커넥터)");
  assert.equal(rejected.ok, false);
  assert.equal(env.db.cards[0].version, 2, "거부되면 판 번호가 그대로");
  const hist = await lib.listCardHistory(made.card.id);
  assert.deepEqual(hist.map((h) => [h.version, h.source]), [[2, "통제실"], [1, "채팅"]]);
  assert.deepEqual(hist[0].changed, ["설명", "옵션"], "바뀐 칸 이름");
  assert.equal(hist[0].note, "크기 64");
  assert.equal(JSON.stringify(env.db.history).includes("PIXELLAB_TOKEN"), false, "이력에도 키가 없다");
});

test("기본 카드: 프로젝트 도구 설정에서 옮겨지고(없으면 처음 볼 때 만든다), 이름은 못 바꾸고, 도구 설정을 고치면 같이 맞춰진다", async () => {
  const env = fakePrisma();
  const lib = loadDb(env);
  env.db.legacy.push({ appSlug: "saessak-hub", settings: JSON.stringify(LEGACY) });
  const list = await lib.listCards("saessak-hub");
  assert.deepEqual(list.map((c) => [c.name, c.isDefault, c.version]), [["기본 카드", true, 1]]);
  assert.deepEqual(list[0].settings.aliases, { 싹이: ["감자"] }, "설정이 그대로 옮겨진다");
  assert.equal((await lib.listCards("saessak-hub")).length, 1, "다시 봐도 하나");
  assert.equal((await lib.updateCard("saessak-hub", "기본 카드", { name: "다른 이름" }, "통제실", "x")).ok, false);
  await lib.mirrorLegacySettings("saessak-hub", { ...LEGACY, spec: { cell_size: 64 } }, "통제실", "관리자");
  const card = env.db.cards[0];
  assert.equal(card.version, 2);
  assert.equal(JSON.parse(card.settings).spec.cell_size, 64);
  assert.equal(env.db.history.at(-1).source, "통제실");
  await lib.mirrorLegacySettings("saessak-hub", { ...LEGACY, spec: { cell_size: 64 } }, "통제실", "관리자");
  assert.equal(card.version, 2, "같은 내용이면 그대로");
  await assert.doesNotReject(() => lib.mirrorLegacySettings("no-such-app", LEGACY, "정비", "x"), "카드가 없는 프로젝트는 조용히 지나간다");
  assert.equal((await lib.listCards("no-such-app")).length, 0);
});

test("일감이 부르는 카드: 이름·id 로 찾고, 켜진 카드만, 만든 설정·고정 그림(승인된 것만)을 내려 준다", async () => {
  const env = fakePrisma();
  const lib = loadDb(env);
  env.db.arts.push({ id: "art_one", appSlug: "one-tiny-frame", status: "approved", url: "https://img.example/a.png", subject: "싹이", kind: "image-prop" });
  const a = (await lib.createCard("one-tiny-frame", SPROUT, "통제실", "x")).card;
  const off = (await lib.createCard("one-tiny-frame", { ...SPROUT, name: "꺼진 카드", enabled: false }, "통제실", "x")).card;
  const byName = await lib.resolveCardForEnqueue("one-tiny-frame", "싹이 단독 짤");
  assert.deepEqual({ ok: byName.ok, id: byName.id, secrets: byName.secrets }, { ok: true, id: a.id, secrets: ["PIXELLAB_TOKEN"] }, "방법의 키는 설명서에서 나온다");
  assert.equal((await lib.resolveCardForEnqueue("one-tiny-frame", a.id)).id, a.id);
  assert.match((await lib.resolveCardForEnqueue("one-tiny-frame", "꺼진 카드")).message, /꺼져 있어요/);
  assert.match((await lib.resolveCardForEnqueue("one-tiny-frame", "없는 카드")).message, /있는 카드: 싹이 단독 짤, 꺼진 카드/);
  assert.equal((await lib.resolveCardForEnqueue("other-app", a.id)).ok, false, "다른 프로젝트의 카드는 못 부른다");
  const runs = await lib.cardRunForJobs([a.id, off.id, "nope", "x y"]);
  assert.deepEqual([...runs.keys()], [a.id], "꺼진 카드·없는 카드는 빠진다");
  const run = runs.get(a.id);
  assert.equal(run.settings.methods["image-prop"].default, "pixellab");
  assert.deepEqual(run.rules, { sameSubject: true, sameKind: false });
  assert.equal(run.pinned.url, "https://img.example/a.png");
  assert.equal(run.version, 1);
  env.db.arts[0].status = "rejected";
  assert.equal((await lib.cardRunForJobs([a.id])).get(a.id).pinned, null, "반려된 그림은 고정되지 않는다");
  assert.deepEqual((await lib.cardRunsForApp("one-tiny-frame")).map((r) => r.name), ["싹이 단독 짤"], "감독이 받는 목록은 켜진 카드만");
  const view = await lib.getCard("one-tiny-frame", a.id);
  assert.match(view.warnings.join(" "), /승인된 그림이 아니에요/, "고정 그림이 반려되면 경고");
});

// ───────── 연결 설정 ─────────

test("프로젝트 연결 설정: 내보낼 곳(앱 폴더 경로/서비스 업로드)과 스튜디오 기능 켜기·끄기를 검사한다", () => {
  const ok = (o) => links.validatePatch(o);
  assert.deepEqual(ok({ exportKind: "folder", exportPath: "assets/sprites" }).patch, { exportKind: "folder", exportPath: "assets/sprites" });
  assert.deepEqual(ok({ exportKind: "upload", exportPath: "ignored" }).patch, { exportKind: "upload", exportPath: null }, "업로드면 경로는 비운다");
  assert.deepEqual(ok({ exportKind: null }).patch, { exportKind: null, exportPath: null });
  assert.deepEqual(ok({ studioBatch: true, studioService: false }).patch, { studioBatch: true, studioService: false });
  for (const bad of [{ exportKind: "ftp" }, { exportKind: "folder" }, { exportKind: "folder", exportPath: "../x" }, { exportKind: "folder", exportPath: "/abs" }, { exportKind: "folder", exportPath: "C:/x" }, { exportKind: "folder", exportPath: "a/../../b" }, { studioBatch: "yes" }]) {
    assert.equal(ok(bad).ok, false, JSON.stringify(bad));
  }
  const view = links.buildLinksView({ appSlugs: ["one-tiny-frame"], connections: [{ appSlug: "one-tiny-frame", exportKind: "folder", exportPath: "assets", studioBatch: true, studioService: false, services: [] }], report: null });
  const row = view.rows[0];
  assert.deepEqual([row.exportKind, row.exportPath, row.studioBatch, row.studioService], ["folder", "assets", true, false]);
  assert.deepEqual(links.buildLinksView({ appSlugs: ["x-app"], connections: [], report: null }).rows[0].studioBatch, false, "연결 기록이 없으면 꺼짐");
});

// ───────── 그림에 카드 붙이기 ─────────

test("그림 등록: 카드 id·판 번호가 붙고(형식이 맞을 때만), 카드 없이 만든 그림은 비어 있다", async () => {
  const arts = loadTs("lib/factory/arts.ts");
  const created = [];
  const db = {
    factoryArt: {
      findUnique: async () => null,
      count: async () => 0,
      create: async ({ data }) => {
        created.push(data);

        return { id: "x", createdAt: new Date(), decidedBy: "", decidedAt: null, note: "", ...data };
      },
    },
  };
  const base = { appSlug: "one-tiny-frame", subject: "싹이", kind: "image-prop", url: "https://img.example/a.png", jobId: "job1" };
  const r1 = await arts.registerArt(db, { ...base, srcKey: "k1", cardId: "card_abc", cardVersion: 3 });
  assert.deepEqual([r1.art.cardId, r1.art.cardVersion], ["card_abc", 3]);
  const r2 = await arts.registerArt(db, { ...base, srcKey: "k2" });
  assert.deepEqual([r2.art.cardId, r2.art.cardVersion], [null, null]);
  const r3 = await arts.registerArt(db, { ...base, srcKey: "k3", cardId: "bad id!", cardVersion: 2 });
  assert.equal(r3.art.cardId, null, "형식이 이상한 카드 id 는 버린다");
  const r4 = await arts.registerArt(db, { ...base, srcKey: "k4", cardId: "card_abc", cardVersion: 0 });
  assert.deepEqual([r4.art.cardId, r4.art.cardVersion], ["card_abc", null], "판 번호가 이상하면 판만 비운다");
  assert.equal("cardId" in created[1], false);
});

// ───────── 배선 ─────────

test("배선: 일감 받기·등록·커넥터·화면·마이그레이션이 카드에 이어져 있다", () => {
  const next = read("app/api/factory/next/route.ts");
  assert.match(next, /cardRunForJobs\(/);
  assert.match(next, /projectToolSettings = cardRun \? \{ version: cardRun\.version, settings: cardRun\.settings \} : toolSettings\.get/, "카드 일감은 카드로 만든 설정을 내려 준다");
  assert.match(next, /cardRun\?\.pinned/, "기본 그림 고정은 picked 맨 앞");
  assert.match(next, /cardMissing/, "카드를 못 쓰면 감독이 알 수 있게");
  assert.match(read("lib/factory/jobs.ts"), /"parallelGroup", "cardId"/, "일감 가져올 때 cardId 도 돌려받는다");
  assert.match(read("app/api/factory/art/route.ts"), /cardId: text\("cardId"\)/);
  const mcp = read("lib/factory/mcp.ts");
  for (const name of ["list_cards", "get_card", "create_card", "update_card"]) {
    assert.match(mcp, new RegExp(`name: "${name}"`));
    assert.match(mcp, new RegExp(`case "${name}":`));
  }
  assert.match(mcp, /resolveCardForEnqueue\(appSlug, args\.card\)/, "enqueue_app_job 의 card");
  assert.match(mcp, /cardId,\n\s+priority|requiredSecrets: secrets,\n\s+priority,\n\s+source,\n\s+cardId,/, "일감에 cardId 저장");
  assert.match(mcp, /"채팅", "채팅\(커넥터\)"/, "커넥터에서 만든 카드 이력은 '채팅'");
  assert.match(read("app/api/admin/factory/cards/route.ts"), /"통제실"/);
  assert.match(read("app/api/factory/tool-settings/route.ts"), /mirrorLegacySettings\(appSlug, res\.record\.settings, "정비", who\)/);
  const adminSettings = read("app/api/admin/factory/tool-settings/route.ts");
  assert.equal((adminSettings.match(/mirrorLegacySettings\(/g) ?? []).length, 2, "저장·되돌리기가 기본 카드에도 반영");
  assert.match(read("components/admin/factory/StudioWorkbench.tsx"), /<CardsPanel key=\{`cards-\$\{app\.appSlug\}`\} appSlug=\{app\.appSlug\} \/>/);
  const sql = read("prisma/migrations/20261114090000_result_cards/migration.sql");
  for (const t of ["factory_cards", "factory_card_history"]) assert.match(sql, new RegExp(`CREATE TABLE "${t}"`));
  assert.doesNotMatch(sql, /DROP |DELETE |TRUNCATE /i, "기존 데이터를 지우지 않는다");
  for (const name of ["기본 카드", "싹이 단독 짤", "여러 환경 짤 128"]) assert.ok(sql.includes(name), name);
  assert.match(sql, /FROM "factory_project_tool_settings"/, "기존 도구 설정을 기본 카드로 옮긴다");
  assert.match(sql, /ALTER TABLE "factory_arts" ADD COLUMN "cardId"/);
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model FactoryCard \{/);
  assert.match(schema, /cardVersion Int\?/);
});
