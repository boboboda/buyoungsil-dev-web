// 4-1 시험: 통제실 [현황] '할 일' 넓히기.
//  - 항목이 생기고 사라진다: 막힘·다시 시작 필요·키 부족(일감·카드)·묶음 승인·스튜디오 검수 대기·업데이트 일시 중지/묶는 중
//  - 우선순위 정렬: 막힘·실패 > 승인 > 정보 / 항목마다 처리 단추(다시 시도·묶음 승인·이동)
//  - 텔레그램 알림은 한 번만(키 부족·묶음 승인·막힘·다시 시작 필요·비용 한도), 풀리면 기록을 지워 다시 생기면 새로 알림, 전송 실패면 다시 시도
//  - 채팅 커넥터 get_inbox(읽기 전용)와 화면(할 일 줄·보드의 업데이트 일시 중지 표시)
// 가짜 DB·가짜 텔레그램 주소로만 돌린다. 실행: node tests/inbox.test.mjs
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

const anything = () => new Proxy(function () {}, { get: (t, k) => (k === "__esModule" ? true : k === "then" ? undefined : anything()), apply: () => anything() });
function loadTs(relative, dependencies = {}) {
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  const req = (name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : name === "./useFactoryControl" ? loadTs("components/admin/factory/useFactoryControl.ts") : name.startsWith("@/") ? anything() : require(name));
  new Function("require", "module", "exports", output)(req, module, module.exports);
  return module.exports;
}

// ── 가짜 DB: factorySetting(알림 기록)만 실제처럼 동작(기본 키 중복이면 P2002) ──
const settings = new Map();
const dupe = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
const startsWith = (k, w) => (w?.key?.startsWith ? k.startsWith(w.key.startsWith) : true);
const prisma = {
  factorySetting: {
    create: async ({ data }) => {
      if (settings.has(data.key)) throw dupe();
      settings.set(data.key, data.value);
      return data;
    },
    findMany: async ({ where }) => [...settings.keys()].filter((k) => startsWith(k, where)).map((key) => ({ key })),
    deleteMany: async ({ where }) => {
      const keys = [...settings.keys()].filter((k) => (where.key?.in ? where.key.in.includes(k) : typeof where.key === "string" ? k === where.key : false));
      for (const k of keys) settings.delete(k);
      return { count: keys.length };
    },
  },
  factoryJob: { findUnique: async ({ where }) => jobs.find((j) => j.id === where.id) ?? null, findMany: async () => [] },
};
let jobs = [];

// ── 가짜 텔레그램: fetch 를 가로챈다 ──
const sent = [];
let sendOk = true;
process.env.TELEGRAM_BOT_TOKEN = "123:fake";
process.env.TELEGRAM_CHAT_ID = "42";
process.env.FACTORY_PUBLIC_URL = "http://127.0.0.1:1";
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  if (String(url).includes("/sendMessage")) {
    if (!sendOk) return { json: async () => ({ ok: false, description: "fail" }) };
    sent.push(body.text);
  }
  return { json: async () => ({ ok: true, result: {} }) };
};

const notice = loadTs("lib/factory/inboxNotice.ts", { "@/lib/prisma": { __esModule: true, default: prisma } });
const tg = loadTs("lib/factory/telegram.ts", {
  "@/lib/prisma": { __esModule: true, default: prisma },
  "@/lib/factory/jobs": { ID_RE: /^[A-Za-z0-9_-]{1,40}$/, KIND_LABELS: { new: "새 앱", revision: "수정", tool: "도구" } },
  "@/lib/factory/approvals": { runApproval: async () => ({ ok: true, status: 200, message: "" }) },
  "@/lib/factory/mask": { maskSecrets: (v) => v ?? "" },
  "@/lib/factory/appName": { releaseAppName: async (_s, t) => t },
  "@/lib/factory/ai": { CLAUDE_MODELS: ["opus"] },
  "@/lib/factory/inboxNotice": notice,
});

