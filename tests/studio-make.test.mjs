// 공용 스튜디오 [제작] 탭(3-2) 시험: 생성 요청(API 관문·입력 전달), 비용 한도 초과 거절·확인, 진행 표시(상태·한 줄·5초 새로 고침), 결과 미리보기(정수배·카드 이름·판·참고·검수 링크), 읽기 전용, 배치 자리.
// 실행: npm run test:studio-make   (가짜 DB·로그인, react-dom/server 로 그린다. 실제 DB·키·네트워크 없음)
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
function load(rel, overrides = {}) {
  const useCache = Object.keys(overrides).length === 0;
  if (useCache && cache.has(rel)) return cache.get(rel);
  const output = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const req = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith("@/")) return load(resolveSource(name), overrides);
    return require(name);
  };
  new Function("require", "module", "exports", output)(req, module, module.exports);
  if (useCache) cache.set(rel, module.exports);
  return module.exports;
}

const Link = ({ href, children, ...rest }) => h("a", { href, ...rest }, children);
const nav = { "next/link": { __esModule: true, default: Link }, "next/navigation": { useRouter: () => ({ refresh() {}, push() {} }) } };
const make = load("lib/studio/make.ts");
const SECRET = "storePassword=hunter2secretvalue";
const SECRET_BODY = "hunter2secretvalue";

// ───────── 계산 ─────────

test("정수배 확대: 상자 안에서 가장 큰 정수 배율, 최소 1배, 이상한 크기는 1배", () => {
  assert.equal(make.pixelScale(32, 32, 192, 192), 6);
  assert.equal(make.pixelScale(48, 32, 192, 192), 4, "가로가 먼저 걸린다");
  assert.equal(make.pixelScale(100, 100, 192, 192), 1);
  assert.equal(make.pixelScale(300, 300, 192, 192), 1, "큰 그림도 줄이지 않는다");
  assert.equal(make.pixelScale(0, 0, 192, 192), 1);
  assert.equal(make.pixelScale(1, 1, 5000, 5000), 32, "상한");
  for (const s of [make.pixelScale(37, 41, 200, 200), make.pixelScale(16, 16, 500, 500)]) assert.ok(Number.isInteger(s));
});

test("대상 이름: 쉼표 나누기·중복 제거, 별칭 자동완성, 후보 누르면 이어 쓰기", () => {
  assert.deepEqual(make.parseSubjects("싹이, 나무 ,, 싹이\n바위"), ["싹이", "나무", "바위"]);
  const names = make.subjectNames({ 싹이: ["sprout", "새싹"], 나무: [] }, ["바위", "SPROUT", "싹이"]);
  assert.deepEqual(names, ["싹이", "sprout", "새싹", "나무", "바위"], "대표 이름 먼저, 대소문자 중복 제거");
  assert.deepEqual(make.subjectSuggestions("새", names), ["새싹"]);
  assert.deepEqual(make.subjectSuggestions("싹이, sp", names), ["sprout"]);
  assert.deepEqual(make.subjectSuggestions("싹이, 싹", names), ["새싹"].filter((n) => n.includes("싹") && n !== "싹이"), "이미 쓴 '싹이'는 빼고 나머지만");
  assert.deepEqual(make.subjectSuggestions("", names), []);
  assert.equal(make.applySuggestion("sp", "sprout"), "sprout, ");
  assert.equal(make.applySuggestion("싹이, sp", "sprout"), "싹이, sprout, ");
  assert.equal(make.subjectNames(null, []).length, 0);
});

test("입력 오류: 카드·대상·장 수·전체 장 수·추가 지시·참고 그림", () => {
  const ok = { cardId: "c1", subjects: ["싹이"], count: 2, extra: "", refs: 0 };
  assert.equal(make.makeInputError(ok), null);
  assert.match(make.makeInputError({ ...ok, cardId: "" }), /카드/);
  assert.match(make.makeInputError({ ...ok, subjects: [] }), /대상/);
  assert.match(make.makeInputError({ ...ok, count: 0 }), /장 수/);
  assert.match(make.makeInputError({ ...ok, count: 9 }), /장 수/);
  assert.match(make.makeInputError({ ...ok, count: Number.NaN }), /장 수/);
  assert.match(make.makeInputError({ ...ok, subjects: ["a", "b", "c"], count: 6 }), /전체 16장/);
  assert.match(make.makeInputError({ ...ok, extra: "x".repeat(501) }), /500자/);
  assert.match(make.makeInputError({ ...ok, refs: 5 }), /4장/);
  assert.equal(make.estimateCost(1, 2, 3), 6);
  assert.equal(make.estimateCost(0, 2, 3), 0);
});

