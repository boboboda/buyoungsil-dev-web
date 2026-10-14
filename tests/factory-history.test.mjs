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
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : name === "./useFactoryControl" ? loadTs("components/admin/factory/useFactoryControl.ts") : require(name)), module, module.exports);
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
      list = args.take === undefined ? list : list.slice(0, args.take);
      // select 는 고른 열만 돌려준다(진짜 DB 처럼)
      return args.select ? list.map((r) => Object.fromEntries(Object.keys(args.select).map((k) => [k, r[k]]))) : list;
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

// 앱 일감 120개(앱 만들기·고치기·출시·실패·취소 섞임). 비밀이 될 만한 열도 일부러 채워 두고 응답에 안 새는지 본다
const JOB_STATUS = ["done", "failed", "cancelled", "pending", "approved", "running", "review", "done"];
const jobs = Array.from({ length: 120 }, (_, i) => ({
  id: cuid("job", i),
  appSlug: `app-${i % 9}`,
  title: `앱 일감 ${i}`,
  kind: i % 3 === 0 ? "new" : "revision",
  releaseKind: i % 10 === 4 ? "first" : null,
  status: JOB_STATUS[i % 8],
  aiEngine: i % 6 === 5 ? "codex" : "claude",
  aiModel: i % 4 === 1 ? "opus" : null,
  summary: i % 8 === 0 ? ["완료 요약", "줄2", "줄3", "줄4"].join(String.fromCharCode(10)) : i % 8 === 7 ? "짧은 완료 요약" : null,
  failReason: i % 8 === 1 ? "빌드 실패: 종료 코드 1" : null,
  createdAt: new Date(T0 + Math.floor(i / 2) * MIN), // 2개씩 같은 시각
  startedAt: i % 8 === 3 ? null : new Date(T0 + Math.floor(i / 2) * MIN + 5000),
  finishedAt: i % 8 === 0 ? new Date(T0 + Math.floor(i / 2) * MIN + 90_000) : null,
  planMarkdown: "# 비밀 기획서 SECRET-PLAN",
  workerId: "작업PC-SECRET-WORKER",
  resumeNote: "C:/Users/kju90/SECRET-PATH",
  toolRequests: [{ id: "x", tool: "echo" }],
  buildResult: { versionName: "9.9.9" },
}));