// 읽기 쪽 가짜 재료(readInboxItems 가 부르는 DB)
const db = { failed: [], keyJobs: [], groupJobs: [], arts: [], cards: [], registered: [], tools: {} };
const inboxPrisma = {
  ...prisma,
  factoryJob: {
    findMany: async ({ where }) => {
      if (where.status === "failed") return db.failed;
      if (where.parallelGroup) return db.groupJobs;
      if (where.NOT) return db.keyJobs;
      if (where.status === "needs_confirmation") return db.confirm ?? [];
      return [];
    },
  },
  factoryArt: { groupBy: async () => db.arts.map((a) => ({ appSlug: a.appSlug, _count: { _all: a.count } })) },
  factoryCard: { findMany: async () => db.cards },
};
const inbox = loadTs("lib/factory/inbox.ts", {
  "@/lib/prisma": { __esModule: true, default: inboxPrisma },
  "@/lib/factory/cards": { readCardData: (r) => ({ tool: r.tool, method: r.method }) },
  "@/lib/factory/parallel": { PARALLEL_KIND: "revision" },
  "@/lib/factory/secretEntries": { knownSecretNames: async () => db.registered.map((name) => ({ name, description: "" })) },
  "@/lib/factory/toolManifestDb": { readManifestTools: async () => db.tools },
  "@/lib/factory/toolManifest": { methodSecrets: (m, id) => m.methods.find((x) => x.id === id)?.secrets ?? [] },
  "@/lib/factory/telegram": tg,
  "@/lib/factory/inboxNotice": notice,
});

const reset = () => {
  Object.assign(db, { failed: [], keyJobs: [], groupJobs: [], arts: [], cards: [], registered: [], tools: {}, confirm: [] });
  settings.clear();
  sent.length = 0;
  sendOk = true;
  jobs = [];
  inbox.resetInboxSyncThrottle();
};
const kinds = (items) => items.map((i) => i.kind);
const base = { failedJobs: [], jobsWithKeys: [], cardsWithKeys: [], registered: new Set(), groupJobs: [], studioReview: [] };

test("막힘·다시 시작 필요: 실패 단계가 stuck·resume 인 일감만 항목이 되고, 다시 시도·일감 보기 단추가 있다", () => {
  const items = inbox.buildInboxItems({
    ...base,
    failedJobs: [
      { id: "j1", appSlug: "app-a", title: "시험 반복", failStage: "stuck", failReason: "같은 시험을 4번 반복" },
      { id: "j2", appSlug: "app-b", title: "이어 하기 실패", failStage: "resume", failReason: "세션을 못 찾음" },
      { id: "j3", appSlug: "app-c", title: "그냥 실패", failStage: "build", failReason: "x" },
    ],
  });
  assert.deepEqual(kinds(items), ["stuck", "resume"]);
  assert.ok(items.every((i) => i.tier === "blocked"));
  const [stuck, resume] = items;
  assert.match(stuck.detail, /^막힘/);
  assert.match(resume.detail, /^다시 시작 필요/);
  assert.deepEqual(stuck.actions.map((a) => [a.id, a.jobId ?? a.href]), [["retry", "j1"], ["link", "/admin/factory?tab=jobs&job=j1"]]);
  assert.equal(stuck.noticeKey, "job:j1:stuck");
  assert.equal(resume.noticeKey, "job:j2:resume");
  // 사라짐: 다시 시도해서 실패가 아니게 되면(재료에서 빠지면) 항목도 없다
  assert.deepEqual(inbox.buildInboxItems(base), []);
});

