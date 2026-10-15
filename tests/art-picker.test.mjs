// 그림 썸네일 선택기 시험: 대상 필터(기본값=카드 대상, 전체 보기) · 선택 · 고르지 않음 · ★ · 날짜 · 다른 화면이 같은 컴포넌트를 쓰는지.
// 실행: npm run test:art-picker   (react-dom/server 로 그린다. DB·네트워크 없음)
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
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

const cache = new Map();
function resolveSource(name) {
  const base = name.startsWith("@/") ? name.slice(2) : name;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (fs.existsSync(path.join(repo, base + ext))) return base + ext;
  throw new Error(`못 찾음: ${name}`);
}
function load(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const output = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const req = (name) => (name.startsWith("@/") ? load(resolveSource(name)) : require(name));
  new Function("require", "module", "exports", output)(req, module, module.exports);
  cache.set(rel, module.exports);
  return module.exports;
}

const lib = load("lib/studio/artPicker.ts");
const ArtPicker = load("components/studio/ArtPicker.tsx").default;
const arts = [
  { id: "a1", subject: "싹이", kind: "image-prop", url: "/u/a1.png", decidedAt: "2026-10-01T16:00:00.000Z" },
  { id: "a2", subject: "싹이", kind: "motion-game", url: "/u/a2.png", decidedAt: "2026-10-03T01:00:00.000Z" },
  { id: "b1", subject: "바위", kind: "image-scene", url: "/u/b1.png", decidedAt: null },
];

test("대상 필터: 빈 값은 전체, 대상은 그 대상만, 고른 그림은 남는다", () => {
  assert.deepEqual(lib.pickerSubjects(arts), ["싹이", "바위"]);
  assert.equal(lib.filterPickerArts(arts, "").length, 3);
  assert.deepEqual(lib.filterPickerArts(arts, "싹이").map((a) => a.id), ["a1", "a2"]);
  assert.deepEqual(lib.filterPickerArts(arts, "바위", ["a1"]).map((a) => a.id), ["a1", "b1"]);
});

test("처음 필터: 카드 대상이 승인 그림에 있으면 그것, 없으면 전체", () => {
  assert.equal(lib.initialSubject(arts, "싹이"), "싹이");
  assert.equal(lib.initialSubject(arts, "없는대상"), "");
  assert.equal(lib.initialSubject(arts, undefined), "");
});

test("선택: 한 장은 바꿔 고르고, 여러 장은 켜고 끄며 한도를 넘지 않는다", () => {
  assert.deepEqual(lib.nextSelection(["a1"], "a2", false), ["a2"]);
  assert.deepEqual(lib.nextSelection(["a1"], "a2", true, 5), ["a1", "a2"]);
  assert.deepEqual(lib.nextSelection(["a1", "a2"], "a1", true, 5), ["a2"]);
  assert.deepEqual(lib.nextSelection(["a1", "a2"], "b1", true, 2), ["a1", "a2"]);
});

test("승인 날짜는 한국 시간 날짜로, 없으면 빈 값", () => {
  assert.equal(lib.artDateLabel("2026-10-01T16:00:00.000Z"), "2026-10-02");
  assert.equal(lib.artDateLabel(null), "");
  assert.equal(lib.artDateLabel("엉터리"), "");
});

const render = (props) => renderToStaticMarkup(h(ArtPicker, { arts, value: [], onChange() {}, name: "t", ...props }));

test("화면: 기본 필터=카드 대상, 칸마다 대상·종류·날짜, ★, 고르지 않음 칸", () => {
  const html = render({ allowNone: true, preferSubject: "싹이", starIds: ["a2"], value: ["a1"] });

  assert.match(html, /data-art-picker-none/);
  assert.match(html, /data-art-picker-art="a1"/);
  assert.match(html, /data-art-picker-art="a2"/);
  assert.doesNotMatch(html, /data-art-picker-art="b1"/); // 바위는 필터로 숨김
  assert.match(html, /승인 2026-10-02/);
  assert.equal((html.match(/data-art-picker-star/g) ?? []).length, 1);
  assert.match(html, /aria-pressed="true"[^>]*data-art-picker-art="a1"/);
  assert.match(html, /data-art-picker-preview="a1"/); // 고른 그림 크게 보기
  assert.match(html, /<option value="">전체 보기<\/option>/);
});

test("화면: 대상 지정이 없으면 전체, 고르지 않음이면 '고르지 않음' 칸이 눌린 상태", () => {
  const html = render({ allowNone: true, value: [] });

  assert.match(html, /data-art-picker-art="b1"/);
  assert.match(html, /aria-pressed="true"[^>]*data-art-picker-none/);
  assert.doesNotMatch(html, /data-art-picker-preview/);
});

test("화면: 승인 그림이 없으면 안내만", () => {
  assert.match(render({ arts: [] }), /승인된 그림이 아직 없어요/);
});

test("카드 고치기·운영 [기본 그림으로]·제작 참고 그림이 같은 선택기를 쓰고, 상세에 기본 그림 썸네일이 있다", () => {
  for (const f of ["components/studio/CardEditor.tsx", "components/studio/OpsTab.tsx", "components/studio/MakeTab.tsx"]) assert.match(read(f), /<ArtPicker/, f);
  assert.doesNotMatch(read("components/studio/CardEditor.tsx"), /data-card-rule="defaultArtId"/);
  assert.match(read("components/studio/ConfigDetail.tsx"), /data-detail-default-art/);
  assert.doesNotMatch(read("components/studio/ArtPicker.tsx"), /fetch\(|\/api\//); // 새 경로 없음: 이미 받은 url 만 쓴다
});
