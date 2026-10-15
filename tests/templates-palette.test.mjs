// 5-3 시험: 일감 템플릿 · 자동 승인 규칙 · 명령 팔레트
//  - 템플릿 변수 채우기(기본값·빠진 칸·되풀이·값 속 {{}} 안 풀기), 기본 템플릿 5개와 일감 작성 규칙, 내 템플릿 검사
//  - 자동 승인 조건(출시·새 앱은 늘 제외, 실험·한도 안 도구·문서만·지정 템플릿, 기본 모두 꺼짐), 문서만 판정
//  - 템플릿 등록(가짜 등록 함수)·자동 승인 적용(가짜 DB)·외부(커넥터)가 템플릿 출처를 흉내 내지 못함
//  - 팔레트 검색·바로 실행 말 풀이("한 컷 싹이 단독 짤 2장"·감독 상태·스튜디오 열기)·위험 동작 확인 창
// 실제 DB·네트워크는 쓰지 않는다. 실행: node tests/templates-palette.test.mjs
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
  const output = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const T = loadTs("lib/factory/jobTemplates.ts");
const A = loadTs("lib/factory/autoApprove.ts");
const P = loadTs("lib/factory/palette.ts");

// ───────── 템플릿 변수 ─────────
test("빈칸: 값 채우기·기본값·빠진 칸·되풀이", () => {
  assert.deepEqual(T.templateVars("{{a}} 와 {{ b = 기본 }} 와 {{a}}").map((v) => [v.name, v.fallback]), [["a", null], ["b", "기본"]]);
  assert.deepEqual(T.fillTemplate("{{a}}-{{b=x}}-{{a}}", { a: "1" }), { ok: true, text: "1-x-1" });
  assert.deepEqual(T.fillTemplate("{{a}}-{{b=x}}", { b: "  " }), { ok: false, missing: ["a"] }); // 빈 값은 기본값, a 는 비어서 실패
  assert.deepEqual(T.fillTemplate("{{a}} {{c}}", {}), { ok: false, missing: ["a", "c"] });
  assert.equal(T.fillTemplate("{{a}}", { a: 5 }).ok, false); // 글자가 아닌 값은 비어 있는 것
});

test("빈칸: 채운 값 안의 {{…}} 는 다시 풀지 않고 제어문자는 지운다", () => {
  const r = T.fillTemplate("값: {{a}} / {{b=기본}}", { a: "{{b}}\u0000x", b: "BB" });
  assert.equal(r.ok, true);
  assert.equal(r.text, "값: {{b}}x / BB");
});

test("기본 템플릿 5개: 이름·종류·작성 규칙·빈칸, 출시는 없다", () => {
  const names = T.BUILTIN_TEMPLATES.map((t) => t.name);
  for (const n of ["웹 배포", "스토어 문구 수정", "의존성 업데이트", "버그 재현 후 수정", "측정만 (실험 일감)"]) assert.ok(names.includes(n), n);
  assert.equal(T.BUILTIN_TEMPLATES.find((t) => t.name.startsWith("측정만")).kind, "lab");
  for (const t of T.BUILTIN_TEMPLATES) {
    assert.ok(["revision", "lab"].includes(t.kind));
    assert.ok(t.body.includes("## 일감 작성 규칙") && t.body.includes("실험 일감으로 보낸다") && t.body.includes("e2e") && t.body.includes("마지막에 한 번만"), t.name);
    assert.ok(t.id.startsWith("builtin-") && t.builtin === true);
  }
  assert.deepEqual(T.templateVars(T.BUILTIN_TEMPLATES.find((t) => t.name === "버그 재현 후 수정").body).map((v) => v.name), ["증상", "재현 방법"]);
  // 기획서 최소 길이(50자)를 머리말이 채운다
  assert.ok(T.instructionFromTemplate({ name: "x", kind: "revision" }, "짧음").length > 50);
});