test("키 부족: 등록 안 된 키 이름마다 한 건(일감·카드 모두), 등록하면 사라진다", () => {
  const facts = {
    ...base,
    jobsWithKeys: [{ id: "j1", appSlug: "app-a", title: "그림 만들기", requiredSecrets: ["PIXELLAB_TOKEN", "OTHER_KEY"] }, { id: "j2", appSlug: "app-b", title: "다른 일", requiredSecrets: ["PIXELLAB_TOKEN"] }],
    cardsWithKeys: [{ id: "c1", appSlug: "app-a", name: "기본 카드", secrets: ["PIXELLAB_TOKEN"] }],
    registered: new Set(["OTHER_KEY"]),
  };
  const items = inbox.buildInboxItems(facts);
  assert.equal(items.length, 1);
  assert.equal(items[0].key, "keys:PIXELLAB_TOKEN");
  assert.equal(items[0].tier, "blocked");
  assert.match(items[0].detail, /일감 2개/);
  assert.match(items[0].detail, /카드 1개/);
  assert.equal(items[0].actions[0].href, "/admin/factory?tab=settings");
  assert.ok(!JSON.stringify(items).includes("fake")); // 키 값은 어디에도 없다
  // 등록하면 사라진다
  assert.deepEqual(inbox.buildInboxItems({ ...facts, registered: new Set(["OTHER_KEY", "PIXELLAB_TOKEN"]) }), []);
  // 카드만 필요한 경우도 한 건
  const cardOnly = inbox.buildInboxItems({ ...base, cardsWithKeys: facts.cardsWithKeys });
  assert.deepEqual(kinds(cardOnly), ["keys"]);
  assert.match(cardOnly[0].detail, /일감|카드 1개/);
});

test("묶음 승인 대기: 묶음 안에 승인 대기가 남아 있을 때만, 묶음 승인 단추는 한 번에 처리할 일감 id 를 가진다", () => {
  const g = (id, status, group = "g-1", app = "app-a") => ({ id, appSlug: app, title: `일감 ${id}`, status, parallelGroup: group });
  const items = inbox.buildInboxItems({ ...base, groupJobs: [g("a", "approved"), g("b", "pending"), g("c", "pending"), g("x", "pending", "g-2", "app-b")] });
  assert.deepEqual(kinds(items), ["group"]); // g-2 는 일감 1개뿐이라 묶음이 아니다
  assert.equal(items[0].tier, "approval");
  assert.deepEqual(items[0].actions.map((a) => [a.id, a.jobId, a.label]), [["approve_group", "b", "묶음 승인 (2개)"]]);
  assert.equal(items[0].noticeKey, "group:app-a:g-1");
  // 모두 승인되면 사라진다
  assert.deepEqual(inbox.buildInboxItems({ ...base, groupJobs: [g("a", "approved"), g("b", "approved"), g("c", "approved")] }), []);
});

test("스튜디오 검수 대기: 프로젝트별로 한 건, 누르면 스튜디오 운영 탭으로 가고, 0장이면 사라진다", () => {
  const items = inbox.buildInboxItems({ ...base, studioReview: [{ appSlug: "app-a", count: 3 }, { appSlug: "app-b", count: 0 }, { appSlug: "app-c", count: 7 }] });
  assert.deepEqual(items.map((i) => i.key), ["studio:app-c", "studio:app-a"]); // 많은 쪽 먼저
  assert.equal(items[1].actions[0].href, "/studio/app-a?tab=ops");
  assert.equal(items[1].tier, "approval");
  assert.deepEqual(inbox.buildInboxItems({ ...base, studioReview: [{ appSlug: "app-a", count: 0 }] }), []);
});

