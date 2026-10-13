// 통제실 '업데이트·배포 이력' 전체 보기 시험: lib/factory/approvals.ts(historyPage·historyTotals·최근 목록) +
// /api/admin/factory/history(관리자만·no-store·잘못된 값 400) + 이력 패널 보기(HistoryPanelView: 최근/전체/더 보기).
// 가짜 DB(메모리)로 돌린다. 실제 DB·네트워크는 쓰지 않는다.
// 실행: npm run test:factory-history
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

// ── 가짜 DB: orderBy(배열 가능)·take·cursor+skip·count 를 Prisma 처럼 ──
const value = (v) => (v instanceof Date ? v.getTime() : v);
function sortRows(rows, orderBy) {
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      const x = value(a[k]);
      const y = value(b[k]);
      if (x !== y) return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1);
    }
    return 0;
  });
}
function table(rows, calls) {
  return {
    count: async () => rows.length,
    findMany: async (args = {}) => {
      calls.push(args);
      if (args.where?.OR) return rows.filter((r) => args.where.OR.some((c) => r.pushedCommit?.startsWith(c.pushedCommit.startsWith)));
      let list = args.orderBy ? sortRows(rows, args.orderBy) : [...rows];
      if (args.cursor) {
        const at = list.findIndex((r) => r.id === args.cursor.id);
        if (at < 0) return [];
        list = list.slice(at);
      }
      list = list.slice(args.skip ?? 0);
      return args.take === undefined ? list : list.slice(0, args.take);
    },
  };
}

const T0 = Date.UTC(2026, 9, 1, 0, 0, 0);
const MIN = 60_000;
const cuid = (p, i) => `c${p}${String(i).padStart(6, "0")}`;
// 같은 시각이 섞이게(쪽 경계에서 순서가 흔들리지 않는지): 3개씩 같은 requestedAt
const deploys = Array.from({ length: 95 }, (_, i) => ({
  id: cuid("dep", i),
  requestedAt: new Date(T0 + Math.floor(i / 3) * MIN),
  commit: `abcdef${String(i).padStart(4, "0")}`,
  via: i % 2 ? "통제실" : "자동",
  startedAt: new Date(T0 + Math.floor(i / 3) * MIN + 1000),
  finishedAt: i === 94 ? null : new Date(T0 + Math.floor(i / 3) * MIN + 200_000),
  ok: i === 94 ? null : i % 10 !== 7,
  result: i % 10 === 7 ? "빌드 실패\n로그 1\n로그 2" : "배포 완료",
  items: JSON.stringify([{ title: `정비 지시 ${i}`, commit: `f00d${i}` }]),
  maintenance: { id: cuid("thr", i % 45), title: `정비 대화 ${i % 45}` },
}));
const events = Array.from({ length: 130 }, (_, i) => ({
  id: i + 1,
  at: new Date(T0 + i * MIN),
  fromCommit: i % 4 === 0 ? `beef${String(i).padStart(3, "0")}` : null,
  commit: `c0de${String(i).padStart(3, "0")}`,
  subject: `감독 커밋 ${i}`,
  note: i % 4 === 0 ? "자동 업데이트 완료" : "이미 최신",
}));
const threads = Array.from({ length: 45 }, (_, i) => ({
  id: cuid("thr", i),
  title: `정비 대화 ${i}`,
  status: i % 5 ? "closed" : "open",
  pushedCommit: `c0de${String(i * 4).padStart(3, "0")}xxxx`,
  needsDeploy: i === 44,
  deployRequestedAt: null,
  deployedAt: i < 40 ? new Date(T0 + i * MIN) : null,
  deployResult: null,
  updatedAt: new Date(T0 + (i % 15) * MIN), // 같은 시각이 3개씩
  messages: [{ status: i % 7 === 3 ? "failed" : "done", createdAt: new Date(T0) }],
  _count: { messages: 1 + (i % 3) },
}));

const calls = [];
const prisma = {
  factoryDeploy: table(deploys, calls),
  factorySupervisorEvent: table(events, calls),
  factoryMaintenance: table(threads, calls),
};
// jobs.ts 는 의존이 많아 ID_RE 만 원본에서 읽어 온다
const ID_RE = new RegExp(fs.readFileSync(path.join(repo, "lib/factory/jobs.ts"), "utf8").match(/export const ID_RE = \/(.+)\/;/)[1]);
const approvals = loadTs("lib/factory/approvals.ts", {
  "@/lib/prisma": { __esModule: true, default: prisma },
  "@/lib/factory/jobs": { ID_RE, KIND_LABELS: {}, adminAction: async () => ({}) },
  "@/lib/factory/maintenance": {},
});