test("내 템플릿 검사: 이름·종류·키·도구 카드", () => {
  const ok = T.cleanTemplateInput({ name: " 내 것 ", kind: "revision", body: "{{뭐}} 를 고쳐 주세요", priority: 3, requiredSecrets: ["API_KEY", "API_KEY"], approvalMode: "plan" });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.name, "내 것");
  assert.deepEqual(ok.value.requiredSecrets, ["API_KEY"]);
  assert.equal(T.cleanTemplateInput({ name: "웹 배포", kind: "revision", body: "내용입니다 x" }).ok, false); // 기본과 같은 이름
  assert.equal(T.cleanTemplateInput({ name: "a", kind: "release", body: "내용입니다 x" }).ok, false); // 출시는 템플릿으로 못 보냄
  assert.equal(T.cleanTemplateInput({ name: "a", kind: "new", body: "내용입니다 x" }).ok, false);
  assert.equal(T.cleanTemplateInput({ name: "a", kind: "tool", body: "싹이" }).ok, false); // 카드 이름 필요
  assert.equal(T.cleanTemplateInput({ name: "a", kind: "tool", body: "싹이 그림", cardName: "단독 짤", toolCount: 2 }).ok, true);
  assert.equal(T.cleanTemplateInput({ name: "a", kind: "revision", body: "내용입니다 x", requiredSecrets: ["bad key"] }).ok, false);
  assert.equal(T.cleanTemplateInput({ name: "a", kind: "revision", body: "내용입니다 x", priority: 500 }).ok, false);
});

// ───────── 자동 승인 조건 ─────────
const on = (extra = {}) => A.cleanAutoRules({ lab: true, tool: true, docs: true, template: true, templateIds: ["builtin-web-deploy", "tpl_1"], ...extra });

test("자동 승인: 기본은 모두 꺼짐이고 아무것도 승인하지 않는다", () => {
  assert.deepEqual(A.DEFAULT_AUTO_RULES, { lab: false, tool: false, docs: false, template: false, templateIds: [] });
  assert.deepEqual(A.cleanAutoRules(undefined), A.DEFAULT_AUTO_RULES);
  assert.deepEqual(A.cleanAutoRules("깨진 값"), A.DEFAULT_AUTO_RULES);
  assert.equal(A.anyRuleOn(A.DEFAULT_AUTO_RULES), false);
  assert.equal(A.decideAutoApprove({ kind: "lab", planMarkdown: "x" }, A.DEFAULT_AUTO_RULES), null);
  assert.equal(A.decideAutoApprove({ kind: "revision", templateId: "tpl_1", planMarkdown: "x" }, { ...A.DEFAULT_AUTO_RULES, templateIds: ["tpl_1"] }), null); // template 규칙이 꺼져 있으면 목록만 있어도 안 됨
});

test("자동 승인: 출시 일감과 새 앱은 규칙이 다 켜져 있어도 늘 제외", () => {
  const r = on();
  assert.equal(A.decideAutoApprove({ kind: "release", releaseKind: "first", templateId: "tpl_1", planMarkdown: "문서만 고치세요" }, r), null);
  assert.equal(A.decideAutoApprove({ kind: "release", planMarkdown: "x", templateId: "builtin-web-deploy" }, r), null);
  assert.equal(A.decideAutoApprove({ kind: "revision", releaseKind: "store", templateId: "tpl_1", planMarkdown: "x" }, r), null);
  assert.equal(A.decideAutoApprove({ kind: "new", templateId: "tpl_1", planMarkdown: "x" }, r), null);
});

test("자동 승인: 실험·한도 안 도구·문서만·지정 템플릿", () => {
  const r = on();
  assert.equal(A.decideAutoApprove({ kind: "lab", planMarkdown: "측정" }, r).rule, "lab");
  assert.equal(A.decideAutoApprove({ kind: "lab", planMarkdown: "측정" }, on({ lab: false })), null);
  assert.equal(A.decideAutoApprove({ kind: "tool", toolWithinLimit: true, planMarkdown: "x" }, r).rule, "tool");
  assert.equal(A.decideAutoApprove({ kind: "tool", toolWithinLimit: false, planMarkdown: "x" }, r), null); // 한도 밖
  assert.equal(A.decideAutoApprove({ kind: "tool", planMarkdown: "x" }, r), null); // 한도 여부를 모르면 승인하지 않는다
  assert.equal(A.decideAutoApprove({ kind: "revision", planMarkdown: "README 문서만 고쳐 주세요" }, r).rule, "docs");
  assert.equal(A.decideAutoApprove({ kind: "revision", planMarkdown: "README 문서만 고쳐 주세요" }, on({ docs: false })), null);
  assert.equal(A.decideAutoApprove({ kind: "revision", templateId: "tpl_1", planMarkdown: "코드 수정" }, r).rule, "template");
  assert.equal(A.decideAutoApprove({ kind: "revision", templateId: "tpl_9", planMarkdown: "코드 수정" }, r), null); // 지정 안 한 템플릿
  assert.equal(A.decideAutoApprove({ kind: "revision", planMarkdown: "코드 수정" }, r), null); // 템플릿 출처가 없음
});