test("업데이트 일시 중지·묶는 중: 정보 단계, 감독이 알리면 생기고 끝나면 사라진다 / 감독 상태를 모르면 만들지 않는다", () => {
  const paused = inbox.buildInboxItems({ ...base, supervisor: { pausedJobs: 2, bundleLeftMin: 0 } });
  assert.deepEqual(kinds(paused), ["update_paused"]);
  assert.match(paused[0].title, /업데이트로 일시 중지 2개/);
  const bundling = inbox.buildInboxItems({ ...base, supervisor: { pausedJobs: 0, bundleLeftMin: 25 } });
  assert.deepEqual(kinds(bundling), ["update_bundle"]);
  assert.match(bundling[0].title, /묶는 중, 남은 25분/);
  const draining = inbox.buildInboxItems({ ...base, supervisor: { drainState: "update", drainJobs: 1 } });
  assert.deepEqual(kinds(draining), ["update_paused"]);
  const both = inbox.buildInboxItems({ ...base, supervisor: { pausedJobs: 1, bundleLeftMin: 5 } });
  assert.deepEqual(kinds(both), ["update_paused", "update_bundle"]);
  assert.ok(both.every((i) => i.tier === "info" && i.noticeKey === undefined)); // 알림 대상이 아니다
  assert.deepEqual(inbox.buildInboxItems({ ...base, supervisor: { pausedJobs: 0, bundleLeftMin: null, drainState: null } }), []);
  assert.deepEqual(inbox.buildInboxItems({ ...base, supervisor: null }), []);
  assert.deepEqual(inbox.buildInboxItems({ ...base, supervisor: { drainState: "deploy" } }), []); // 서버 배포 대기는 업데이트 상태가 아니다
});

test("우선순위 정렬: 막힘·실패 > 승인 > 정보, 같은 단계는 들어온 순서", () => {
  const items = inbox.buildInboxItems({
    ...base,
    failedJobs: [{ id: "j1", appSlug: "app-a", title: "막힘", failStage: "stuck", failReason: "" }],
    jobsWithKeys: [{ id: "j2", appSlug: "app-a", title: "키", requiredSecrets: ["K1"] }],
    groupJobs: [{ id: "g1", appSlug: "app-a", title: "a", status: "pending", parallelGroup: "g" }, { id: "g2", appSlug: "app-a", title: "b", status: "approved", parallelGroup: "g" }],
    studioReview: [{ appSlug: "app-a", count: 1 }],
    supervisor: { pausedJobs: 1 },
  });
  assert.deepEqual(kinds(items), ["stuck", "keys", "group", "studio_review", "update_paused"]);
  assert.deepEqual(inbox.sortInbox([{ tier: "info", n: 1 }, { tier: "approval", n: 2 }, { tier: "blocked", n: 3 }, { tier: "approval", n: 4 }]).map((x) => x.n), [3, 2, 4, 1]);
});

test("readInboxItems: DB 에서 읽어 같은 항목을 만들고, 못 읽는 설명서는 카드 키만 건너뛴다", async () => {
  reset();
  db.failed = [{ id: "j1", appSlug: "app-a", title: "막힘 일감", failStage: "stuck", failReason: "반복" }];
  db.keyJobs = [{ id: "j2", appSlug: "app-a", title: "그림", requiredSecrets: ["PIXELLAB_TOKEN"] }];
  db.groupJobs = [{ id: "g1", appSlug: "app-a", title: "a", status: "pending", parallelGroup: "g" }, { id: "g2", appSlug: "app-a", title: "b", status: "approved", parallelGroup: "g" }];
  db.arts = [{ appSlug: "app-a", count: 2 }];
  db.cards = [{ id: "c1", appSlug: "app-a", name: "카드", tool: "pixel-art", method: "pixellab", enabled: true }];
  db.tools = { "pixel-art": { methods: [{ id: "pixellab", secrets: ["PIXELLAB_TOKEN"] }] } };
  const items = await inbox.readInboxItems({ pausedJobs: 1 });
  assert.deepEqual(kinds(items), ["stuck", "keys", "group", "studio_review", "update_paused"]);
  assert.match(items.find((i) => i.kind === "keys").detail, /카드 1개/);
  // 키 등록 + 막힘 일감 재시도 + 검수 끝 → 해당 항목이 사라진다
  db.registered = ["PIXELLAB_TOKEN"];
  db.failed = [];
  db.arts = [];
  assert.deepEqual(kinds(await inbox.readInboxItems()), ["group"]);
});