const calls = [];
const prisma = {
  factoryJob: table(jobs, calls),
  factoryDeploy: table(deploys, calls),
  factorySupervisorEvent: table(events, calls),
  factoryMaintenance: table(threads, calls),
};
// jobs.ts 는 의존이 많아 ID_RE 만 원본에서 읽어 온다
const ID_RE = new RegExp(fs.readFileSync(path.join(repo, "lib/factory/jobs.ts"), "utf8").match(/export const ID_RE = \/(.+)\/;/)[1]);
const approvals = loadTs("lib/factory/approvals.ts", {
  "@/lib/prisma": { __esModule: true, default: prisma },
  "@/lib/factory/jobs": { ID_RE, KIND_LABELS: { new: "새 앱", revision: "수정", release: "출시 준비" }, adminAction: async () => ({}) },
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
  assert.deepEqual(await approvals.historyTotals(), { deploys: 95, updates: 130, threads: 45, jobs: 120 });
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
  const bad = await get("kind=bogus");
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
  "./fx": loadTs("components/admin/factory/fx.tsx"),
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

test("전체 히스토리: 20개씩 끝까지 읽으면 네 종류 390개가 겹침·빠짐 없이 최신순, 종류 안 순서도 그대로", async () => {
  const pages = await readMerged();
  assert.equal(pages.length, 20); // 390 = 20 × 19 + 10
  assert.deepEqual(pages.map((p) => p.items.length), [...Array(19).fill(20), 10]);
  assert.ok(pages.every((p) => p.kind === "all" && p.total === 390));
  assert.equal(pages.at(-1).nextCursor, null);
  const all = pages.flatMap((p) => p.items);
  assert.equal(new Set(all.map((m) => `${m.type}:${m.item.id}`)).size, 390);
  const times = all.map((m) => Date.parse(m.at));
  assert.ok(times.every((t, i) => i === 0 || times[i - 1] >= t), "시간 역순");
  // 종류마다 따로 읽은 전체 목록과 순서가 같다
  for (const kind of ["deploys", "updates", "threads", "jobs"]) {
    const alone = (await readAll(kind)).flatMap((p) => p.items.map((i) => String(i.id)));
    assert.deepEqual(all.filter((m) => m.type === kind).map((m) => String(m.item.id)), alone);
  }
  // 제일 최근은 업데이트 130번(T0+129분)
  assert.deepEqual([all[0].type, all[0].item.id], ["updates", 130]);
  // 같은 시각이면 배포 → 업데이트 → 정비 순
  const order = { deploys: 0, updates: 1, threads: 2, jobs: 3 };
  for (let i = 1; i < all.length; i++)
    if (times[i - 1] === times[i]) assert.ok(order[all[i - 1].type] <= order[all[i].type]);
});

test("전체 히스토리: limit 은 1~100, 잘못된 cursor 는 null(→ 400)", async () => {
  assert.equal((await approvals.historyAllPage({ limit: 1000 })).items.length, 100);
  assert.equal((await approvals.historyAllPage({ limit: 0 })).items.length, 1);
  assert.deepEqual((await readMerged(100)).map((p) => [p.items.length, !!p.nextCursor]), [[100, true], [100, true], [100, true], [90, false]]);
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
  assert.deepEqual([body.kind, body.items.length, body.total], ["all", 20, 390]);
  assert.ok(body.items.every((m) => ["deploys", "updates", "threads", "jobs"].includes(m.type) && m.item && m.at));
  const next = await (await get(`kind=all&limit=20&cursor=${encodeURIComponent(body.nextCursor)}`)).json();
  assert.equal(next.items.length, 20);
  assert.ok(Date.parse(body.items[19].at) >= Date.parse(next.items[0].at));
  const bad = await get("kind=all&cursor=zz:1");
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("cache-control"), "no-store");
  assert.equal((await get("kind=everything")).status, 400);
});

const mixed = (pages) => json(pages.flatMap((p) => p.items));

test("탭 줄 맨 앞 [작업 진행]은 접힘·펼침·탭 상관없이 늘 보이고 순서는 작업 진행 · 서버 배포 · 감독 · 정비 · 앱 일감", () => {
  for (const props of [{ open: false }, { open: true }, { tab: "updates" }, { tab: "threads" }, { tab: "progress" }, { data: null, open: false }]) {
    const html = render(props);
    const tabs = html.match(/data-history-tabs[^]*?<\/div>/)[0];
    assert.match(tabs, /^data-history-tabs[^>]*>s*<button[^>]*data-tab="progress"/, "탭 줄 맨 앞");
    assert.doesNotMatch(tabs, /전체 히스토리/);
    assert.match(tabs, /작업 진행[^]*서버 배포[^]*감독 프로그램 업데이트[^]*정비 대화[^]*앱 일감/);
  }
  // 기존 탭은 그대로(서버 배포 최근 목록 + [전체 보기])
  assert.match(render({ tab: "deploys" }), /전체 보기 · 총 95개/);
});

test("작업 진행 탭: 진행 중 · 승인 필요 · 대기 · 최근 완료·실패 묶음, 개수, 빈 묶음은 한 줄 '없음'", () => {
  const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
  const ago = (ms) => new Date(NOW - ms).toISOString();
  const J = (n, status, extra) => ({ id: `cj${n}`, appSlug: `app-${n}`, title: `일감 ${n}`, kind: "revision", kindLabel: "수정", status, aiEngine: "claude", aiModel: "opus", result: null, createdAt: ago(n * 60000), startedAt: null, finishedAt: ago(n * 1000), ...extra });
  const jobs = [J(1, "approved"), J(2, "done"), J(3, "failed"), ...Array.from({ length: 12 }, (_, i) => J(10 + i, "done"))];
  const board = {
    active: { running: [{ type: "job", id: "cj9", title: "돌아가는 일감", sub: "timer", kindLabel: "수정", startedAt: ago(125000), aiEngine: "claude", aiModel: "opus" }], queued: 1, next: null },
    inbox: { jobs: [], turns: [{ id: "ct1", threadId: "th1", threadTitle: "정비 승인 대기", text: "x", aiEngine: "claude", source: null, createdAt: ago(60000) }], deploys: [] },
    jobs: json(jobs),
    threads: [],
  };
  const out = render({ tab: "progress", board, now: NOW });
  const sec = (k) => out.match(new RegExp(`data-board="${k}"[^]*?</section>`))[0];
  assert.match(sec("run"), /data-board-count[^>]*>1</);
  assert.match(sec("run"), /돌아가는 일감/);
  assert.match(sec("run"), /경과 2분 5초/); // 시작 후 경과
  assert.match(sec("run"), /data-kind="job"[^>]*>일감</);
  assert.match(sec("run"), /opus/);
  assert.match(sec("approval"), /정비 승인 대기/);
  assert.match(sec("approval"), /data-kind="maintenance"[^>]*>정비</);
  assert.match(sec("wait"), /요청 후 1분 0초/); // 요청 후 경과
  assert.match(sec("recent"), /data-board-count[^>]*>10</); // 최근 10개
  assert.equal((sec("recent").match(/data-board-row=/g) ?? []).length, 10);
  assert.match(sec("recent"), /fx-st-fail/);
  assert.doesNotMatch(out, /data-filter=|data-live-toggle|전체 히스토리/);
  // 비어 있는 묶음은 한 줄
  const empty = render({ tab: "progress", board: { ...board, active: { running: [], queued: 0, next: null }, inbox: { jobs: [], turns: [], deploys: [] }, jobs: [] }, now: NOW });
  assert.equal((empty.match(/data-board-empty/g) ?? []).length, 4);
  assert.equal((empty.match(/>없음</g) ?? []).length, 4);
  // 아직 못 읽었으면 읽는 중
  assert.match(render({ tab: "progress", board: undefined }), /읽는 중…/);
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

// ── 앱 일감 이력(kind=jobs) ──
const consoleTabs = loadTs("components/admin/factory/consoleTabs.ts");
const readJobs = async (limit) => {
  const pages = [];
  let cursor = null;
  for (let n = 0; n < 50; n++) {
    const p = await approvals.historyPage("jobs", { limit, cursor });
    pages.push(p);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return pages;
};

test("앱 일감: 20개씩 6쪽, 요청 시각 최신순, 겹침·빠짐 없음, 마지막 쪽 nextCursor 없음", async () => {
  const pages = await readJobs();
  assert.deepEqual(pages.map((p) => p.items.length), [20, 20, 20, 20, 20, 20]);
  assert.ok(pages.every((p) => p.kind === "jobs" && p.total === 120));
  assert.equal(pages.at(-1).nextCursor, null);
  const ids = pages.flatMap((p) => p.items.map((j) => j.id));
  assert.equal(new Set(ids).size, 120);
  assert.deepEqual(ids, sortRows(jobs, [{ createdAt: "desc" }, { id: "desc" }]).map((j) => j.id));
  // 수백 개여도 한 번에 limit+1 개만 읽는다
  calls.length = 0;
  await approvals.historyPage("jobs", { limit: 20 });
  assert.equal(calls.find((c) => c.select?.appSlug).take, 21);
  assert.equal((await approvals.historyPage("jobs", { limit: 1000 })).items.length, 100);
  assert.equal(await approvals.historyPage("jobs", { cursor: "../etc" }), null);
});

test("앱 일감: 종류·상태·모델·결과 요약이 맞고, 기획서·작업 PC 이름·경로·도구 요청은 응답에 없다", async () => {
  const all = (await readJobs(100)).flatMap((p) => p.items);
  const by = (i) => all.find((j) => j.id === cuid("job", i));
  assert.deepEqual([by(0).kind, by(0).kindLabel], ["new", "새 앱"]);
  assert.deepEqual([by(1).kind, by(1).kindLabel], ["revision", "수정"]);
  assert.deepEqual([by(4).kind, by(4).kindLabel], ["release", "출시 준비"]); // releaseKind 가 있으면 출시
  assert.equal(by(1).status, "failed");
  assert.equal(by(1).result, "빌드 실패: 종료 코드 1"); // 실패면 실패 이유
  assert.equal(by(7).result, "짧은 완료 요약");
  assert.ok(by(0).result.includes("줄4")); // 줄 바꿈은 한 줄로 합쳐 짧게
  assert.equal(by(2).result, null);
  assert.equal(by(1).aiModel, "opus");
  assert.deepEqual(Object.keys(by(0)).sort(), ["aiEngine", "aiModel", "appSlug", "createdAt", "finishedAt", "id", "kind", "kindLabel", "result", "startedAt", "status", "title"]);
  const text = JSON.stringify(all);
  for (const secret of ["SECRET-PLAN", "SECRET-WORKER", "SECRET-PATH", "toolRequests", "buildResult", "planMarkdown", "workerId", "resumeNote"])
    assert.ok(!text.includes(secret), `응답에 ${secret} 가 있으면 안 돼요`);
});

test("API kind=jobs: 관리자만, no-store, 쪽 이어 읽기, 잘못된 cursor 400, kind=all 에도 포함", async () => {
  admin = false;
  const denied = await get("kind=jobs");
  assert.equal(denied.status, 401);
  assert.doesNotMatch(JSON.stringify(await denied.json()), /items|앱 일감/);
  assert.equal((await get("kind=all")).status, 401);
  admin = true;
  const ok = await get("kind=jobs&limit=20");
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  const body = await ok.json();
  assert.deepEqual([body.kind, body.items.length, body.total], ["jobs", 20, 120]);
  assert.ok(!JSON.stringify(body).includes("SECRET"));
  const next = await (await get(`kind=jobs&limit=20&cursor=${body.nextCursor}`)).json();
  assert.equal(next.items[0].id, sortRows(jobs, [{ createdAt: "desc" }, { id: "desc" }])[20].id);
  assert.equal((await get("kind=jobs&cursor=1;drop")).status, 400);
  const mixedBody = await (await get("kind=all&limit=100")).json();
  assert.ok(mixedBody.items.some((m) => m.type === "jobs" && m.item.title && m.at));
  assert.ok(!JSON.stringify(mixedBody).includes("SECRET"));
});

test("전체 히스토리 cursor 에 일감 자리(j:)가 있고, 일감만 읽어도 시간순이 유지된다", async () => {
  assert.deepEqual(approvals.parseAllCursor("j:cjob000005.d:cdep000001"), { jobs: "cjob000005", deploys: "cdep000001" });
  assert.equal(approvals.parseAllCursor("j:../x"), null);
  const first = await approvals.historyAllPage({ limit: 100 });
  assert.ok(first.nextCursor.split(".").some((p) => p.startsWith("j:")));
});

test("탭 줄에 [앱 일감 · 총 N개]가 접힘·펼침·탭 상관없이 늘 보인다(예전 서버는 0개)", () => {
  for (const props of [{ open: false }, { open: true }, { tab: "all" }, { tab: "threads" }, { tab: "jobs" }]) {
    const html = render(props);
    const tabs = html.match(/data-history-tabs[^]*?<\/div>/)[0];
    assert.match(tabs, /data-tab="jobs"[^]*앱 일감[^]*총 120개/);
  }
  assert.match(render({ open: false }), /배포 95 · 업데이트 130 · 정비 45 · 일감 120/);
  assert.match(render({ data: { ...recent, totals: undefined } }).match(/data-history-tabs[^]*?<\/div>/)[0], /총 0개/);
  // 기존 탭 이름·동작은 그대로
  assert.match(render({}), /전체 보기 · 총 95개/);
});

test("앱 일감 탭: 줄마다 이름(앱)·종류·상태·요청/시작/완료·모델·결과 요약, 누르면 [일감] 탭 상세로", async () => {
  const items = json((await readJobs(100)).flatMap((p) => p.items));
  const html = render({ tab: "jobs", full: { kind: "jobs", items: items.slice(0, 20), nextCursor: "next", total: 120, loading: false, error: null } });
  assert.match(html, /data-history="all"/);
  assert.equal(rows(html), 20);
  assert.match(html, /20 \/ 120/);
  assert.match(html, /더 보기 \(20개\)/);
  assert.match(html, /href="\/admin\/factory\?tab=jobs&amp;job=cjob000119"/);
  assert.match(html, /앱 일감 119/);
  assert.match(html, /app-2/);
  for (const label of ["완료", "실패", "취소", "승인 필요", "대기", "진행 중", "검토 필요", "새 앱", "수정", "출시 준비"]) assert.match(html, new RegExp(label));
  assert.match(html, /요청 [^<]*<\/span><span>시작 [^<]*<\/span><span>완료/);
  assert.match(html, /모델: /); // 모델을 고른 일감
  const longJob = render({ tab: "jobs", full: { kind: "jobs", items: [{ ...items[0], result: "긴 결과 ".repeat(80) }], nextCursor: null, total: 1, loading: false, error: null } });
  assert.match(longJob, /data-result="folded"/); // 긴 요약은 접고 [펼치기]
  assert.match(longJob, /펼치기/);
  assert.match(html, /data-result="short"/);
  assert.doesNotMatch(html, /SECRET/);
  // 끝까지 읽으면 [더 보기] 없음
  const done = render({ tab: "jobs", full: { kind: "jobs", items, nextCursor: null, total: 120, loading: false, error: null } });
  assert.equal(rows(done), 120);
  assert.doesNotMatch(done, /더 보기/);
  assert.match(done, /끝까지 다 봤어요/);
  // 읽는 중·비었음·실패
  assert.match(render({ tab: "jobs", full: null }), /읽는 중…/);
  assert.match(render({ tab: "jobs", full: { kind: "jobs", items: [], nextCursor: null, total: 0, loading: false, error: null } }), /앱 일감 기록이 없어요/);
  assert.match(render({ tab: "jobs", full: { kind: "jobs", items, nextCursor: "n", total: 120, loading: false, error: "서버에 연결하지 못했어요." } }), /서버에 연결하지 못했어요/);
});

test("[일감] 탭 목록 제한 안내·주소 연결·인덱스", () => {
  const control = fs.readFileSync(path.join(repo, "components/admin/factory/FactoryControl.tsx"), "utf8");
  const jobsRoute = fs.readFileSync(path.join(repo, "app/api/admin/factory/jobs/route.ts"), "utf8");
  assert.match(jobsRoute, /get\("limit"\) \?\? "50"/);
  assert.match(control, /JOB_LIST_LIMIT = 50/);
  assert.match(control, /jobs\.length >= JOB_LIST_LIMIT/);
  assert.match(control, /data-job-limit/);
  assert.match(control, /tab=status&history=jobs/);
  assert.match(control, /useState<string \| null>\(initialJobId\)/);
  // 주소 해석: 모르는 값은 무시
  assert.equal(consoleTabs.parseHistoryTab("jobs"), "jobs");
  assert.equal(consoleTabs.parseHistoryTab("zzz"), undefined);
  assert.equal(consoleTabs.parseHistoryTab(["progress", "x"]), "progress");
  assert.equal(consoleTabs.parseJobId("cjob000001"), "cjob000001");
  assert.equal(consoleTabs.parseJobId("../etc"), null);
  assert.equal(consoleTabs.parseJobId("a".repeat(41)), null);
  assert.equal(consoleTabs.parseJobId(undefined), null);
  assert.equal(consoleTabs.parseFactoryTab("jobs"), "jobs");
  // 인덱스만 추가하는 마이그레이션(데이터는 그대로)
  const dir = fs.readdirSync(path.join(repo, "prisma/migrations")).find((d) => d.endsWith("factory_jobs_created_index"));
  const sql = fs.readFileSync(path.join(repo, "prisma/migrations", dir, "migration.sql"), "utf8").replace(/--.*$/gm, "").trim();
  assert.match(sql, /^CREATE INDEX IF NOT EXISTS "factory_jobs_createdAt_id_idx" ON "factory_jobs"\("createdAt", "id"\);$/);
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE|ALTER/i);
  assert.match(fs.readFileSync(path.join(repo, "prisma/schema.prisma"), "utf8"), /@@index\(\[createdAt, id\]\)[^\n]*\n\s*@@map\("factory_jobs"\)/);
});