test("문서만 판정: 분명히 밝히고 코드·마이그레이션·의존성 말이 없을 때만", () => {
  assert.equal(A.looksDocsOnly("docs 폴더의 오타만 고치세요. 문서만 바꿔요."), true);
  assert.equal(A.looksDocsOnly("문서만 고치세요 (docs/guide.md 의 링크)"), true);
  assert.equal(A.looksDocsOnly("문서만 고치고 lib/a.ts 도 고쳐 주세요"), false);
  assert.equal(A.looksDocsOnly("문서만 바꾸고 마이그레이션도 추가"), false);
  assert.equal(A.looksDocsOnly("문서를 고쳐 주세요"), false); // '만' 이 없으면 확신하지 못한다
  assert.equal(A.looksDocsOnly("버튼 색을 바꿔 주세요"), false);
  // 템플릿 작성 규칙 블록(코드 이야기)은 판정에서 뺀다
  assert.equal(A.looksDocsOnly("문서만 고치세요\n\n## 일감 작성 규칙\n- 코드 파일 main.ts 는 건드리지 않는다"), true);
});

test("자동 승인 알림 글·규칙 이름", () => {
  assert.equal(A.autoApproveNotice("제목", "my-app", "실험 일감"), "⚡ 자동 승인: 제목 (my-app) — 규칙: 실험 일감");
  assert.equal(A.autoRuleLabel("docs"), "문서만 바꾸는 수정");
  assert.equal(A.autoRuleLabel("모름"), null);
});

// ───────── 가짜 DB 로 연결 시험 ─────────
function fakePrisma(seed = {}) {
  const db = { settings: new Map(Object.entries(seed.settings ?? {})), jobs: new Map((seed.jobs ?? []).map((j) => [j.id, { ...j }])), logs: [], templates: new Map() };
  const prisma = {
    factorySetting: {
      findUnique: async ({ where }) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key) } : null),
      upsert: async ({ where, update }) => {
        db.settings.set(where.key, update.value);
      },
    },
    factoryJob: {
      findUnique: async ({ where }) => db.jobs.get(where.id) ?? null,
      updateMany: async ({ where, data }) => {
        const j = db.jobs.get(where.id);

        if (!j) return { count: 0 };
        Object.assign(j, data);

        return { count: 1 };
      },
      findFirst: async ({ where }) => [...db.jobs.values()].find((j) => j.appSlug === where.appSlug && j.status === where.status) ?? null,
      findMany: async () => [],
    },
    factoryJobLog: {
      create: async ({ data }) => {
        db.logs.push(data);
      },
    },
    factoryJobTemplate: {
      findFirst: async ({ where }) => [...db.templates.values()].find((t) => (where.OR ? where.OR.some((o) => (o.id && t.id === o.id) || (o.name && t.name === o.name)) : (!where.name || t.name === where.name) && (!where.id?.not || t.id !== where.id.not))) ?? null,
      findMany: async () => [...db.templates.values()],
      create: async ({ data }) => {
        db.templates.set(data.id, data);

        return data;
      },
      count: async () => db.templates.size,
      deleteMany: async ({ where }) => ({ count: db.templates.delete(where.id) ? 1 : 0 }),
    },
  };

  return { db, prisma };
}

function loadAutoDb(seed, tpls = {}) {
  const { db, prisma } = fakePrisma(seed);
  const approvals = [];
  const notices = [];
  const mod = loadTs("lib/factory/autoApproveDb.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/autoApprove": A,
    "@/lib/factory/telegram": {
      notifyText: async (t, p) => {
        notices.push([t, p]);
      },
    },
    "@/lib/factory/jobs": {
      adminAction: async (id, body) => {
        approvals.push([id, body]);
        db.jobs.get(id).status = "approved";

        return { ok: true, status: 200, message: "승인했어요." };
      },
    },
    "@/lib/factory/jobTemplatesDb": { getTemplate: async (id) => tpls[id] ?? null },
  });

  return { db, approvals, notices, ...mod };
}