test("진행 표시: 상태 이름, 진행 한 줄(마지막 로그), 비밀번호 모양은 가림, 새로 고침 대상 상태", () => {
  assert.deepEqual(["pending", "approved", "running", "done", "failed", "needs_confirmation"].map(make.makeStatusLabel), ["승인 대기", "대기", "진행", "완료", "실패", "확인 필요"]);
  assert.equal(make.progressLine("running", null, "[2/4] 싹이 만드는 중…"), "[2/4] 싹이 만드는 중…");
  assert.equal(make.progressLine("running", "upload", null), "upload");
  assert.equal(make.progressLine("running", null, null), "만드는 중…");
  assert.match(make.progressLine("approved", null, null), /대기열/);
  assert.match(make.progressLine("pending", null, null), /승인/);
  assert.match(make.progressLine("needs_confirmation", null, null), /그대로 진행/);
  assert.equal(make.progressLine("done", null, "끝"), "");
  assert.ok(make.progressLine("running", null, "a\n".repeat(200)).length <= 160);
  assert.equal(make.progressLine("running", null, `token ${SECRET}`).includes(SECRET_BODY), false);
  assert.deepEqual(["pending", "approved", "running", "needs_confirmation", "done", "failed", "cancelled"].map(make.isActiveStatus), [true, true, true, true, false, false, false]);
  assert.equal(make.MAKE_REFRESH_MS, 5000);
});

const row = (id, status, extra = {}) => ({ id, title: `일감 ${id}`, status, phase: null, cardId: "c1", createdAt: `2026-10-15T0${id.length}:00:00.000Z`, finishedAt: null, failReason: null, input: { subjects: ["싹이"], count: 2, estimatedCost: 2 }, result: null, ...extra });

test("일감 보기·정렬·개수: 진행·확인 필요가 위, 상태별 개수, 실패 이유의 비밀번호 모양은 가림", () => {
  const jobs = [
    make.buildMakeJob({ row: row("a", "done", { result: { cost: 2 } }), cardName: "싹이 짤" }),
    make.buildMakeJob({ row: row("bb", "running"), cardName: "싹이 짤", lastLog: "[1/2] 싹이 만드는 중…" }),
    make.buildMakeJob({ row: row("ccc", "needs_confirmation", { failReason: "오늘 한도 초과" }), cardName: "싹이 짤" }),
    make.buildMakeJob({ row: row("dddd", "failed", { failReason: `키 없음 ${SECRET}` }), cardName: "싹이 짤" }),
    make.buildMakeJob({ row: row("eeeee", "pending"), cardName: "싹이 짤" }),
    make.buildMakeJob({ row: row("ffffff", "approved"), cardName: "싹이 짤" }),
  ];
  const sorted = make.sortMakeJobs(jobs);

  assert.equal(sorted[0].status, "running");
  assert.equal(sorted[1].status, "needs_confirmation");
  assert.deepEqual(sorted.slice(2, 4).map((j) => j.group), ["wait", "wait"]);
  assert.deepEqual(make.countByGroup(jobs), { wait: 2, run: 1, done: 1, failed: 1, confirm: 1 });
  assert.equal(jobs[1].progress, "[1/2] 싹이 만드는 중…");
  assert.equal(jobs[0].cost, 2);
  assert.equal(jobs[3].failReason.includes(SECRET_BODY), false);
  assert.equal(jobs[0].failReason, null);
});

// ───────── API ─────────

const jsonRes = (body, init = {}) => ({ body, status: init.status ?? 200, headers: init.headers ?? {} });
const nextServer = { NextResponse: { json: jsonRes } };
const reqOf = (body) => ({ json: async () => body });

function loadRoute({ admin, enqueue }) {
  return load("app/api/studio/make/route.ts", {
    "next/server": nextServer,
    "@/lib/factory/admin": { requireAdmin: async () => (admin ? null : jsonRes({ message: "권한이 없습니다." }, { status: 403 })) },
    "@/lib/factory/toolJobsDb": { enqueueToolJob: enqueue },
  });
}

