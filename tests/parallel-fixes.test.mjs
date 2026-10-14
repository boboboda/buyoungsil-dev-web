// 병렬화 C 보완(첫 실사용 시험에서 나온 문제 3가지) 시험:
//  1) 승인 전(pending)에도 묶기 · 묶음 한 번에 승인 · 묶음 중 일부만 승인된 동안은 가져가지 않기 · 채팅 도구 parallelWith
//  2) 승인 직후 혼자 가져가기 막기(기본 60초, 0이면 예전 그대로) · 지휘자 가져가기 보류가 바로 풀리는 경우 · 묶인 일감은 보류 대상이 아님
//  3) 앱별 합치기·최종 점검 검사 명령(저장·검증·/next 전달·빈 값이면 기본값) · 처음 값 마이그레이션
// 가짜 DB 로만 돌린다(실제 DB·네트워크 없음). 감독 프로그램 쪽은 tools/factory-supervisor/tests/checks.test.mjs. 실행: npm run test:parallel-fixes
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
  const source = fs.readFileSync(path.join(repo, relative), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

// ── 가짜 DB ──
const match = (r, where = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (k === "OR") return v.some((w) => match(r, w));
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(r[k]);
      if ("not" in v) return r[k] !== v.not;
      if ("gte" in v) return r[k] != null && r[k] >= v.gte;
    }
    return r[k] === v;
  });