const pendingJob = (over = {}) => ({ id: "j1", appSlug: "my-app", title: "작업", kind: "revision", releaseKind: null, status: "pending", templateId: null, planMarkdown: "코드 수정", ...over });

test("maybeAutoApprove: 규칙이 꺼져 있으면 아무것도 안 한다(기본)", async () => {
  const m = loadAutoDb({ jobs: [pendingJob({ kind: "lab" })] });
  assert.equal(await m.maybeAutoApprove("j1"), null);
  assert.equal(m.approvals.length, 0);
  assert.equal(m.db.jobs.get("j1").status, "pending");
});

test("maybeAutoApprove: 실험 규칙이 켜지면 평소 승인 길로 승인하고 표시·로그·알림을 남긴다", async () => {
  const m = loadAutoDb({ settings: { autoApproveRules: JSON.stringify({ lab: true }) }, jobs: [pendingJob({ kind: "lab", appSlug: "lab" })] });
  assert.equal(await m.maybeAutoApprove("j1"), "lab");
  assert.deepEqual(m.approvals, [["j1", { action: "approve" }]]);
  assert.equal(m.db.jobs.get("j1").autoApprovedBy, "lab");
  assert.ok(m.db.logs[0].message.includes("자동 승인"));
  assert.equal(m.notices.length, 1);
  assert.ok(m.notices[0][0].startsWith("⚡ 자동 승인: 작업"));
});

test("maybeAutoApprove: 출시 일감은 규칙이 모두 켜져도 승인하지 않는다", async () => {
  const rules = JSON.stringify({ lab: true, tool: true, docs: true, template: true, templateIds: ["tpl_1"] });
  const m = loadAutoDb({ settings: { autoApproveRules: rules }, jobs: [pendingJob({ kind: "release", releaseKind: "first", templateId: "tpl_1", planMarkdown: "문서만" })] });
  assert.equal(await m.maybeAutoApprove("j1"), null);
  assert.equal(m.approvals.length, 0);
  assert.equal(m.db.jobs.get("j1").status, "pending");
});

test("maybeAutoApprove: 지정한 템플릿의 승인 방식(계획 먼저/바로 시작)을 승인에 넘긴다", async () => {
  const rules = { settings: { autoApproveRules: JSON.stringify({ template: true, templateIds: ["tpl_1"] }) } };
  const a = loadAutoDb({ ...rules, jobs: [pendingJob({ templateId: "tpl_1" })] }, { tpl_1: { approvalMode: "plan" } });
  assert.equal(await a.maybeAutoApprove("j1"), "template");
  assert.deepEqual(a.approvals[0][1], { action: "approve", planFirst: true });
  const b = loadAutoDb({ ...rules, jobs: [pendingJob({ templateId: "tpl_1" })] }, { tpl_1: { approvalMode: "now" } });
  await b.maybeAutoApprove("j1");
  assert.deepEqual(b.approvals[0][1], { action: "approve", planFirst: false });
});

test("maybeAutoApprove: 이미 승인된(pending 아닌) 일감·없는 일감은 건드리지 않는다", async () => {
  const m = loadAutoDb({ settings: { autoApproveRules: JSON.stringify({ lab: true }) }, jobs: [pendingJob({ kind: "lab", status: "approved" })] });
  assert.equal(await m.maybeAutoApprove("j1"), null);
  assert.equal(await m.maybeAutoApprove("없음"), null);
  assert.equal(m.approvals.length, 0);
});