test("생성 요청: 카드·대상·장 수·추가 지시·참고 그림을 도구 일감 등록에 그대로 넘긴다(출처 '스튜디오', 한도 확인 켬, 모르는 칸은 버림)", async () => {
  const calls = [];
  const route = loadRoute({ admin: true, enqueue: async (args, who) => (calls.push({ args, who }), { ok: true, id: "job1", autoApproved: false, message: "도구 일감을 등록했어요" }) });
  const r = await route.POST(reqOf({ appSlug: "saessak-hub", card: "c1", subjects: ["싹이", "나무"], count: 2, extra: "밝게", refArtIds: ["art1"], hacker: "x", source: "통제실" }));

  assert.equal(r.status, 201);
  assert.equal(r.body.jobId, "job1");
  assert.deepEqual(calls[0].who, { source: "스튜디오", askLimit: true });
  assert.deepEqual(calls[0].args, { appSlug: "saessak-hub", card: "c1", subjects: ["싹이", "나무"], count: 2, extra: "밝게", refArtIds: ["art1"], confirmed: false });
  assert.equal(r.headers["Cache-Control"], "no-store");
});

test("생성 요청 거절: 관리자가 아니면 403(등록 안 함), 잘못된 본문 400, 등록 검사 실패 400", async () => {
  let n = 0;
  const enqueue = async () => (n++, { ok: false, message: "대상(subject)이 필요해요." });
  const anon = loadRoute({ admin: false, enqueue });

  assert.equal((await anon.POST(reqOf({ appSlug: "saessak-hub", card: "c1", subjects: ["a"] }))).status, 403);
  assert.equal(n, 0);
  const route = loadRoute({ admin: true, enqueue });

  assert.equal((await route.POST({ json: async () => { throw new Error("bad"); } })).status, 400);
  assert.equal((await route.POST(reqOf([1]))).status, 400);
  const bad = await route.POST(reqOf({ appSlug: "saessak-hub", card: "c1", subjects: [] }));

  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /대상/);
});

test("한도 초과 거절: 409 + needsConfirm, 확인(confirmed)하면 같은 요청이 등록된다", async () => {
  const enqueue = async (args) =>
    args.confirmed === true
      ? { ok: true, id: "job2", autoApproved: false, message: "등록" }
      : { ok: false, message: "오늘 한도 초과. 그래도 만들려면 확인해 주세요.", needsConfirm: { reason: "오늘 PixelLab 호출 한도(4회)를 넘어요", estimatedCost: 2, usage: { day: 3, month: 3 } } };
  const route = loadRoute({ admin: true, enqueue });
  const first = await route.POST(reqOf({ appSlug: "saessak-hub", card: "c1", subjects: ["싹이"], count: 2 }));

  assert.equal(first.status, 409);
  assert.equal(first.body.needsConfirm.estimatedCost, 2);
  assert.match(first.body.needsConfirm.reason, /한도/);
  const second = await route.POST(reqOf({ appSlug: "saessak-hub", card: "c1", subjects: ["싹이"], count: 2, confirmed: true }));

  assert.equal(second.status, 201);
  assert.equal(second.body.jobId, "job2");
  assert.equal((await route.POST(reqOf({ appSlug: "saessak-hub", card: "c1", subjects: ["싹이"], count: 2, confirmed: "true" }))).status, 409, "문자열 'true' 는 확인으로 치지 않는다");
});

// ───────── 화면 ─────────