async function readAll(kind, limit) {
  const pages = [];
  let cursor = null;
  for (let n = 0; n < 50; n++) {
    const p = await approvals.historyPage(kind, { limit, cursor });
    pages.push(p);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return pages;
}

test("최근 목록(통제실 첫 화면)은 그대로 최근 것만: 배포 40 · 업데이트 40 · 정비 30", async () => {
  assert.equal((await approvals.deployHistory()).length, 40);
  assert.equal((await approvals.supervisorUpdateHistory()).length, 40);
  assert.equal((await approvals.maintenanceSummary()).length, 30);
  assert.deepEqual(await approvals.historyTotals(), { deploys: 95, updates: 130, threads: 45 });
});

test("서버 배포 전체: 20개씩 5쪽, 겹침·빠짐 없이 시간 역순, 마지막 쪽 nextCursor 없음", async () => {
  const pages = await readAll("deploys");
  assert.deepEqual(pages.map((p) => p.items.length), [20, 20, 20, 20, 15]);
  assert.ok(pages.every((p) => p.total === 95 && p.kind === "deploys"));
  assert.equal(pages.at(-1).nextCursor, null);
  const ids = pages.flatMap((p) => p.items.map((d) => d.id));
  assert.equal(new Set(ids).size, 95);
  assert.deepEqual(ids, sortRows(deploys, [{ requestedAt: "desc" }, { id: "desc" }]).map((d) => d.id));
  const first = pages[0].items[0];
  assert.equal(first.threadTitle, "정비 대화 4"); // 94 % 45
  assert.deepEqual(first.items, [{ title: "정비 지시 94", commit: "f00d94" }]);
  assert.equal(pages.flatMap((p) => p.items).filter((d) => d.ok === false).length, 9);
});

test("감독 프로그램 업데이트 전체: 숫자 cursor, limit 50 이면 50·50·30, 정비 제목 붙음", async () => {
  const pages = await readAll("updates", 50);
  assert.deepEqual(pages.map((p) => p.items.length), [50, 50, 30]);
  assert.equal(pages[0].nextCursor, "81");
  const all = pages.flatMap((p) => p.items);
  assert.deepEqual(all.map((u) => u.id), Array.from({ length: 130 }, (_, i) => 130 - i));
  assert.equal(all.find((u) => u.id === 9).thread?.title, "정비 대화 2"); // commit c0de008 ← 정비 2 의 pushedCommit
});

test("정비 대화 전체: 마지막 활동 시각이 같아도 id 로 순서 고정, 20·20·5", async () => {
  const pages = await readAll("threads");
  assert.deepEqual(pages.map((p) => p.items.length), [20, 20, 5]);
  const ids = pages.flatMap((p) => p.items.map((t) => t.id));
  assert.equal(new Set(ids).size, 45);
  assert.deepEqual(ids, sortRows(threads, [{ updatedAt: "desc" }, { id: "desc" }]).map((t) => t.id));
  const t44 = pages.flatMap((p) => p.items).find((t) => t.id === cuid("thr", 44));
  assert.equal(t44.needsDeploy, true);
});

test("limit 은 1~100 으로 묶고, 숫자가 아니면 20 · 실제로 한 개 더 읽어 다음 쪽 여부를 안다", async () => {
  calls.length = 0;
  assert.equal((await approvals.historyPage("updates", { limit: 1000 })).items.length, 100);
  assert.equal(calls.find((c) => c.orderBy?.id).take, 101);
  assert.equal((await approvals.historyPage("updates", { limit: 0 })).items.length, 1);
  assert.equal((await approvals.historyPage("updates", { limit: Number("abc") })).items.length, 20);
  assert.equal((await approvals.historyPage("deploys", { limit: 95 })).nextCursor, null);
  assert.ok((await approvals.historyPage("deploys", { limit: 94 })).nextCursor);
});

test("형식이 틀린 cursor 는 null(→ 400), 없는 cursor 는 빈 목록", async () => {
  assert.equal(await approvals.historyPage("deploys", { cursor: "../etc" }), null);
  assert.equal(await approvals.historyPage("updates", { cursor: "abc" }), null);
  assert.equal(await approvals.historyPage("threads", { cursor: "x".repeat(41) }), null);
  const none = await approvals.historyPage("deploys", { cursor: "cnothere" });
  assert.deepEqual([none.items.length, none.nextCursor], [0, null]);
});

// ── API ──
let admin = false;
const route = loadTs("app/api/admin/factory/history/route.ts", {
  "@/lib/factory/admin": { requireAdmin: async () => (admin ? null : NextResponse.json({ message: "관리자만" }, { status: 401 })) },
  "@/lib/factory/approvals": approvals,
});
const get = (qs) => route.GET(new NextRequest(`http://localhost/api/admin/factory/history?${qs}`));

test("API: 관리자만, 응답은 no-store, 잘못된 kind·cursor 는 400", async () => {
  admin = false;
  assert.equal((await get("kind=deploys")).status, 401);
  admin = true;
  const bad = await get("kind=jobs");
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("cache-control"), "no-store");
  assert.equal((await get("kind=updates&cursor=1;drop")).status, 400);
  const ok = await get("kind=deploys&limit=20");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  const body = await ok.json();
  assert.deepEqual([body.kind, body.items.length, body.total], ["deploys", 20, 95]);
  const next = await (await get(`kind=deploys&limit=20&cursor=${body.nextCursor}`)).json();
  assert.equal(next.items[0].id, sortRows(deploys, [{ requestedAt: "desc" }, { id: "desc" }])[20].id);
  assert.equal(route.dynamic, "force-dynamic");
});