test("텔레그램 중복 방지: 같은 이름의 알림은 한 번만, 전송 실패면 기록을 지워 다시 시도, 안 켜져 있으면 보내지 않는다", async () => {
  reset();
  assert.equal(await tg.notifyOnce("keys:A", "키 부족 A"), true);
  assert.equal(await tg.notifyOnce("keys:A", "키 부족 A"), false);
  assert.equal(await tg.notifyOnce("keys:B", "키 부족 B"), true);
  assert.deepEqual(sent, ["키 부족 A", "키 부족 B"]);
  // 동시에 두 곳에서 불러도 한 번
  const both = await Promise.all([tg.notifyOnce("keys:C", "C"), tg.notifyOnce("keys:C", "C")]);
  assert.deepEqual(both.sort(), [false, true]);
  assert.equal(sent.filter((t) => t === "C").length, 1);
  // 전송 실패 → 기록을 지워서 다음에 다시 보낸다
  sendOk = false;
  assert.equal(await tg.notifyOnce("keys:D", "D"), false);
  assert.ok(!settings.has("inboxNotice:keys:D"));
  sendOk = true;
  assert.equal(await tg.notifyOnce("keys:D", "D"), true);
  // 텔레그램이 꺼져 있으면(토큰 없음) 기록도 남기지 않는다
  const token = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.equal(await tg.notifyOnce("keys:E", "E"), false);
  assert.ok(!settings.has("inboxNotice:keys:E"));
  process.env.TELEGRAM_BOT_TOKEN = token;
});

test("알림 동기화: 키 부족·묶음 승인은 처음 한 번만 보내고, 풀리면 기록을 지우고, 다시 생기면 새로 알린다", async () => {
  reset();
  db.keyJobs = [{ id: "j1", appSlug: "app-a", title: "그림", requiredSecrets: ["PIXELLAB_TOKEN"] }];
  db.groupJobs = [{ id: "g1", appSlug: "app-a", title: "a", status: "pending", parallelGroup: "g" }, { id: "g2", appSlug: "app-a", title: "b", status: "approved", parallelGroup: "g" }];
  db.failed = [{ id: "j9", appSlug: "app-a", title: "막힘", failStage: "stuck", failReason: "x" }];
  const r1 = await inbox.syncInboxNotices({ force: true });
  assert.deepEqual(r1.sent.sort(), ["group:app-a:g", "keys:PIXELLAB_TOKEN"]);
  assert.equal(sent.length, 2);
  assert.match(sent.find((t) => t.startsWith("🔑")), /PIXELLAB_TOKEN/);
  assert.match(sent.find((t) => t.startsWith("📦")), /묶음 승인/);
  // 같은 상태로 몇 번을 다시 불러도 더 보내지 않는다(30초 간격 제한이 없는 force 로도)
  await inbox.syncInboxNotices({ force: true });
  await inbox.syncInboxNotices({ force: true });
  assert.equal(sent.length, 2);
  // 30초 안의 반복 호출은 아예 읽지 않는다
  inbox.resetInboxSyncThrottle();
  await inbox.syncInboxNotices();
  const before = sent.length;
  await inbox.syncInboxNotices();
  assert.equal(sent.length, before);
  // 막힘 알림 기록은 일감이 막혀 있는 동안 남는다(notifyJobEvent 가 만든 기록을 동기화가 지우지 않는다)
  settings.set("inboxNotice:job:j9:stuck", "t");
  await inbox.syncInboxNotices({ force: true });
  assert.ok(settings.has("inboxNotice:job:j9:stuck"));
  // 키를 등록하고 묶음을 승인 → 기록 정리(막힘 일감도 재시도되어 사라짐)
  db.registered = ["PIXELLAB_TOKEN"];
  db.groupJobs = [];
  db.failed = [];
  await inbox.syncInboxNotices({ force: true });
  assert.deepEqual([...settings.keys()], []);
  // 다시 생기면 새로 알린다
  db.registered = [];
  const r3 = await inbox.syncInboxNotices({ force: true });
  assert.deepEqual(r3.sent, ["keys:PIXELLAB_TOKEN"]);
  assert.equal(sent.length, 3);
});