test("템플릿 등록: 수정·실험·도구 모두 같은 등록 함수로 가고 templateId 가 붙는다", async () => {
  const { db, prisma } = fakePrisma({ jobs: [{ id: "d1", appSlug: "my-app", title: "내 앱", kind: "new", status: "done" }] });
  const calls = [];
  const approvals = [];
  const mod = loadTs("lib/factory/jobTemplatesDb.ts", {
    "node:crypto": require("node:crypto"),
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/factory/jobTemplates": T,
    "@/lib/factory/mcp": {
      enqueueWithId: async (a, internal) => {
        calls.push(["revision", a, internal]);

        return { content: [{ type: "text", text: "수정 지시를 등록했어요" }], jobId: "r1" };
      },
      enqueueLabJob: async (a, internal) => {
        calls.push(["lab", a, internal]);

        return { content: [{ type: "text", text: "실험을 등록했어요" }], jobId: "l1" };
      },
    },
    "@/lib/factory/toolJobsDb": {
      enqueueToolJob: async (a, who) => {
        calls.push(["tool", a, who]);
        db.jobs.set("t1", { id: "t1", status: "pending" });

        return { ok: true, id: "t1", autoApproved: false, message: "도구 일감을 등록했어요" };
      },
    },
    "@/lib/factory/jobs": {
      adminAction: async (id, body) => {
        approvals.push([id, body]);

        return { ok: true, status: 200, message: "ok" };
      },
    },
  });

  db.jobs.set("r1", { id: "r1", status: "pending" });
  db.jobs.set("l1", { id: "l1", status: "pending" });

  // 수정: 빈칸이 비면 등록하기 전에 거절
  const bad = await mod.enqueueFromTemplate({ template: "버그 재현 후 수정", values: {}, appSlug: "my-app", source: "통제실" });
  assert.equal(bad.ok, false);
  assert.ok(bad.message.includes("증상"));
  assert.equal(calls.length, 0);
  // 앱이 없으면 거절
  assert.equal((await mod.enqueueFromTemplate({ template: "웹 배포", source: "통제실" })).ok, false);

  const rev = await mod.enqueueFromTemplate({ template: "버그 재현 후 수정", values: { 증상: "저장이 안 돼요" }, appSlug: "my-app", source: "통제실", approve: true });
  assert.equal(rev.ok, true);
  const [, rargs] = calls[0];
  assert.equal(rargs.kind, "revision");
  assert.equal(rargs.title, "내 앱");
  assert.equal(calls[0][2].templateId, "builtin-bug-fix");
  assert.ok(rargs.planMarkdown.includes("저장이 안 돼요") && rargs.planMarkdown.includes("아직 모름") && rargs.planMarkdown.includes("일감 작성 규칙"));
  assert.deepEqual(approvals[0], ["r1", { action: "approve" }]); // 설정 기본값 방식 → 선택을 넘기지 않는다
  assert.ok(rev.message.includes("바로 승인"));

  // 실험: 앱 이름 없이, 제목에 첫 값이 들어간다
  const lab = await mod.enqueueFromTemplate({ template: "builtin-measure-only", values: { "측정 대상": "시작 시간" }, source: "채팅" });
  assert.equal(lab.ok, true);
  assert.equal(calls[1][0], "lab");
  assert.ok(calls[1][1].title.includes("시작 시간"));
  assert.equal(calls[1][2].templateId, "builtin-measure-only");
  assert.equal(approvals.length, 1); // approve 를 안 줬으니 승인 안 함

  // 도구: 카드·장 수·대상
  const saved = await mod.saveTemplate({ name: "싹이 짤", kind: "tool", body: "{{대상=싹이}}", cardName: "단독 짤", toolCount: 2 });
  assert.equal(saved.ok, true);
  const tool = await mod.enqueueFromTemplate({ template: "싹이 짤", appSlug: "my-app", source: "통제실" });
  assert.equal(tool.ok, true);
  assert.deepEqual(calls[2][1], { appSlug: "my-app", card: "단독 짤", subject: "싹이", count: 2 });
  assert.equal(calls[2][2].templateId, saved.template.id);
  assert.equal((await mod.enqueueFromTemplate({ template: "없는 템플릿", source: "통제실" })).status, 404);
  // 기본 템플릿은 지우거나 덮어쓸 수 없다
  assert.equal((await mod.deleteTemplate("builtin-web-deploy")).ok, false);
  assert.equal((await mod.saveTemplate({ name: "x", kind: "lab", body: "내용입니다 x" }, "builtin-web-deploy")).ok, false);
});