const CARDS = [
  { id: "c1", name: "싹이 단독 짤", description: "", version: 3, tool: "pixel-art", method: "pixellab", perCall: 1, warnings: [] },
  { id: "c2", name: "소품 컷", description: "", version: 1, tool: "pixel-art", method: "codex", perCall: 0, warnings: ["키 없음"] },
];
const art = (id, extra = {}) => ({ id, url: `https://img.example/${id}.png`, subject: "싹이", status: "candidate", cardId: "c1", cardName: "싹이 단독 짤", cardVersion: 3, refs: ["①picked 싹이 승인 그림"], refsFallback: "", cost: 1, ...extra });
const JOBS = make.sortMakeJobs([
  make.buildMakeJob({ row: row("a", "done", { result: { cost: 2 } }), cardName: "싹이 단독 짤", arts: [art("art1"), art("art2", { refs: [], refsFallback: "승인 그림 없음" })], picked: [{ id: "ap1", url: "https://img.example/ap1.png", subject: "싹이" }] }),
  make.buildMakeJob({ row: row("bb", "running"), cardName: "싹이 단독 짤", lastLog: "[1/2] 싹이 만드는 중…" }),
  make.buildMakeJob({ row: row("ccc", "needs_confirmation", { failReason: "오늘 한도 초과" }), cardName: "싹이 단독 짤" }),
  make.buildMakeJob({ row: row("dddd", "failed", { failReason: "도구 실패" }), cardName: "소품 컷" }),
  make.buildMakeJob({ row: row("eeeee", "pending"), cardName: "소품 컷" }),
]);
const DATA = {
  appSlug: "saessak-hub",
  cards: CARDS,
  jobs: JOBS,
  names: ["싹이", "sprout"],
  approved: [{ id: "ap1", subject: "싹이", url: "https://img.example/ap1.png" }],
  limits: { autoApprove: false, autoApproveMaxCost: 5, dailyLimit: 30, monthlyLimit: 300 },
  usage: { day: 3, month: 40 },
};
const MakeTab = load("components/studio/MakeTab.tsx", nav).default;
const html = (props) => renderToStaticMarkup(h(MakeTab, { data: DATA, canEdit: true, showBatch: false, ...props }));

test("[제작] 화면: 카드 목록, 입력칸(대상·장 수·추가 지시·참고 그림), 생성 버튼, 예상 비용·사용량", () => {
  const out = html();

  assert.match(out, /data-make-card="c1"/);
  assert.match(out, /data-make-card="c2"/);
  assert.ok(out.includes("싹이 단독 짤") && out.includes("판 3") && out.includes("장당 1회") && out.includes("비용 없음"));
  assert.match(out, /data-make-field="subject"/);
  assert.match(out, /data-make-field="count"/);
  assert.match(out, /data-make-field="extra"/);
  assert.match(out, /data-make-refs-toggle/);
  assert.match(out, /data-make-create/);
  assert.match(out, /오늘 3회\/30/);
  assert.match(out, /이번 달 40회\/300/);
  assert.match(out, /승인 대기예요/, "자동 승인 꺼짐 안내");
  assert.equal(/data-make-readonly/.test(out), false);
  assert.match(html({ data: { ...DATA, limits: { ...DATA.limits, autoApprove: true } } }), /5회 이하이고 한도 안이면 자동 승인/);
});