test("일감 알림 한 번만: 막힘·다시 시작 필요·비용 한도는 일감마다 한 번, 일반 실패는 그대로", async () => {
  reset();
  const job = (over) => ({ id: "j1", appSlug: "app-a", title: "그림", kind: "new", summary: null, failReason: "사유", source: null, status: "failed", releaseKind: null, failStage: null, phase: null, aiEngine: "claude", ...over });
  // 막힘
  jobs = [job({ failStage: "stuck" })];
  await tg.notifyJobEvent("j1", "failed");
  await tg.notifyJobEvent("j1", "failed");
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^🚧 막힘/);
  assert.match(sent[0], /\[다시 시도\]/);
  // 다시 시작 필요
  jobs = [job({ id: "j2", failStage: "resume" })];
  await tg.notifyJobEvent("j2", "failed");
  await tg.notifyJobEvent("j2", "failed");
  assert.equal(sent.length, 2);
  assert.match(sent[1], /^⏸ 다시 시작 필요/);
  // 비용 한도
  jobs = [job({ id: "j3", status: "needs_confirmation", failReason: "일 한도 초과" })];
  await tg.notifyJobEvent("j3", "needs_confirmation");
  await tg.notifyJobEvent("j3", "needs_confirmation");
  assert.equal(sent.length, 3);
  assert.match(sent[2], /확인 필요\(비용 한도\)/);
  // 일반 실패는 (예전처럼) 보고마다 알린다
  jobs = [job({ id: "j4", failStage: "build" })];
  await tg.notifyJobEvent("j4", "failed");
  await tg.notifyJobEvent("j4", "failed");
  assert.equal(sent.length, 5);
  // 풀렸다가(동기화가 기록을 지움) 다시 막히면 새로 알린다
  jobs = [job({ failStage: "stuck" })];
  await inbox.syncInboxNotices({ force: true, items: [], confirmIds: [] });
  assert.deepEqual([...settings.keys()], []);
  await tg.notifyJobEvent("j1", "failed");
  assert.equal(sent.length, 6);
  // 전송 실패면 기록을 지워 다음 보고에 다시 알린다
  jobs = [job({ id: "j5", failStage: "stuck" })];
  sendOk = false;
  await tg.notifyJobEvent("j5", "failed");
  assert.ok(!settings.has("inboxNotice:job:j5:stuck"));
  sendOk = true;
  await tg.notifyJobEvent("j5", "failed");
  assert.equal(sent.length, 7);
});