// ───────── 연결(원본 코드 확인) ─────────
test("연결: 외부 커넥터는 템플릿 출처를 정하지 못하고, 새 도구와 자동 승인 호출이 있다", () => {
  const mcp = read("lib/factory/mcp.ts");
  // 외부 도구 인자(args)에는 templateId 를 읽는 곳이 없다: 서버 안 호출만 internal 로 넘긴다
  assert.ok(!/args.templateId/.test(mcp));
  assert.ok(mcp.includes("internal: { templateId?: string | null } = {}"));
  assert.ok(/case "enqueue_app_job":[\s\S]{0,500}return enqueue\(args\);/.test(mcp) && /case "enqueue_lab_job":\s*return enqueueLabJob\(args\);/.test(mcp));
  assert.ok(mcp.includes('name: "list_templates"') && mcp.includes('name: "enqueue_from_template"'));
  assert.ok(mcp.includes('case "list_templates"') && mcp.includes('case "enqueue_from_template"'));
  assert.equal((mcp.match(/maybeAutoApprove\(result\.id\)/g) ?? []).length, 2); // 수정·실험 등록 뒤
  assert.ok(mcp.includes("측정·조사는 실험 일감으로") && mcp.includes("e2e 시험은 마지막에 한 번만"));
  // 출시 도구 본문은 템플릿 출처를 받지 않는다
  const start = mcp.indexOf("export async function enqueueReleaseJob");
  const end = mcp.indexOf("\nasync function supervisorControl", start);
  assert.ok(start > 0 && end > start && !mcp.slice(start, end).includes("templateId"));
  const tool = read("lib/factory/toolJobsDb.ts");
  assert.ok(tool.includes("autoApprovedBy: autoRule") && tool.includes("limit.ok !== false"));
});

test("연결: 화면(일감 탭·대기열·설정·현황)과 마이그레이션(데이터를 지우지 않음)", () => {
  const con = read("components/admin/factory/FactoryConsole.tsx");
  assert.ok(con.includes("<TemplateSender />") && con.includes("<AutoApproveSettings />") && con.includes("<CommandPalette />"));
  assert.ok(read("components/admin/factory/AppQueue.tsx").includes("<TemplateSendButton appSlug={slug} />"));
  assert.ok(read("components/studio/StudioTopBar.tsx").includes('viewer?.kind === "admin" ? <CommandPalette />'));
  assert.ok(read("components/admin/factory/FactoryOverview.tsx").includes("<AutoApprovedStrip"));
  assert.ok(read("app/api/admin/factory/overview/route.ts").includes("recentAutoApproved"));
  const sql = read("prisma/migrations/20261118120000_job_templates_auto_approve/migration.sql");
  assert.ok(!/DROP|DELETE|TRUNCATE/i.test(sql.replace(/--.*$/gm, "")));
  assert.ok(sql.includes('"templateId"') && sql.includes('"autoApprovedBy"') && sql.includes("factory_job_templates"));
});

// ───────── 팔레트 ─────────
const data = {
  apps: [{ appSlug: "one-tiny-frame", title: "한 컷" }, { appSlug: "sprout-hub", title: "새싹 허브" }],
  jobs: [{ id: "jobabc", appSlug: "sprout-hub", title: "로그인 화면 수정", status: "running", kind: "revision" }],
  threads: [{ id: "thr1", title: "서버 점검 정비", status: "open" }],
  cards: [{ id: "card_1", appSlug: "one-tiny-frame", name: "단독 짤" }, { id: "card_2", appSlug: "one-tiny-frame", name: "짤" }, { id: "card_3", appSlug: "sprout-hub", name: "배너" }],
  templates: [{ id: "builtin-web-deploy", name: "웹 배포", kind: "revision", description: "서버에 올릴 준비" }],
};
const items = P.buildItems(data);
const top = (q) => P.paletteResults(items, q, data)[0];

test("팔레트 검색: 앱·일감·정비·카드·템플릿·설정 항목", () => {
  assert.equal(top("새싹").id, "app:sprout-hub");
  assert.equal(top("로그인").id, "job:jobabc");
  assert.equal(top("서버 점검").id, "thr:thr1");
  assert.equal(top("단독").id, "card:card_1");
  assert.equal(top("웹 배포").id, "tpl:builtin-web-deploy");
  assert.equal(top("자동 승인").id, "set:자동 승인 규칙");
  assert.equal(top("텔레그램").group, "설정");
  assert.equal(top("설정").id, "tab:settings"); // 이름 앞부분이 맞는 것이 먼저
  assert.deepEqual(P.searchPalette(items, "zzzz없는말"), []);
  assert.ok(P.searchPalette(items, "", 50).every((i) => i.group === "명령" || i.group === "이동")); // 빈 검색은 명령·이동부터
});

test("팔레트 검색: 낱말이 모두 맞아야 하고 공백·대소문자는 무시", () => {
  assert.ok(P.searchPalette(items, "SPROUT hub").some((i) => i.id === "app:sprout-hub"));
  assert.ok(!P.searchPalette(items, "새싹 단독").some((i) => i.id === "app:sprout-hub")); // '단독' 은 새싹 허브에 없다
});