test("진행 상태: 대기·진행·완료·실패·확인 필요 개수와 목록, 진행 중 단계 한 줄, 5초 새로 고침", () => {
  const out = html();

  assert.match(out, /대기 1 · 진행 1 · 완료 1 · 실패 1 · 확인 필요 1/);
  for (const s of ["pending", "running", "done", "failed", "needs_confirmation"]) assert.ok(out.includes(`data-make-job-status="${s}"`), s);
  assert.match(out, /▶ \[1\/2\] 싹이 만드는 중…/);
  assert.match(out, /5초마다 새로 고쳐요/);
  assert.ok(out.indexOf('data-make-job-status="running"') < out.indexOf('data-make-job-status="done"'), "진행 중이 위");
  assert.match(out, /오늘 한도 초과/);
  assert.match(html({ data: { ...DATA, jobs: JOBS.filter((j) => j.status === "done") } }), /끝난 일감만 있어요/);
  assert.match(html({ data: { ...DATA, jobs: [] } }), /아직 이 프로젝트의 도구 일감이 없어요/);
  assert.match(read("components/studio/MakeTab.tsx"), /setInterval\([\s\S]*router\.refresh\(\)[\s\S]*MAKE_REFRESH_MS/);
});

test("결과 미리보기: 픽셀 그대로 확대(pixelated), 라이트박스 열기, 카드 이름·판 번호·참고 그림, [운영에서 검수] 링크", () => {
  const out = html();

  assert.equal((out.match(/data-make-art-open/g) ?? []).length, 2, "그림마다 크게 보기 버튼");
  assert.match(out, /image-rendering:pixelated/);
  assert.ok(out.includes("싹이 단독 짤") && out.includes("· 판 3"));
  assert.match(out, /참고: ①picked 싹이 승인 그림/);
  assert.match(out, /참고: 승인 그림 없음/);
  assert.match(out, /data-make-picked/);
  assert.match(out, /href="\/studio\/saessak-hub\?tab=ops&amp;sub=review&amp;art=art1"/);
  assert.equal((out.match(/data-make-review-link/g) ?? []).length, 2);
  assert.equal(/data-make-lightbox/.test(out), false, "처음에는 닫혀 있다");
  const src = read("components/studio/MakeTab.tsx");

  assert.match(src, /role="dialog"/);
  assert.match(src, /e\.key === "Escape"/);
  assert.match(src, /pixelScale\(nat\.w, nat\.h, box, box\)/);
});

test("접근 키(읽기 전용): 입력칸·생성 버튼 없이 목록·미리보기만", () => {
  const out = html({ canEdit: false });

  assert.match(out, /data-make-readonly/);
  assert.equal(/data-make-create/.test(out), false);
  assert.equal(/data-make-field=/.test(out), false);
  assert.match(out, /data-make-job-list/);
  assert.match(out, /data-make-art-open/);
});

test("카드가 없으면 안내, 배치가 꺼져 있으면 하위 탭 없음 / 켜져 있으면 [생성][배치] 하위 탭과 배치 자리", () => {
  assert.match(html({ data: { ...DATA, cards: [] } }), /data-make-no-cards/);
  assert.equal(/data-make-subtabs/.test(html()), false);
  const on = html({ showBatch: true });

  assert.match(on, /data-make-subtab="generate"/);
  assert.match(on, /data-make-subtab="batch"/);
  assert.match(on, /data-make-form/);
  assert.equal(/data-make-batch-slot/.test(on), false);
  const batch = html({ showBatch: true, sub: "batch" });

  assert.match(batch, /data-make-batch-slot/);
  assert.equal(/data-make-form/.test(batch), false);
  assert.equal(/data-make-batch-slot/.test(html({ showBatch: false, sub: "batch" })), false, "기능이 꺼져 있으면 sub=batch 도 무시");
});

test("화면 코드: 한도 초과(409) 확인 창과 [그대로 진행]이 confirmed 로 다시 보낸다", () => {
  const src = read("components/studio/MakeTab.tsx");

  assert.match(src, /r\.status === 409 && d\.needsConfirm/);
  assert.match(src, /data-make-confirm/);
  assert.match(src, /submit\(true\)/);
  assert.match(src, /\/api\/studio\/make/);
});

test("페이지 연결: [제작] 탭이 MakeTab 을 쓰고, 자료는 제작 탭일 때만 읽고, 배치 기능 스위치를 넘긴다", () => {
  const page = read("app/studio/[app]/page.tsx");

  assert.match(page, /import MakeTab from "@\/components\/studio\/MakeTab"/);
  assert.match(page, /if \(tab === "make"\)[\s\S]*readMakeData\(app\)/);
  assert.match(page, /<MakeTab canEdit=\{viewer\.kind === "admin"\} data=\{make\} showBatch=\{flags\.studioBatch\} sub=\{sub\}/);
  assert.equal(/data-studio-pending="make"/.test(page), false);
});

test("키 값 비노출: 제작 화면 자료·API 코드에 키 값을 읽는 부분이 없다", () => {
  for (const f of ["lib/studio/makeData.ts", "lib/studio/make.ts", "app/api/studio/make/route.ts", "components/studio/MakeTab.tsx"]) {
    assert.equal(/readServerSecret|process\.env|secretEntries|keyVault/.test(read(f)), false, f);
  }
});

test("Studio 요청 경로: regen·split(redraw)는 카드 도구 일감으로, 나머지는 앱 일감(2-3에서 이미 연결, 확인만)", () => {
  const src = read("lib/studio/requests.ts");

  assert.match(src, /const tool = await tryStudioToolJob\(v\)/);
  assert.match(src, /v\.kind !== "regen" && !redraw/);
  assert.match(src, /enqueueToolJob\(\{ appSlug: v\.appSlug, card: card\.id/);
  assert.match(read("app/api/studio-requests/route.ts"), /createStudioRequestJob\(parsed\.value\)/);
});

// ───────── 자료 읽기(가짜 DB) ─────────

test("제작 자료 읽기: 카드 이름·호출당 비용, 진행 중 일감의 마지막 로그, 결과 그림의 카드·판·참고, 직접 고른 참고 그림, 별칭 자동완성", async () => {
  const now = new Date("2026-10-15T01:00:00Z");
  const jobs = [
    { id: "j1", title: "싹이 2장", status: "running", phase: null, cardId: "c1", createdAt: now, finishedAt: null, failReason: null, toolInput: { count: 2, subjects: ["싹이"], extra: "", refArtIds: ["ap1"], estimatedCost: 2 }, toolResult: null },
    { id: "j0", title: "나무 1장", status: "done", phase: null, cardId: "c1", createdAt: new Date(now.getTime() - 3600_000), finishedAt: now, failReason: null, toolInput: { count: 1, subjects: ["나무"], extra: "", refArtIds: [], estimatedCost: 1 }, toolResult: { cost: 1, arts: [], message: "" } },
  ];
  const calls = { logs: [] };
  const prisma = {
    factoryJob: { findMany: async (a) => (a.where.appSlug === "saessak-hub" && a.where.kind === "tool" ? jobs : []) },
    factoryArt: {
      findMany: async (a) =>
        a.where.status === "approved"
          ? [{ id: "ap1", subject: "싹이", url: "https://img.example/ap1.png" }]
          : [{ id: "art9", url: "https://img.example/art9.png", subject: "나무", status: "candidate", cardId: "c1", cardVersion: 2, summary: JSON.stringify({ steps: [], refs: ["①picked 싹이"], refsFallback: "", cost: 1 }), jobId: "j0" }],
    },
    factoryJobLog: { findMany: async (a) => (calls.logs.push(a.where.jobId.in), [{ jobId: "j1", message: "[1/2] 싹이 만드는 중…" }]) },
    factorySetting: { findMany: async () => [{ key: "art-picks:j1", value: JSON.stringify(["ap1", "nope"]) }] },
  };
  const data = load("lib/studio/makeData.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/cardsDb": { listCards: async () => [{ id: "c1", name: "싹이 짤", description: "d", version: 2, tool: "pixel-art", method: "pixellab", enabled: true, warnings: [] }, { id: "c2", name: "꺼진 카드", description: "", version: 1, tool: "pixel-art", method: "codex", enabled: false, warnings: [] }] },
    "@/lib/factory/projectToolSettingsDb": { getProjectToolSettings: async () => ({ settings: { aliases: { 싹이: ["sprout"] } } }) },
    "@/lib/factory/toolJobsDb": { getToolSettings: async () => ({ autoApprove: false, autoApproveMaxCost: 5, concurrency: 2, dailyLimit: 30, monthlyLimit: 300 }), toolUsage: async () => ({ day: 3, month: 9 }) },
    "@/lib/factory/toolManifestDb": { readManifestTools: async () => ({ "pixel-art": { methods: [{ id: "pixellab", cost: { perCall: 1 } }] } }) },
  });
  const r = await data.readMakeData("saessak-hub");

  assert.deepEqual(r.cards.map((c) => [c.name, c.perCall]), [["싹이 짤", 1]], "켜진 카드만, 호출당 비용");
  assert.deepEqual(r.jobs.map((j) => j.status), ["running", "done"]);
  assert.equal(r.jobs[0].progress, "[1/2] 싹이 만드는 중…");
  assert.deepEqual(calls.logs[0], ["j1"], "로그는 진행 중·확인 필요 일감만 읽는다");
  assert.deepEqual(r.jobs[0].pickedRefs.map((p) => p.id), ["ap1"], "승인 그림이 아닌 id 는 버린다");
  assert.equal(r.jobs[1].arts[0].cardName, "싹이 짤");
  assert.equal(r.jobs[1].arts[0].cardVersion, 2);
  assert.deepEqual(r.jobs[1].arts[0].refs, ["①picked 싹이"]);
  assert.deepEqual(r.names, ["싹이", "sprout"]);
  assert.deepEqual(r.usage, { day: 3, month: 9 });
  assert.equal(r.limits.dailyLimit, 30);
  assert.equal(await data.readMakeData("A"), null, "잘못된 앱 이름");
});