// ── 이력 패널 보기 ──
const aiLib = loadTs("lib/factory/ai.ts");
const view = loadTs("components/admin/factory/FactoryOverview.tsx", {
  "./fx": { StatusDot: () => null },
  "@/lib/factory/ai": aiLib,
  "./ClaudeModelSelect": loadTs("components/admin/factory/ClaudeModelSelect.tsx", { "@/lib/factory/ai": aiLib }),
});
const json = (v) => JSON.parse(JSON.stringify(v)); // 화면은 API JSON 을 받는다(Date → 문자열)
const recent = {
  deploys: json(await approvals.deployHistory()),
  updates: json(await approvals.supervisorUpdateHistory()),
  threads: json(await approvals.maintenanceSummary()),
  totals: await approvals.historyTotals(),
};
const noop = () => {};
const render = (props) =>
  renderToStaticMarkup(h(view.HistoryPanelView, { data: recent, open: true, tab: "deploys", full: null, onToggle: noop, onTab: noop, onShowAll: noop, onMore: noop, onShowRecent: noop, ...props }));
const rows = (html) => (html.match(/rounded-lg border border-default-200 p-2 text-sm/g) ?? []).length;

test("이력 패널: 접힘 요약은 전체 개수, 탭마다 [전체 보기 · 총 N개]", () => {
  assert.match(render({ open: false }), /배포 95 · 업데이트 130 · 정비 45/);
  for (const [tab, total, shown] of [["deploys", 95, 40], ["updates", 130, 40], ["threads", 45, 30]]) {
    const html = render({ tab });
    assert.match(html, new RegExp(`전체 보기 · 총 ${total}개`));
    assert.match(html, new RegExp(`최근 ${shown}개만 보이는 중`));
    assert.match(html, /data-history="recent"/);
    assert.equal(rows(html), shown);
  }
});

test("이력 패널: 전체 보기 중에는 개수·[더 보기 (20개)]·[최근만 보기], 끝까지 읽으면 [더 보기] 없음", async () => {
  const p1 = json(await approvals.historyPage("deploys"));
  const p2 = json(await approvals.historyPage("deploys", { cursor: p1.nextCursor }));
  const items = view.mergeHistory(p1.items, [...p2.items, p1.items[19]]); // 겹친 항목은 한 번만
  assert.equal(items.length, 40);
  const mid = render({ full: { kind: "deploys", items, nextCursor: p2.nextCursor, total: 95, loading: false, error: null } });
  assert.match(mid, /data-history="all"/);
  assert.match(mid, /전체 이력 · 최신순/);
  assert.match(mid, /40 \/ 95/);
  assert.match(mid, /더 보기 \(20개\)/);
  assert.match(mid, /최근만 보기/);
  assert.doesNotMatch(mid, /전체 보기 · 총/);
  assert.equal(rows(mid), 40);

  const pages = await readAll("deploys");
  const done = render({ full: { kind: "deploys", items: json(pages.flatMap((p) => p.items)), nextCursor: null, total: 95, loading: false, error: null } });
  assert.equal(rows(done), 95);
  assert.doesNotMatch(done, /더 보기/);
  assert.match(done, /끝까지 다 봤어요/);
  // 항목마다 시각·커밋·결과·포함된 지시 제목
  assert.match(done, /요청 2026/);
  assert.match(done, /abcdef0/);
  assert.match(done, />실패</);
  assert.match(done, /정비 지시 0 \(f00d0\)/);

  // 다른 탭의 전체 목록은 이 탭에 섞이지 않는다
  const other = render({ tab: "updates", full: { kind: "deploys", items, nextCursor: null, total: 95, loading: false, error: null } });
  assert.match(other, /data-history="recent"/);
  assert.match(other, /전체 보기 · 총 130개/);

  const failed = render({ full: { kind: "deploys", items: [], nextCursor: null, total: 95, loading: false, error: "서버에 연결하지 못했어요." } });
  assert.match(failed, /서버에 연결하지 못했어요/);
});