test("바로 실행: 한 컷 싹이 단독 짤 2장 → 카드로 생성(가장 긴 카드 이름, 가운데가 대상)", () => {
  const r = P.paletteResults(items, "한 컷 싹이 단독 짤 2장", data);
  assert.equal(r[0].action.type, "generate");
  assert.deepEqual(r[0].action, { type: "generate", appSlug: "one-tiny-frame", card: "단독 짤", subject: "싹이", count: 2 });
  assert.equal(r[0].confirm, undefined);
  // 장 수를 안 적으면 1장, 공백 없이 붙여 써도 같다
  assert.equal(P.parseCommand("한컷싹이단독짤", data)[0].action.count, 1);
  assert.deepEqual(P.parseCommand("한컷싹이단독짤3개", data)[0].action, { type: "generate", appSlug: "one-tiny-frame", card: "단독 짤", subject: "싹이", count: 3 });
  // 다른 앱의 카드는 쓰지 않는다 / 카드가 없으면 만들지 않는다 / 대상이 비면 만들지 않는다 / 장 수가 너무 많으면 안 만든다
  assert.deepEqual(P.parseCommand("한 컷 싹이 배너 2장", data), []);
  assert.deepEqual(P.parseCommand("한 컷 싹이 2장", data), []); // 카드 이름이 없다
  assert.deepEqual(P.parseCommand("한 컷 단독 짤 2장", data)[0].action, { type: "generate", appSlug: "one-tiny-frame", card: "짤", subject: "단독", count: 2 }); // 대상 없이 쓰면 남는 말이 대상, 카드는 말 끝과 맞는 이름
  assert.deepEqual(P.parseCommand("한 컷 싹이 단독 짤 99장", data), []);
});

test("바로 실행: 스튜디오 열기·감독 상태·지금 업데이트", () => {
  const studio = P.paletteResults(items, "새싹 허브 스튜디오 열기", data)[0];
  assert.deepEqual(studio.action, { type: "navigate", href: "/studio/sprout-hub" });
  assert.deepEqual(P.paletteResults(items, "한 컷 스튜디오", data)[0].action, { type: "navigate", href: "/studio/one-tiny-frame" });
  assert.deepEqual(top("감독 상태").action, { type: "supervisor", op: "status" });
  assert.deepEqual(top("지금 업데이트").action, { type: "supervisor", op: "update_now" });
  assert.equal(top("감독 상태").confirm, undefined);
  assert.equal(top("지금 업데이트").confirm, undefined);
});

test("위험한 동작(배포·되돌리기·재시작)은 확인 글이 있다", () => {
  for (const q of ["서버 배포", "배포 되돌리기", "감독 재시작"]) assert.ok(top(q).confirm && top(q).confirm.length > 10, q);
  assert.equal(top("배포 되돌리기").action.type, "navigate"); // 실행은 기록의 버튼에서 한 번 더
  assert.equal(top("감독 재시작").action.op, "restart");
  const danger = items.filter((i) => i.confirm).map((i) => i.id).sort();
  assert.deepEqual(danger, ["cmd:deploy", "cmd:revert", "cmd:sup-restart"]);
});

test("감독 상태 한 줄", () => {
  assert.equal(P.supervisorSummary({ online: true, commit: "abcdef1234", enabled: true, autoUpdate: true, running: 1, approved: 2, pending: 3 }), "연결됨 · 버전 abcdef1 · 동작 중 · 자동 업데이트 켜짐 · 진행 1 · 대기열 2 · 승인 대기 3");
  assert.ok(P.supervisorSummary({ online: false, enabled: false, deployNote: "배포 중" }).includes("일시 정지"));
});

test("팔레트 화면: 단축키·확인 창·API 보호", () => {
  const ui = read("components/admin/factory/CommandPalette.tsx");
  assert.ok(ui.includes("e.metaKey || e.ctrlKey") && ui.includes('"k"'));
  assert.ok(ui.includes("data-palette-confirm") && ui.includes("confirming"));
  assert.ok(ui.includes("/api/admin/factory/palette") && ui.includes("/api/admin/factory/tool-jobs"));
  assert.ok(read("app/api/admin/factory/palette/route.ts").includes("requireAdmin"));
  assert.ok(read("app/api/admin/factory/templates/route.ts").includes("requireAdmin"));
});