function fakeDb() {
  const jobs = [];
  const logs = [];
  const settings = new Map();
  let seq = 0;
  let queryIds = null;
  const factoryJob = {
    count: async ({ where }) => jobs.filter((j) => match(j, where)).length,
    findFirst: async ({ where }) => jobs.filter((j) => match(j, where))[0] ?? null,
    findMany: async ({ where }) => jobs.filter((j) => match(j, where)),
    findUnique: async ({ where }) => jobs.find((j) => j.id === where.id) ?? null,
    create: async ({ data }) => {
      const row = { id: `n${++seq}`, status: "pending", priority: 0, approvedAt: null, createdAt: new Date(10_000 + seq), finishedAt: null, parentExplicit: false, parallelGroup: null, parallelSource: null, conductorInfo: null, aiEngine: "claude", ...data };
      jobs.push(row);
      return { id: row.id };
    },
    update: async ({ where, data }) => Object.assign(jobs.find((j) => j.id === where.id), data),
    updateMany: async ({ where, data }) => {
      const hit = jobs.filter((j) => match(j, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
  };
  const prisma = {
    factoryJob,
    factoryJobLog: { create: async ({ data }) => logs.push(data), createMany: async ({ data }) => logs.push(...data), findMany: async () => [] },
    factorySetting: {
      findUnique: async ({ where }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: async ({ where, create, update }) => (settings.set(where.key, settings.has(where.key) ? update.value : create.value), {}),
    },
    // 가져가기 UPDATE: 고른 id 로 상태를 running 으로 바꾸고 돌려준다
    $queryRaw: async (q) => {
      const ids = q.values.filter((v) => typeof v === "string" && jobs.some((j) => j.id === v));
      queryIds = ids;
      const hit = jobs.filter((j) => ids.includes(j.id) && j.status === "approved");
      for (const j of hit) j.status = "running";
      return hit.map((j) => ({ ...j, attempts: 1 }));
    },
    $executeRaw: async () => 0,
    $transaction: async (fn) => fn(prisma),
  };
  return { prisma, jobs, logs, settings, queryIds: () => queryIds };
}

function setup() {
  const db = fakeDb();
  const P = { "@/lib/prisma": { __esModule: true, default: db.prisma } };
  const parallel = loadTs("lib/factory/parallel.ts", P);
  const queue = loadTs("lib/factory/queue.ts", { ...P, "@/lib/factory/parallel": parallel });
  const jobsMod = loadTs("lib/factory/jobs.ts", {
    ...P,
    "@/lib/factory/reviewVideo": { deleteReviewVideo: async () => {} },
    "@/lib/factory/mask": { maskSecrets: (v) => v },
    "@/lib/factory/ai": { AI_LABELS: {}, isAiEngine: (v) => v === "claude" || v === "codex", readModelChoice: () => ({ ok: true, model: null }) },
    "@/lib/factory/settings": { getDefaultClaudeModel: async () => null },
    "@/lib/factory/toolBroker": { cleanToolRequests: () => null },
    "@/lib/factory/handoff": { cleanHandoff: () => null },
    "@/lib/factory/parallel": parallel,
  });
  const conductor = loadTs("lib/factory/conductor.ts", { ...P, "@/lib/factory/parallel": parallel });
  const settingsMod = loadTs("lib/factory/settings.ts", { ...P, "@/lib/factory/ai": { isAiEngine: () => true, isClaudeModel: () => true }, "@/lib/factory/toolBroker": { isToolBrokerMode: () => true, normalizeToolBroker: (v) => v, readStoredToolBroker: () => null, TOOL_BROKER_LIMITS_VERSION: 1 } });
  const appChecks = loadTs("lib/factory/appChecks.ts", P);
  const mcp = loadTs("lib/factory/mcp.ts", {
    ...P,
    "@/lib/factory/ai": { isAiEngine: (v) => v === "claude" || v === "codex" },
    "@/lib/factory/settings": { getDefaultAiEngine: async () => "claude" },
    "@/lib/factory/secretEntries": { knownSecretNames: async () => [] },
    "@/lib/factory/telegram": { notifyJobEvent: async () => {} },
    "@/lib/factory/supervisor": { runSupervisorAction: async () => ({}), SUPERVISOR_ACTIONS: [] },
    "@/lib/factory/release": {},
    "@/lib/factory/storeAssets": {},
    "@/lib/factory/storeTarget": {},
    "@/lib/factory/lab": { LAB_KIND: "lab", LAB_SLUG: "lab" },
    "@/lib/factory/queue": queue,
    "@/lib/factory/jobs": jobsMod,
    "@/lib/factory/parallel": parallel,
  });

  return { ...db, parallel, queue, jobsMod, conductor, settingsMod, appChecks, mcp };
}

let seq = 0;
const T0 = 1_700_000_000_000;
const job = (over = {}) => ({ id: `j${++seq}`, appSlug: "game-app", title: `일감 ${seq}`, kind: "revision", status: "approved", priority: 0, approvedAt: new Date(T0 + seq * 1000), createdAt: new Date(T0 + seq * 1000), finishedAt: null, aiEngine: "claude", planHash: `h${seq}`, planMarkdown: `지시 ${seq}`, parallelGroup: null, parallelSource: null, conductorInfo: null, parallelInfo: null, failStage: null, ...over });
const S = { autoGroup: true, perApp: 2, appSlots: 3 };

// ───────────── 1) 승인 전 묶기 · 묶음 승인 · 일부만 승인 ─────────────
test("승인 대기(pending) 수정 일감도 같이 돌리기로 묶을 수 있다(대기끼리·대기+승인됨), 묶음은 사람이 정한 것이 된다", async () => {
  const s = setup();
  s.jobs.push(job({ id: "p1", status: "pending", approvedAt: null }), job({ id: "p2", status: "pending", approvedAt: null }), job({ id: "a1" }));
  const r = await s.parallel.groupJobs(["p1", "p2"]);

  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /묶음 승인/);
  assert.equal(s.jobs.find((j) => j.id === "p1").parallelGroup, r.group);
  assert.equal(s.jobs.find((j) => j.id === "p2").parallelSource, "manual");
  const r2 = await s.parallel.groupJobs(["p1", "a1"]);

  assert.equal(r2.ok, true, "승인 대기 + 승인됨도 묶인다(이미 있는 묶음에 합류)");
  assert.equal(r2.group, r.group);
  assert.deepEqual(s.jobs.filter((j) => j.parallelGroup === r.group).map((j) => j.id).sort(), ["a1", "p1", "p2"]);
});

test("묶음 중 일부만 승인된 동안은 그 묶음 일감을 가져가지 않고, 묶음 승인으로 모두 승인되면 같이 가져간다", async () => {
  const s = setup();
  s.jobs.push(job({ id: "g1", parallelGroup: "g-abc1", parallelSource: "manual" }), job({ id: "g2", status: "pending", approvedAt: null, parallelGroup: "g-abc1", parallelSource: "manual" }));

  assert.deepEqual(await s.jobsMod.claimJobs("w", 4, ["claude"], { perApp: 2 }), [], "한쪽이 아직 승인 대기라 아무것도 가져가지 않음");
  assert.equal(s.jobs.find((j) => j.id === "g1").status, "approved");

  const res = await s.parallel.approveGroup("g2");

  assert.equal(res.ok, true, res.message);
  assert.match(res.message, /1개를 한 번에 승인/);
  assert.equal(s.jobs.find((j) => j.id === "g2").status, "approved");
  assert.ok(s.jobs.find((j) => j.id === "g2").approvedAt instanceof Date);
  assert.ok(s.logs.some((l) => l.jobId === "g2" && /묶음 승인/.test(l.message)), "일감 로그에 남는다");

  const got = await s.jobsMod.claimJobs("w", 4, ["claude"], { perApp: 2 });

  assert.deepEqual(got.map((j) => j.id).sort(), ["g1", "g2"], "모두 승인되면 한 번에 같이");
});

test("승인 대기가 남은 묶음만 멈춘다: 묶음이 아닌 일감과 다른 앱·다른 묶음은 그대로 간다", async () => {
  const s = setup();
  s.jobs.push(
    job({ id: "x1", appSlug: "app-x", parallelGroup: "g-xxx1" }),
    job({ id: "x2", appSlug: "app-x", status: "pending", approvedAt: null, parallelGroup: "g-xxx1" }),
    job({ id: "y1", appSlug: "app-y" }),
    job({ id: "y2", appSlug: "app-y", status: "pending", approvedAt: null }), // 묶음이 아닌 대기 일감은 묶음 규칙과 무관
    job({ id: "z1", appSlug: "app-z", parallelGroup: "g-zzz1" }),
    job({ id: "z2", appSlug: "app-z", parallelGroup: "g-zzz1" }),
    job({ id: "w1", appSlug: "app-w", parallelGroup: "g-www1" }),
    job({ id: "w2", appSlug: "app-w", status: "pending", approvedAt: null, parallelGroup: "g-other" }), // 다른 묶음의 대기는 영향 없음
  );
  const got = await s.jobsMod.claimJobs("w", 8, ["claude"], { perApp: 2 });

  assert.deepEqual(got.map((j) => j.id).sort(), ["w1", "y1", "z1", "z2"]);
});

test("withoutPartialGroups: 대기 일감이 취소되면(승인 대기가 사라지면) 묶음이 풀려 가져간다", async () => {
  const s = setup();
  s.jobs.push(job({ id: "g1", parallelGroup: "g-abc1" }), job({ id: "g2", status: "pending", approvedAt: null, parallelGroup: "g-abc1" }));
  assert.deepEqual(await s.jobsMod.claimJobs("w", 4), []);
  s.jobs.find((j) => j.id === "g2").status = "cancelled";
  assert.deepEqual((await s.jobsMod.claimJobs("w", 4)).map((j) => j.id), ["g1"], "취소하면 남은 승인 일감은 가져간다");
});

test("묶음 승인: 묶음이 아닌 일감·승인 대기가 없는 묶음·없는 일감은 거절", async () => {
  const s = setup();
  s.jobs.push(job({ id: "n1", status: "pending", approvedAt: null }), job({ id: "a1", parallelGroup: "g-abc1" }), job({ id: "a2", parallelGroup: "g-abc1" }));

  assert.equal((await s.parallel.approveGroup("n1")).ok, false);
  assert.equal((await s.parallel.approveGroup("a1")).status, 409);
  assert.equal((await s.parallel.approveGroup("nope")).status, 404);
  assert.equal(s.jobs.find((j) => j.id === "n1").status, "pending", "묶음이 아닌 일감은 승인되지 않음");
});

test("채팅 도구 enqueue_app_job parallelWith: 같은 앱의 대기 일감과 같은 묶음(manual)으로 등록, 처음 묶으면 짝도 같이", async () => {
  const s = setup();
  const plan = (n) => `# 수정 ${n}\n\n` + "내용을 충분히 길게 적어서 최소 글자 수를 넘깁니다. ".repeat(3);
  const send = async (extra) => {
    const res = await s.mcp.enqueue({ appSlug: "game-app", title: "게임", kind: "revision", planMarkdown: plan(++seq), ...extra });

    return { ...res, jobId: /id: ([A-Za-z0-9_-]+)/.exec(res.content[0].text)?.[1] };
  };

  s.jobs.push({ id: "done1", appSlug: "game-app", title: "게임", status: "done", kind: "new", stack: "nestjs", finishedAt: 100, createdAt: new Date(1), planHash: "d" });
  s.jobs.push(job({ id: "t1", status: "pending", approvedAt: null }));
  const r = await send({ parallelWith: "t1" });

  assert.ok(!r.isError, r.content[0].text);
  assert.match(r.content[0].text, /같은 묶음\(g-[a-z0-9]+\)/);
  assert.match(r.content[0].text, /묶음 승인/);
  const created = s.jobs.find((j) => j.id === r.jobId);
  const target = s.jobs.find((j) => j.id === "t1");

  assert.equal(created.status, "pending");
  assert.equal(created.parallelSource, "manual");
  assert.ok(created.parallelGroup);
  assert.equal(target.parallelGroup, created.parallelGroup, "짝도 같은 묶음");
  assert.equal(target.parallelSource, "manual");
  // 이미 묶음이 있는 일감에 합류
  const r2 = await send({ parallelWith: "t1" });

  assert.equal(s.jobs.find((j) => j.id === r2.jobId).parallelGroup, created.parallelGroup);
  // parallelWith 없이 등록하면 묶이지 않는다(예전과 같음)
  const r3 = await send({});

  assert.equal(s.jobs.find((j) => j.id === r3.jobId).parallelGroup, null);
});

test("parallelWith 거절: 다른 앱·없는 일감·시작한 일감·수정 지시가 아닌 경우·잘못된 값, 묶음 크기 제한", async () => {
  const s = setup();
  const plan = (n) => `# 수정 ${n}\n\n` + "내용을 충분히 길게 적어서 최소 글자 수를 넘깁니다. ".repeat(3);
  const send = (extra, over = {}) => s.mcp.enqueue({ appSlug: "game-app", title: "게임", kind: "revision", planMarkdown: plan(++seq), ...over, ...extra });

  s.jobs.push({ id: "done1", appSlug: "game-app", title: "게임", status: "done", kind: "new", stack: "nestjs", finishedAt: 100, createdAt: new Date(1), planHash: "d" });
  s.jobs.push(job({ id: "other", appSlug: "other-app", status: "pending", approvedAt: null }), job({ id: "run1", status: "running" }), job({ id: "newk", kind: "new", status: "pending", approvedAt: null }));
  const count = () => s.jobs.length;
  const before = count();

  for (const [extra, re] of [
    [{ parallelWith: "other" }, /같은 앱/],
    [{ parallelWith: "ghost" }, /없어요/],
    [{ parallelWith: "run1" }, /시작 전/],
    [{ parallelWith: "newk" }, /수정 지시여야/],
    [{ parallelWith: 5 }, /parallelWith 는/],
    [{ parallelWith: "bad id!" }, /parallelWith 는/],
  ]) {
    const r = await send(extra);

    assert.equal(r.isError, true, JSON.stringify(extra));
    assert.match(r.content[0].text, re);
  }
  assert.equal((await send({ parallelWith: "t1" }, { kind: "new" })).isError, true, "새 앱은 parallelWith 를 쓸 수 없다");
  assert.equal(count(), before, "거절된 요청은 일감을 만들지 않는다");
  // 묶음 크기 제한(최대 8)
  for (let i = 0; i < 8; i++) s.jobs.push(job({ id: `m${i}`, parallelGroup: "g-full1", status: "pending", approvedAt: null }));
  const full = await send({ parallelWith: "m0" });

  assert.equal(full.isError, true);
  assert.match(full.content[0].text, /최대 8개/);
});

// ───────────── 2) 승인 직후 대기 · 지휘자 보류 ─────────────
test("approvalWaitRemaining: 승인 대기 일감이 있을 때만, 마지막 승인 뒤 waitSec 동안 남은 초(올림). 0이면 예전과 같다", () => {
  const { parallel } = setup();
  const a = (ms) => new Date(T0 + ms);
  const w = (over) => parallel.approvalWaitRemaining({ approvedAts: [a(0)], pendingCount: 1, waitSec: 60, now: T0 + 10_000, ...over });

  assert.equal(w({}), 50, "10초 지났으니 50초 남음");
  assert.equal(w({ now: T0 + 59_500 }), 1, "올림");
  assert.equal(w({ now: T0 + 60_000 }), 0, "정확히 60초면 끝");
  assert.equal(w({ now: T0 + 90_000 }), 0);
  assert.equal(w({ waitSec: 0 }), 0, "0이면 기다리지 않음(예전과 같음)");
  assert.equal(w({ pendingCount: 0 }), 0, "승인 대기 일감이 없으면 기다리지 않음");
  assert.equal(w({ approvedAts: [] }), 0);
  assert.equal(w({ approvedAts: [a(0), a(30_000)] }), 80, "가장 최근 승인 기준(연달아 승인하면 늘어남)");
  assert.equal(w({ approvedAts: [null] }), 0);
});

test("appsWaitingForApproval: 같은 앱에 승인 대기 수정 일감이 또 있을 때만 그 앱을 잠깐 막는다(카드에 남은 초)", async () => {
  const s = setup();
  const now = T0 + 20_000;
  s.jobs.push(job({ id: "a1", approvedAt: new Date(T0) }), job({ id: "a2", status: "pending", approvedAt: null }), job({ id: "b1", appSlug: "app-b", approvedAt: new Date(T0) }));
  const w = await s.conductor.appsWaitingForApproval(S, true, 60, now);

  assert.deepEqual([...w], [["game-app", 40]], "pending 이 있는 앱만, app-b 는 기다리지 않음");
  assert.equal((await s.conductor.appsWaitingForApproval(S, true, 60, T0 + 61_000)).size, 0, "시간이 지나면 풀림");
});

test("승인 직후 대기를 하지 않는 경우: 0초 · 자동 묶기 꺼짐 · 같은 앱 동시 수 1 · 지휘자를 모르는 감독 프로그램 · 이미 묶인 일감", async () => {
  const s = setup();
  const now = T0 + 5_000;
  s.jobs.push(job({ id: "a1", approvedAt: new Date(T0) }), job({ id: "a2", status: "pending", approvedAt: null }));

  assert.equal((await s.conductor.appsWaitingForApproval(S, true, 60, now)).size, 1);
  assert.equal((await s.conductor.appsWaitingForApproval(S, true, 0, now)).size, 0, "0이면 지금과 같다");
  assert.equal((await s.conductor.appsWaitingForApproval({ ...S, autoGroup: false }, true, 60, now)).size, 0, "자동 묶기 꺼짐");
  assert.equal((await s.conductor.appsWaitingForApproval({ ...S, perApp: 1 }, true, 60, now)).size, 0, "parallelPerApp=1");
  assert.equal((await s.conductor.appsWaitingForApproval({ ...S, appSlots: 1 }, true, 60, now)).size, 0, "공장 전체 동시 수 1");
  assert.equal((await s.conductor.appsWaitingForApproval(S, false, 60, now)).size, 0, "지휘자를 모르는 예전 감독 프로그램");
  // 이미 묶인 일감은 대상이 아니다(묶음은 따로 모두 승인될 때까지 기다림)
  s.jobs.find((j) => j.id === "a1").parallelGroup = "g-abc1";
  assert.equal((await s.conductor.appsWaitingForApproval(S, true, 60, now)).size, 0);
  // 새 앱·출시 일감의 승인 대기는 수정 일감 승인을 막지 않는다
  s.jobs.find((j) => j.id === "a1").parallelGroup = null;
  s.jobs.find((j) => j.id === "a2").kind = "release";
  assert.equal((await s.conductor.appsWaitingForApproval(S, true, 60, now)).size, 0);
});

test("승인 직후 대기 + claimJobs: 기다리는 동안 혼자 가져가지 않고, 연달아 승인하면 같이 가져가며, 0초면 예전처럼 바로 간다", async () => {
  const s = setup();
  const now = Date.now();
  s.jobs.push(job({ id: "d1", approvedAt: new Date(now - 1000) }), job({ id: "c1", status: "pending", approvedAt: null }));
  const hold = async (sec) => new Set((await s.conductor.appsWaitingForApproval(S, true, sec, now)).keys());

  assert.deepEqual(await s.jobsMod.claimJobs("w", 4, ["claude"], { holdApps: await hold(60) }), [], "D 를 승인했지만 C 가 아직 승인 대기라 기다림");
  assert.equal(s.jobs.find((j) => j.id === "d1").status, "approved");
  assert.deepEqual((await s.jobsMod.claimJobs("w", 4, ["claude"], { holdApps: await hold(0) })).map((j) => j.id), ["d1"], "0이면 지금과 같다(승인 즉시 시작)");
});

test("승인 직후 대기가 끝나면 순서대로: 연달아 승인된 두 일감은 지휘자 판단 대상이 되고, 시간이 지나면 혼자라도 시작한다", async () => {
  const s = setup();
  const now = Date.now();
  s.jobs.push(job({ id: "d1", approvedAt: new Date(now - 70_000) }), job({ id: "c1", status: "pending", approvedAt: null }));

  assert.equal((await s.conductor.appsWaitingForApproval(S, true, 60, now)).size, 0, "70초 전에 승인했으니 기다림 끝");
  // 연달아 C 도 승인(pending → approved) 하면 승인 대기가 없어 기다림 없이 지휘자 판단(보류)으로 넘어간다
  s.jobs.find((j) => j.id === "c1").status = "approved";
  s.jobs.find((j) => j.id === "c1").approvedAt = new Date(now - 1000);
  s.jobs.find((j) => j.id === "d1").approvedAt = new Date(now - 2000);
  assert.equal((await s.conductor.appsWaitingForApproval(S, true, 60, now)).size, 0);
  assert.deepEqual([...(await s.conductor.appsToHold(S, true, now))], ["game-app"], "둘 다 승인되면 지휘자 판단을 기다림");
});

test("지휘자 보류 해제: 판단 대상이 2개 미만이 되는 순간 바로 풀리고, 이미 묶인 일감에는 보류가 걸리지 않는다", async () => {
  const s = setup();
  const now = Date.now();
  s.jobs.push(job({ id: "k1", approvedAt: new Date(now - 1000) }), job({ id: "k2", approvedAt: new Date(now - 500) }));

  assert.deepEqual([...(await s.conductor.appsToHold(S, true, now))], ["game-app"], "대상 2개면 보류");
  s.jobs.find((j) => j.id === "k2").status = "running";
  assert.deepEqual([...(await s.conductor.appsToHold(S, true, now))], [], "하나가 시작/취소되어 1개만 남으면 바로 풀림");
  s.jobs.find((j) => j.id === "k2").status = "approved";
  assert.equal((await s.conductor.appsToHold(S, true, now)).size, 1);
  s.jobs.find((j) => j.id === "k2").status = "cancelled";
  assert.equal((await s.conductor.appsToHold(S, true, now)).size, 0, "취소해도 바로 풀림");
  // 이미 묶인(지휘자·사람) 일감은 판단 대상이 아니라 보류가 걸리지 않는다(A·B 가 09:02 에 묶였는데 09:06 에 시작한 건 보류가 아니라 배포 드레인 때문)
  s.jobs.find((j) => j.id === "k2").status = "approved";
  for (const j of s.jobs) Object.assign(j, { parallelGroup: "g-abc1", parallelSource: "conductor" });
  assert.equal((await s.conductor.appsToHold(S, true, now)).size, 0);
  assert.deepEqual((await s.jobsMod.claimJobs("w", 4, ["claude"], { holdApps: await s.conductor.appsToHold(S, true, now) })).map((j) => j.id).sort(), ["k1", "k2"], "묶인 두 일감은 보류 없이 바로 시작");
});

test("승인 직후 대기 시간 설정: 기본 60초, 0~300 정수만, 이상한 저장값은 기본값", async () => {
  const s = setup();

  assert.deepEqual(await s.settingsMod.getApprovalWaitSec(), { value: 60, isDefault: true });
  await s.settingsMod.setApprovalWaitSec(0);
  assert.deepEqual(await s.settingsMod.getApprovalWaitSec(), { value: 0, isDefault: false });
  await s.settingsMod.setApprovalWaitSec(300);
  assert.equal((await s.settingsMod.getApprovalWaitSec()).value, 300);
  for (const ok of [0, 1, 300, "45", " 7 "]) assert.notEqual(s.settingsMod.cleanApprovalWait(ok), null, String(ok));
  for (const bad of [-1, 301, 1.5, "", "abc", "1e2", null, undefined, true, NaN]) assert.equal(s.settingsMod.cleanApprovalWait(bad), null, String(bad));
  s.settings.set("approvalWaitSec", "999");
  assert.deepEqual(await s.settingsMod.getApprovalWaitSec(), { value: 60, isDefault: true }, "이상한 저장값은 기본값");
});

test("대기열 표시: 승인 직후 '다른 승인 기다림 n초'와 '묶음 승인 기다림', [묶음 승인] 버튼은 묶음마다 한 번", () => {
  const s = setup();
  const now = T0 + 20_000;
  const row = (id, over) => job({ id, ...over });
  const items = s.queue.numberQueue([row("a1", { approvedAt: new Date(T0) }), row("p1", { status: "pending", approvedAt: null })], { waitSec: 60, now });

  assert.equal(items.find((i) => i.id === "a1").approvalWait, 40);
  assert.equal(items.find((i) => i.id === "p1").approvalWait, 0, "승인 대기 카드에는 표시하지 않음");
  assert.equal(s.queue.numberQueue([row("a1", { approvedAt: new Date(T0) }), row("p1", { status: "pending", approvedAt: null })], { waitSec: 0, now })[0].approvalWait, 0, "0이면 표시 없음");
  assert.equal(s.queue.numberQueue([row("a1", { approvedAt: new Date(T0) })], { waitSec: 60, now })[0].approvalWait, 0, "혼자면 기다리지 않음");

  const grouped = s.queue.numberQueue([row("g1", { parallelGroup: "g-abc1" }), row("g2", { status: "pending", approvedAt: null, parallelGroup: "g-abc1" }), row("g3", { status: "pending", approvedAt: null, parallelGroup: "g-abc1" })]);

  assert.equal(grouped.find((i) => i.id === "g1").groupPendingLeft, 2);
  assert.equal(grouped.find((i) => i.id === "g1").approvalWait, 0, "묶인 일감은 묶음 규칙으로만 기다림");

  const mod = loadTs("components/admin/factory/AppQueue.tsx", { react: require("react"), "react/jsx-runtime": require("react/jsx-runtime") });

  assert.ok(mod.parallelBadges({ ...grouped[0], parallel: null, mergeFailed: false }).includes("묶음 승인 기다림 (2개 남음)"));
  assert.ok(mod.parallelBadges({ ...items.find((i) => i.id === "a1"), parallel: null, mergeFailed: false }).includes("다른 승인 기다림 40초"));
  assert.deepEqual(mod.parallelBadges({ status: "approved", parallelGroup: null, parallel: null, mergeFailed: false }), [], "표시할 게 없으면 예전과 같다");
  const pend = grouped.filter((i) => i.status === "pending");

  assert.equal(pend.filter((q) => mod.showGroupApprove(grouped, q)).length, 1, "버튼은 묶음마다 한 번");
  assert.equal(mod.showGroupApprove(grouped, grouped.find((i) => i.id === "g1")), false, "이미 승인된 일감에는 없음");
  assert.equal(mod.showGroupApprove(items, items.find((i) => i.id === "p1")), false, "묶음이 아니면 없음");
});

// ───────────── 3) 앱별 검사 명령 ─────────────
test("앱별 검사 명령 검증: 한 줄에 하나, 최대 8줄·200자, 셸 글자·따옴표 짝 오류는 거절, 비우면 그 앱 설정 삭제", () => {
  const { appChecks } = setup();
  const ok = appChecks.applyAppChecksPatch({}, { appSlug: "game-toolkit", commands: "python -m unittest discover -s tests -q\n\n  node  check.mjs  \npython -m unittest discover -s tests -q" });

  assert.equal(ok.ok, true);
  assert.deepEqual(ok.checks["game-toolkit"], ["python -m unittest discover -s tests -q", "node check.mjs"], "빈 줄·중복 제거, 공백 정리");
  assert.deepEqual(appChecks.applyAppChecksPatch({}, { appSlug: "game-toolkit", commands: ["a b", "c d"] }).checks["game-toolkit"], ["a b", "c d"]);

  for (const bad of ["a && b", "a | b", "a; b", "a > f", "echo `x`", "echo $X", "echo %X%", 'node "a', "x".repeat(201), Array.from({ length: 9 }, (_, i) => `n${i}`).join("\n")]) {
    assert.equal(appChecks.applyAppChecksPatch({}, { appSlug: "game-toolkit", commands: bad }).ok, false, bad.slice(0, 30));
  }
  assert.equal(appChecks.applyAppChecksPatch({}, { appSlug: "x", commands: "a" }).ok, false, "앱 이름 형식");
  assert.equal(appChecks.applyAppChecksPatch({}, null).ok, false);
  const cleared = appChecks.applyAppChecksPatch({ "game-toolkit": ["a"], other: ["b"] }, { appSlug: "game-toolkit", commands: "" });

  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.checks, { other: ["b"] }, "비우면 그 앱만 삭제(기본 검사만)");
});

test("앱별 검사 명령 저장·읽기: 이상한 저장값은 버리고, 없으면 빈 표(= stack 기본 검사만)", async () => {
  const s = setup();

  assert.deepEqual(await s.appChecks.getAppChecks(), {});
  await s.appChecks.saveAppChecks({ "game-toolkit": ["python -m unittest discover -s tests -q"] });
  assert.deepEqual(await s.appChecks.getAppChecks(), { "game-toolkit": ["python -m unittest discover -s tests -q"] });
  s.settings.set("appCheckCommands", JSON.stringify({ "game-toolkit": ["ok one", "bad && two"], "BAD SLUG": ["x"], "empty-app": [], arr: "no" }));
  assert.deepEqual(await s.appChecks.getAppChecks(), {}, "잘못된 줄이 하나라도 있는 앱·잘못된 이름은 통째로 버림");
  s.settings.set("appCheckCommands", "not json");
  assert.deepEqual(await s.appChecks.getAppChecks(), {});
});

test("연결: /next 는 설정이 있는 앱의 일감에만 checkCommands 를 붙이고, control API·통제실·마이그레이션·package.json 에 연결", () => {
  const next = read("app/api/factory/next/route.ts");

  assert.match(next, /getAppChecks\(\)/);
  assert.match(next, /checkCommands: appChecks\[j\.appSlug\]/);
  assert.match(next, /appsWaitingForApproval\(cs, capable, approvalWaitSec\)/);
  assert.match(next, /getApprovalWaitSec\(\)/);
  const control = read("app/api/admin/factory/control/route.ts");

  for (const k of ["approvalWaitSec", "appChecks"]) assert.match(control, new RegExp(`Object\\.hasOwn\\(body, "${k}"\\)`));
  const consoleSrc = read("components/admin/factory/FactoryConsole.tsx");

  assert.match(consoleSrc, /<ApprovalWaitSettings \/>/);
  assert.match(consoleSrc, /<AppChecksSettings \/>/);
  assert.match(read("app/api/admin/factory/queue/route.ts"), /approve-group/);
  assert.match(read("components/admin/factory/AppQueue.tsx"), /data-queue-approve-group/);
  assert.match(read("package.json"), /test:parallel-fixes/);
  // 마이그레이션: game-toolkit 처음 값만 넣고(이미 있으면 그대로), 지우는 문장 없음
  const sql = read("prisma/migrations/20261111090000_app_check_commands/migration.sql");

  assert.match(sql, /INSERT INTO "factory_settings"/);
  assert.match(sql, /ON CONFLICT \("key"\) DO NOTHING/);
  assert.match(sql, /python -m unittest discover -s tests -q/);
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE/i);
  // 채팅 도구 설명
  const mcp = read("lib/factory/mcp.ts");

  assert.match(mcp, /parallelWith: \{/);
  assert.equal((mcp.match(/parallelWith/g) ?? []).length >= 6, true);
});

test("처음 값 마이그레이션의 내용이 설정 검증을 통과한다(game-toolkit 만)", () => {
  const { appChecks } = setup();
  const sql = read("prisma/migrations/20261111090000_app_check_commands/migration.sql");
  const json = /VALUES \('appCheckCommands', '(\{.*\})'/.exec(sql)?.[1];

  assert.ok(json);
  assert.deepEqual(appChecks.readAppChecks(json), { "game-toolkit": ["python -m unittest discover -s tests -q"] });
});