test("예전 서버(totals 없음)에서도 [전체 보기]는 보인다", () => {
  const html = render({ data: { ...recent, totals: undefined } });
  assert.match(html, /전체 보기<\/button>/);
  assert.doesNotMatch(html, /최근 \d+개만/);
});

// ── [전체 히스토리] 탭: 세 종류를 최신순으로 합친 목록(kind=all) ──
async function readMerged(limit) {
  const pages = [];
  let cursor = null;
  for (let n = 0; n < 100; n++) {
    const p = await approvals.historyAllPage({ limit, cursor });
    pages.push(p);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return pages;
}

test("전체 히스토리: 20개씩 끝까지 읽으면 세 종류 270개가 겹침·빠짐 없이 최신순, 종류 안 순서도 그대로", async () => {
  const pages = await readMerged();
  assert.equal(pages.length, 14); // 270 = 20 × 13 + 10
  assert.deepEqual(pages.map((p) => p.items.length), [...Array(13).fill(20), 10]);
  assert.ok(pages.every((p) => p.kind === "all" && p.total === 270));
  assert.equal(pages.at(-1).nextCursor, null);
  const all = pages.flatMap((p) => p.items);
  assert.equal(new Set(all.map((m) => `${m.type}:${m.item.id}`)).size, 270);
  const times = all.map((m) => Date.parse(m.at));
  assert.ok(times.every((t, i) => i === 0 || times[i - 1] >= t), "시간 역순");
  // 종류마다 따로 읽은 전체 목록과 순서가 같다
  for (const kind of ["deploys", "updates", "threads"]) {
    const alone = (await readAll(kind)).flatMap((p) => p.items.map((i) => String(i.id)));
    assert.deepEqual(all.filter((m) => m.type === kind).map((m) => String(m.item.id)), alone);
  }
  // 제일 최근은 업데이트 130번(T0+129분)
  assert.deepEqual([all[0].type, all[0].item.id], ["updates", 130]);
  // 같은 시각이면 배포 → 업데이트 → 정비 순
  const order = { deploys: 0, updates: 1, threads: 2 };
  for (let i = 1; i < all.length; i++)
    if (times[i - 1] === times[i]) assert.ok(order[all[i - 1].type] <= order[all[i].type]);
});

test("전체 히스토리: limit 은 1~100, 잘못된 cursor 는 null(→ 400)", async () => {
  assert.equal((await approvals.historyAllPage({ limit: 1000 })).items.length, 100);
  assert.equal((await approvals.historyAllPage({ limit: 0 })).items.length, 1);
  assert.deepEqual((await readMerged(100)).map((p) => [p.items.length, !!p.nextCursor]), [[100, true], [100, true], [70, false]]);
  for (const bad of ["../etc", "d:../x", "u:abc", "x:1", "u:1.u:2", "d:", "u:1:2"])
    assert.equal(await approvals.historyAllPage({ cursor: bad }), null, bad);
  assert.deepEqual(approvals.parseAllCursor("u:5.t:cthr000001"), { updates: "5", threads: "cthr000001" });
});

test("API kind=all: 관리자만, no-store, 쪽 이어 읽기, 잘못된 cursor 400", async () => {
  admin = false;
  const denied = await get("kind=all");
  assert.equal(denied.status, 401);
  assert.doesNotMatch(JSON.stringify(await denied.json()), /items/);
  admin = true;
  const ok = await get("kind=all&limit=20");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  const body = await ok.json();
  assert.deepEqual([body.kind, body.items.length, body.total], ["all", 20, 270]);
  assert.ok(body.items.every((m) => ["deploys", "updates", "threads"].includes(m.type) && m.item && m.at));
  const next = await (await get(`kind=all&limit=20&cursor=${encodeURIComponent(body.nextCursor)}`)).json();
  assert.equal(next.items.length, 20);
  assert.ok(Date.parse(body.items[19].at) >= Date.parse(next.items[0].at));
  const bad = await get("kind=all&cursor=zz:1");
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("cache-control"), "no-store");
  assert.equal((await get("kind=everything")).status, 400);
});