test("get_inbox: 읽기 전용 도구로 목록에 있고, 우선순위순으로 기존 승인 + 새 항목을 합쳐 주며, 단계 필터와 잘못된 값 거절", async () => {
  const lib = loadTs("lib/factory/mcp.ts", {
    "@/lib/prisma": { __esModule: true, default: {} },
    "@/lib/factory/supervisor": { supervisorSnapshot: async () => ({ pausedJobs: 1, bundleLeftMin: 10 }), runSupervisorAction: async () => ({}), SUPERVISOR_ACTIONS: [] },
    "@/lib/factory/jobs": { ACTIVE_STATUSES: [], APP_SLUG_RE: /^x$/, ID_RE: /^x$/, JOB_KINDS: [], adminAction: () => null, JOB_STATUSES: [], MAX_PENDING_JOBS: 30, MAX_PLAN: 60000, MIN_PLAN: 50, STACK_LABELS: {}, STACKS: [] },
    "@/lib/factory/parallel": { MAX_GROUP_SIZE: 4, newGroupId: () => "g", PARALLEL_KIND: "revision", SOURCE_MANUAL: "manual" },
    "@/lib/factory/approvals": {
      approvalInbox: async () => ({
        jobs: [{ id: "p1", appSlug: "app-a", title: "승인 일감", kindLabel: "수정", createdAt: new Date() }],
        confirmations: [{ id: "c1", appSlug: "app-a", title: "비용 일감", kind: "tool", reason: "일 한도 초과" }],
        turns: [{ id: "t1", threadTitle: "정비 지시", text: "무언가" }],
        deploys: [{ threadId: "m1", title: "정비 배포", commit: "abcdef123", inProgress: false, canDeploy: true }],
      }),
    },
    "@/lib/factory/inbox": {
      ...inbox,
      readInboxItems: async (sup) =>
        inbox.buildInboxItems({ ...base, failedJobs: [{ id: "j1", appSlug: "app-a", title: "막힘 일감", failStage: "stuck", failReason: "반복" }], supervisor: sup }),
    },
  });
  const tool = lib.FACTORY_TOOLS.find((t) => t.name === "get_inbox");
  assert.ok(tool, "get_inbox 가 도구 목록에 있다");
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.ok(lib.isFactoryTool("get_inbox"));
  const res = await lib.callFactoryTool("get_inbox", {});
  assert.ok(!res.isError);
  const out = JSON.parse(res.content[0].text);
  assert.equal(out.할_일_수, 7);
  assert.deepEqual(out.단계별, { 막힘_실패: 1, 승인: 4, 정보: 2 });
  assert.deepEqual(out.할_일.map((x) => x.단계).filter((v, i, a) => a.indexOf(v) === i), ["막힘·실패", "승인", "정보"]);
  assert.equal(out.할_일[0].종류, "stuck");
  assert.ok(out.할_일.some((x) => x.종류 === "cost" && /그대로 진행/.test(x.처리)));
  assert.ok(out.할_일.every((x) => typeof x.처리 === "string" && x.처리.length > 0));
  const only = JSON.parse((await lib.callFactoryTool("get_inbox", { tier: "info" })).content[0].text);
  assert.ok(only.할_일.every((x) => x.단계 === "정보"));
  const bad = await lib.callFactoryTool("get_inbox", { tier: "nope" });
  assert.equal(bad.isError, true);
});

// ── 화면 ──
const fx = loadTs("components/admin/factory/fx.tsx");
const aiLib = loadTs("lib/factory/ai.ts");
const view = loadTs("components/admin/factory/FactoryOverview.tsx", { "./PlanReviewRow": { __esModule: true, default: () => null },
  "./fx": fx,
  "@/lib/factory/ai": aiLib,
  "./ClaudeModelSelect": loadTs("components/admin/factory/ClaudeModelSelect.tsx", { "@/lib/factory/ai": aiLib }),
});
const html = (el) => renderToStaticMarkup(el);

test("화면: 할 일 줄은 단계(order)로 줄 세우고, 항목마다 단추(다시 시도·묶음 승인·이동)가 있다", () => {
  const items = inbox.buildInboxItems({
    ...base,
    failedJobs: [{ id: "j1", appSlug: "app-a", title: "막힘 일감", failStage: "stuck", failReason: "반복" }],
    groupJobs: [{ id: "g1", appSlug: "app-a", title: "a", status: "pending", parallelGroup: "g" }, { id: "g2", appSlug: "app-a", title: "b", status: "approved", parallelGroup: "g" }],
    studioReview: [{ appSlug: "app-a", count: 2 }],
    supervisor: { pausedJobs: 1 },
  });
  const rows = items.map((it) => html(h(view.InboxItemRow, { item: it, busy: false, onRetry() {}, onGroupApprove() {} })));
  const by = (kind) => rows[items.findIndex((i) => i.kind === kind)];

  assert.match(by("stuck"), /data-inbox-tier="blocked"/);
  assert.match(by("stuck"), /style="order:0"/);
  assert.match(by("stuck"), /data-inbox-action="retry"[^>]*>다시 시도/);
  assert.match(by("stuck"), /href="\/admin\/factory\?tab=jobs&amp;job=j1"/);
  assert.match(by("group"), /style="order:1"/);
  assert.match(by("group"), /data-inbox-action="approve_group"[^>]*>묶음 승인 \(1개\)/);
  assert.match(by("studio_review"), /href="\/studio\/app-a\?tab=ops"/);
  assert.match(by("update_paused"), /style="order:2"/);
  assert.match(by("update_paused"), /업데이트로 일시 중지 1개/);
  assert.ok(!/data-inbox-action/.test(by("update_paused")), "정보 줄은 처리 단추가 없다(이동 링크만)");
  assert.equal(view.TIER_ORDER.blocked < view.TIER_ORDER.approval && view.TIER_ORDER.approval < view.TIER_ORDER.info, true);
});

test("화면: 4구역 보드의 진행 중 구역에 '업데이트로 일시 중지'·'묶는 중' 표시가 생기고, 끝나면 사라진다", () => {
  assert.deepEqual(view.boardUpdateNotes(undefined), []);
  assert.deepEqual(view.boardUpdateNotes({ pausedJobs: 0, bundleLeftMin: null, drainState: null }), []);
  assert.match(view.boardUpdateNotes({ pausedJobs: 2 })[0].text, /업데이트로 일시 중지 2개/);
  assert.match(view.boardUpdateNotes({ bundleLeftMin: 12 })[0].text, /묶는 중, 남은 12분/);
  assert.match(view.boardUpdateNotes({ drainState: "update" })[0].text, /업데이트 중/);
  assert.equal(view.boardUpdateNotes({ drainState: "deploy" }).length, 0);
  const board = (supervisor) => ({
    active: { running: [{ type: "job", id: "r1", title: "돌고 있는 일감", kindLabel: "수정", startedAt: new Date().toISOString() }], queued: 0, next: null },
    inbox: { jobs: [], turns: [], deploys: [] },
    jobs: [],
    threads: [],
    supervisor,
  });
  const panel = (supervisor) => html(h(view.HistoryPanelView, { data: { deploys: [], updates: [], threads: [], totals: {} }, open: true, tab: "progress", full: null, board: board(supervisor), now: Date.now(), onToggle() {}, onTab() {}, onShowAll() {}, onMore() {}, onShowRecent() {} }));
  const on = panel({ pausedJobs: 1, bundleLeftMin: 8 });
  assert.match(on, /data-board-update="paused"/);
  assert.match(on, /data-board-update="bundle"/);
  assert.ok(on.indexOf('data-board="run"') < on.indexOf("data-board-update"), "진행 중 구역 안에 있다");
  assert.ok(!/data-board-update/.test(panel({ pausedJobs: 0 })));
});

test("화면 코드: 비용 한도 줄은 도구/앱 일감을 구분하고, 새 항목 단추는 기존 API(일감 재시도·묶음 승인)를 부른다", () => {
  const src = read("components/admin/factory/FactoryOverview.tsx");
  assert.match(src, /c\.kind === "tool" \? "🛠 도구 일감" : "📱 앱 일감"/);
  assert.match(src, /jobAction\("retry", id,/);
  assert.match(src, /action: "approve-group", jobId/);
  assert.match(src, /\/api\/admin\/factory\/queue/);
  assert.match(src, /extra\.filter\(\(i\) => i\.tier !== "info"\)\.length/); // 정보 줄은 할 일 수에 넣지 않는다
  const route = read("app/api/admin/factory/overview/route.ts");
  assert.match(route, /readInboxItems\(supervisor\)/);
  assert.match(route, /return \{ supervisor, inbox, updates, deploys, threads, totals, active(, autoApproved)? \}/);
  const next = read("app/api/factory/next/route.ts");
  assert.match(next, /syncInboxNotices/);
  assert.match(read("lib/factory/approvals.ts"), /title: true, kind: true, failReason: true/); // 확인 대기 일감의 종류
});