const mixed = (pages) => json(pages.flatMap((p) => p.items));

test("탭 줄 맨 앞 [전체 히스토리 · 총 N개]는 접힘·펼침·탭 상관없이 늘 보인다", () => {
  for (const props of [{ open: false }, { open: true }, { tab: "updates" }, { tab: "threads" }, { tab: "all" }, { data: null, open: false }]) {
    const html = render(props);
    const tabs = html.match(/data-history-tabs[^]*?<\/div>/)[0];
    assert.match(tabs, /^data-history-tabs[^>]*>\s*<button[^>]*data-tab="all"/, "탭 줄 맨 앞");
    assert.match(tabs, /전체 히스토리/);
    assert.match(tabs, /서버 배포[^]*감독 프로그램 업데이트[^]*정비 대화/);
    if (props.data !== null) assert.match(tabs, /총 270개/);
  }
  // 예전 서버(totals 없음)는 최근 목록 길이 합
  assert.match(render({ data: { ...recent, totals: undefined } }), /총 110개/);
  // 기존 세 탭은 그대로(기본 [서버 배포] 최근 목록 + [전체 보기])
  assert.match(render({}), /전체 보기 · 총 95개/);
});

test("전체 히스토리 탭: 줄마다 종류 표시, 더 보기 → 끝까지, 종류 필터, 읽는 중·실패", async () => {
  const pages = await readMerged();
  const first = mixed(pages.slice(0, 1));
  const one = render({ tab: "all", merged: { filter: "all", items: first, nextCursor: pages[0].nextCursor, total: 270, loading: false, error: null } });
  assert.match(one, /data-history="merged"/);
  assert.match(one, /전체 히스토리 · 최신순/);
  assert.match(one, /20 \/ 270/);
  assert.match(one, /더 보기 \(20개\)/);
  assert.equal(rows(one), 20);
  assert.equal((one.match(/data-kind="/g) ?? []).length, 20);
  assert.match(one, /🔄 감독/);
  for (const f of ["all", "deploys", "updates", "threads"]) assert.match(one, new RegExp(`data-filter="${f}"`));
  assert.match(one, /data-filter="all" aria-pressed="true"/);

  const done = render({ tab: "all", merged: { filter: "all", items: view.mergeMixed(mixed(pages), first), nextCursor: null, total: 270, loading: false, error: null } });
  assert.equal(rows(done), 270);
  for (const label of ["🚀 배포", "🔄 감독", "🛠 정비"]) assert.match(done, new RegExp(label));
  assert.doesNotMatch(done, /더 보기/);
  assert.match(done, /끝까지 다 봤어요/);

  // 필터 '배포': 그 종류만(종류 표시는 배포만)
  const dep = (await readAll("deploys")).flatMap((p) => p.items.map((item) => ({ type: "deploys", item })));
  const only = render({ tab: "all", merged: { filter: "deploys", items: json(dep), nextCursor: null, total: 95, loading: false, error: null } });
  assert.equal(rows(only), 95);
  assert.deepEqual([...new Set(only.match(/data-kind="[a-z]+"/g))], ['data-kind="deploys"']);
  assert.match(only, /data-filter="deploys" aria-pressed="true"/);

  assert.match(render({ tab: "all", merged: null }), /읽는 중…/);
  const failed = render({ tab: "all", merged: { filter: "all", items: [], nextCursor: null, total: 270, loading: false, error: "서버에 연결하지 못했어요." } });
  assert.match(failed, /서버에 연결하지 못했어요/);
  assert.doesNotMatch(failed, /기록이 없어요/);
});

test("긴 로그(빌드 로그 끝부분)는 3줄까지만 보이고 [펼치기], 짧은 결과는 그대로", () => {
  const log = ["빌드 실패: next build 종료 코드 1", ...Array.from({ length: 30 }, (_, i) => `로그 ${i}`)].join("\n");
  const longDeploy = { ...recent.deploys[0], ok: false, result: log };
  const html = render({ data: { ...recent, deploys: [longDeploy, { ...recent.deploys[1], result: "배포 완료" }] } });
  assert.match(html, /data-result="folded"/);
  assert.match(html, /line-clamp-3/);
  assert.match(html, /펼치기 \(31줄\)/);
  assert.match(html, /data-result="short"/);
  assert.ok(view.isLongResult("x".repeat(181)));
  assert.ok(!view.isLongResult("한 줄\n두 줄\n세 줄"));
});
