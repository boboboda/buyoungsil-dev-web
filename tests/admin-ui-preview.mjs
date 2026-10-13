// 관리자 HUD 디자인 미리보기(로그인 없이 보는 하니스).
// 실제 관리자 레이아웃(app/admin/layout.tsx: 상단바·하단 상태줄)·통제실 탭·AI USAGE 패널을 가짜 데이터로 그려 HTML 로 만들고,
// Tailwind(저장소 설정 그대로) + app/admin/admin-ui.css 를 붙인다. --shot 이면 헤드리스 Chrome/Edge 로 스크린샷도 찍는다.
// 상태: live(값 있음) · waiting(수신 대기) · failed(수집 실패 + 오래된 값 + 감독 끊김 + 갱신 실패) · history(이력 전체 보기)
//       · users(가입자 명단, 가짜 30명) · users-empty(가입자 0명)
//       · toolbox(통제실 [설정] 도구함 한눈에 보기, 중계 '허용') · toolbox-failed(도구 상태 읽기 실패)
//       · toolkit(통제실 [설정] 도구함 맨 위 '도구 목록'(사용 횟수 포함): 도구 5개, 용도 추정·저장 표시, 앞 두 개 펼침)
//       · studio(통제실 [스튜디오] 탭: 게임 스튜디오, 프로젝트 선택·도구 체크·스튜디오 주소 링크, 미분류 1개)
//       · history-merged(이력 [작업 진행] 탭: 상태별 묶음 보드) · history-jobs(이력 [앱 일감] 탭: 일감 20개 + 긴 결과 접힘)
//       · devices(통제실 [사용량] 장비 상태: 서버1 위험·주의 값, 서버2 끊김·GPU 없음, 메인PC GPU 있음 + 상태바 장비 칸)
//       · fable-usage(AI USAGE 의 Fable 주간 한도 카드 + 오늘 모델별 비율 + 상태바 Fable) · fable-missing(Fable 값 못 받음)
//       · status-mix(통제실 [현황] 상태 체계: '지금 진행 중' 띠 + [작업 진행] 보드: 진행 중 1·승인 필요 2·대기 3·최근 완료·실패)
//       · app-slots(통제실 [설정] '동시에 만들 앱 수' 카드: 기본 3 · 지금 진행 중 2 / 최대 3, 값을 줄여 넘칠 때, + [현황] 띠에 3개 동시에)
//       · model-approve(승인할 때 Claude Code 모델 고르기: [현황] 승인 줄의 모델 선택(Codex 일감은 숨김) + 이력 '모델: ○○' + [설정] 기본 모델)
// 실행: npm run preview:admin-ui            → tests/.out/admin-ui-{상태}.html
//       npm run preview:admin-ui -- --shot  → + admin-ui-{상태}-{1440,1024,360}.png
// API·DB·키는 쓰지 않는다. 결과 폴더(tests/.out)는 커밋하지 않는다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createElement: h } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const heroui = require("@heroui/react");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repo, "tests", ".out");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

function loadTs(relative, dependencies = {}) {
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", output)((name) => (Object.hasOwn(dependencies, name) ? dependencies[name] : require(name)), module, module.exports);
  return module.exports;
}

const Link = ({ href, children, ...rest }) => h("a", { href, ...rest }, children);
const link = { __esModule: true, default: Link };
const meters = loadTs("components/admin/ui/meters.tsx");
const site = loadTs("config/site.ts");
const fx = loadTs("components/admin/factory/fx.tsx");
const tabs = loadTs("components/admin/factory/consoleTabs.ts");
const { default: FactoryTabs } = loadTs("components/admin/factory/FactoryTabs.tsx", { "next/link": link, "./consoleTabs": tabs });
const fableLib = loadTs("lib/claude-status/fable.ts");
const { UsageDashView } = loadTs("components/admin/factory/UsageDash.tsx", { "@/components/admin/ui/meters": meters, "@/lib/claude-status/fable": fableLib });
const noop = () => ({});
const topBar = loadTs("components/admin/ui/AdminTopBar.tsx", {
  "next/link": link,
  "next/navigation": { usePathname: () => "/admin/factory", useRouter: noop },
  "next-auth/react": { signOut: noop, useSession: () => ({ data: null }) },
  "@/app/hooks/auth/useIdleLogout": { useIdleLogout: () => ({ remainingSeconds: null }) },
  "@/components/admin/ui/meters": meters,
  "@/config/site": site,
});
const statusBar = loadTs("components/admin/ui/AdminStatusBar.tsx", { "@/components/admin/ui/meters": meters, "@/lib/claude-status/fable": fableLib });
const aiLib = loadTs("lib/factory/ai.ts");
const modelSelect = loadTs("components/admin/factory/ClaudeModelSelect.tsx", { "@/lib/factory/ai": aiLib });
const memoryReportLib = loadTs("lib/factory/memory-report.ts");
const HandoffBox = loadTs("components/admin/factory/HandoffBox.tsx", { "@/lib/factory/memory-report": memoryReportLib }).default;
const MemoryStatus = loadTs("components/admin/factory/MemoryStatus.tsx", { "@/lib/factory/memory-report": memoryReportLib }).default;
const { TurnLogs } = loadTs("components/admin/factory/MaintenancePanel.tsx", { "./AiEngineSelect": () => null, "./ClaudeModelSelect": modelSelect, "@/lib/factory/ai": aiLib, "./HandoffBox": { __esModule: true, default: () => null }, "@heroui/react": heroui });
const slotsCard = loadTs("components/admin/factory/AppSlotsSettings.tsx");
const { HistoryPanelView, ActiveStrip } = loadTs("components/admin/factory/FactoryOverview.tsx", { "./fx": fx, "./ClaudeModelSelect": modelSelect, "@/lib/factory/ai": aiLib });
const { default: DefaultAiSettings } = loadTs("components/admin/factory/DefaultAiSettings.tsx", {
  "@/lib/factory/ai": aiLib,
  "./AiEngineSelect": loadTs("components/admin/factory/AiEngineSelect.tsx", { "@/lib/factory/ai": aiLib }),
});
const members = loadTs("lib/admin/members.ts");
const { default: MembersView } = loadTs("components/admin/users/MembersView.tsx", { "next/link": link, "@/components/admin/ui/meters": meters, "@/lib/admin/members": members });
const mask = loadTs("lib/factory/mask.ts");
const toolBroker = loadTs("lib/factory/toolBroker.ts", { "@/lib/factory/mask": mask });
const toolboxLib = loadTs("lib/factory/toolbox.ts", { "@/lib/factory/toolBroker": toolBroker });
const devicesLib = loadTs("lib/factory/devices.ts", { "@/lib/prisma": { __esModule: true, default: null } });
const { DevicePanelView } = loadTs("components/admin/factory/DevicePanel.tsx", { "@/components/admin/ui/meters": meters });
const toolkitLib = loadTs("lib/factory/toolkit.ts", { "@/lib/factory/mask": mask });
const studioLib = loadTs("lib/factory/studioProjects.ts", { "@/lib/factory/toolkit": toolkitLib });
const { default: StudioWorkbench } = loadTs("components/admin/factory/StudioWorkbench.tsx", { "@/lib/factory/toolkit": toolkitLib, "@/lib/factory/studioProjects": studioLib });
const { ToolkitToolsView } = loadTs("components/admin/factory/ToolkitToolsPanel.tsx", {
  "@/lib/prisma": { __esModule: true, default: null },
  "@/lib/factory/toolkit": toolkitLib,
  "@/lib/factory/toolbox": toolboxLib,
  "./ToolkitPurposeSelect": loadTs("components/admin/factory/ToolkitPurposeSelect.tsx", { "@/lib/factory/toolkit": toolkitLib }),
});
const { ToolboxView } = loadTs("components/admin/factory/ToolboxPanel.tsx", { "@/lib/prisma": { __esModule: true, default: null }, "@/lib/factory/toolbox": toolboxLib });

// ── 가짜 데이터 ──
const now = Date.UTC(2026, 9, 13, 3, 42, 0); // 12:42 KST
const MIN = 60_000;
const HOUR = 60 * MIN;
const win = (usedPct, resetIn) => ({ usedPct, resetsAt: now + resetIn, reset: false });
const day = (offset, tokens) => ({ date: `d-${offset}`, input: tokens * 0.7, output: tokens * 0.2, cacheCreate: tokens * 0.1, cacheRead: 0 });
const daily = Array.from({ length: 14 }, (_, i) => day(i, [0.8, 1.1, 0.4, 2.3, 1.9, 0, 0.6, 1.4, 2.8, 1.2, 0.9, 1.7, 1.05, 1.42][i] * 1e6));
const base = { asOf: now - 4_000, sessions: [], windowHours: 5, windowTokens: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, daily, recent: [] };
const claudeLive = { fiveHour: win(23.4, 2 * HOUR + 14 * MIN), sevenDay: win(41, 3 * 24 * HOUR + 4 * HOUR), asOf: now - MIN, stale: false, failedAt: null, failReason: null, source: "auto", extra: [{ key: "weekly_scoped · Fable", usedPct: 12, resetsAt: now + 30 * HOUR, reset: false }], extraAsOf: now - MIN, device: "work-pc" };
const codexLive = { fiveHour: win(0, 5 * HOUR), sevenDay: win(17, 5 * 24 * HOUR), asOf: now - 2 * MIN, stale: false, failedAt: null, failReason: null, source: "auto", extra: [], extraAsOf: null, device: "work-pc" };

const STATES = {
  live: {
    title: "값 있음",
    stats: { ...base, limits: claudeLive, codexLimits: codexLive },
    bar: { asOf: now, supervisor: { online: true, lastSeenAt: now - 20_000, running: 1, waiting: 2, commit: "a1b2c3d" }, build: { commit: "83793a957b06", at: now - 3 * HOUR }, claude: claudeLive, codex: codexLive },
  },
  waiting: {
    title: "수신 대기",
    stats: { ...base, daily: [], limits: null, codexLimits: null },
    bar: null,
  },
  failed: {
    title: "수집 실패 + 오래된 값",
    stats: {
      ...base,
      limits: { fiveHour: { usedPct: 60, resetsAt: now - 5 * MIN, reset: true }, sevenDay: win(78, 4 * 24 * HOUR), asOf: now - 22 * MIN, stale: false, failedAt: now - 3 * MIN, failReason: "HTTP 429 요청 제한 · 15분 뒤 다시", source: "statusline", extra: [], extraAsOf: null, device: "work-pc" },
      codexLimits: { fiveHour: win(41, 3 * HOUR), sevenDay: win(94, 5 * 24 * HOUR), asOf: now - 40 * MIN, stale: true, failedAt: now - 2 * MIN, failReason: "HTTP 401", source: "auto", extra: [], extraAsOf: null, device: "work-pc" },
    },
    error: "갱신 실패, 다시 시도 중",
    bar: { asOf: now, supervisor: { online: false, lastSeenAt: now - 47 * MIN, running: 0, waiting: 3, commit: null }, build: null, claude: null, codex: null },
    barError: "상태 갱신 실패",
  },
};
// 이력 전체 보기: 서버 배포 탭에서 [전체 보기]를 누른 모양(95개 중 첫 20개 + [더 보기]). 다른 상태는 최근 목록(5개만)
STATES.history = { ...STATES.live, title: "이력 전체 보기", history: "all" };
STATES["history-jobs"] = { ...STATES.live, title: "이력 · 앱 일감 탭", history: "jobs" };
STATES["history-merged"] = { ...STATES.live, title: "이력 · 작업 진행 탭", history: "merged" };
// 가입자 명단(/admin/users): 가짜 30명(이름·이메일은 만든 값) 첫 쪽 25명 / 0명
STATES.users = { ...STATES.live, title: "가입자 명단 · 30명", users: "many" };
STATES["users-empty"] = { ...STATES.live, title: "가입자 명단 · 0명", users: "empty" };
// 도구함 한눈에 보기(통제실 [설정] 맨 위): 중계 '허용' + 최근 기록 / 읽기 실패
STATES.toolbox = { ...STATES.live, title: "도구함 · 중계 허용", toolbox: "live" };
STATES.toolkit = { ...STATES.live, title: "도구함 · 툴킷 도구 상세", toolkit: true };
STATES.studio = { ...STATES.live, title: "스튜디오 · 게임 스튜디오", studio: true };
STATES["toolbox-failed"] = { ...STATES.live, title: "도구함 · 읽기 실패", toolbox: "failed" };
// 장비 상태(통제실 [사용량] 맨 위): 서버1 CPU 위험·RAM 주의 + 컨테이너 5개, 서버2 40분 끊김(GPU 없음), 메인PC 12분 오래된 값(GPU 있음)
const devRow = (device, ago, data) => ({ device, data, measuredAt: new Date(now - ago), receivedAt: new Date(now - ago) });
const devSamples = (device, f) => Array.from({ length: 288 }, (_, i) => ({ device, at: new Date(now - i * 5 * MIN), cpuPct: f(i), ramPct: 50 }));
const devicesData = {
  asOf: now,
  devices: [
    devicesLib.toDeviceView("server1", devRow("server1", 40_000, { cpuPct: 93.4, ram: { usedGb: 24.6, totalGb: 31.2 }, gpu: { state: "none" }, disks: [{ mount: "/", usedGb: 402.1, totalGb: 468.4 }, { mount: "/data", usedGb: 610, totalGb: 1832.2 }], containers: { state: "ok", names: ["buyoungsil-web", "postgres", "redis", "studio-api", "uptime"] } }), devSamples("server1", (i) => 20 + ((i * 7) % 60)), now),
    devicesLib.toDeviceView("server2", devRow("server2", 40 * MIN, { cpuPct: 3.1, ram: { usedGb: 2.1, totalGb: 15.5 }, gpu: { state: "none" }, disks: [{ mount: "/", usedGb: 88.2, totalGb: 233.7 }] }), devSamples("server2", () => 4), now),
    devicesLib.toDeviceView("main-pc", devRow("main-pc", 12 * MIN, { cpuPct: 17.3, ram: { usedGb: 48.3, totalGb: 63.7 }, gpu: { state: "ok", list: [{ utilPct: 2, memUsedGb: 9.6, memTotalGb: 15.9, tempC: 41 }] }, disks: [{ mount: "C:", usedGb: 819.8, totalGb: 930.5 }, { mount: "E:", usedGb: 14.3, totalGb: 3726 }, { mount: "F:", usedGb: 144.4, totalGb: 1816.3 }, { mount: "D:", usedGb: 561.3, totalGb: 931.5 }] }), devSamples("main-pc", (i) => (i < 30 ? 60 : 15)), now),
  ],
  deploys: { containers: { state: "ok", count: 5, names: ["buyoungsil-web", "postgres", "redis", "studio-api", "uptime"], asOf: now - 40_000 }, homepage: { released: 4, total: 11 }, storeReleased: 2 },
};
const devicesBrief = devicesData.devices.map((d) => ({ device: d.device, short: d.short, state: d.state, cpuPct: d.cpuPct, ramPct: d.ram?.pct ?? null }));
STATES.devices = { ...STATES.live, title: "장비 상태", devices: true, bar: { ...STATES.live.bar, devices: devicesBrief } };
// 인계 기록 칸(일감 상세·정비 대화의 접이식, 읽기 전용): AI 블록이 있는 정비 항목 / 블록이 없고 실패한 앱 일감 항목 (하니스에서만 펼쳐서 찍는다)
STATES["status-mix"] = { ...STATES.live, title: "[현황] 상태 체계", statusMix: true };
STATES["app-slots"] = { ...STATES.live, title: "[설정] 동시에 만들 앱 수", appSlots: true };
STATES.maintLog = { ...STATES.live, title: "정비 지시별 진행 로그", maintLog: true };
STATES.handoff = { ...STATES.live, title: "인계 기록 칸", handoff: true };
const handoffSample = {
  v: 1, kind: "maintenance", taskId: "turn1", title: "통제실 [현황] 이력에 앱 일감 추가", engine: "claude", model: "opus", at: "2026-10-13T09:10:18.000Z", status: "done",
  request: "[현황] 히스토리에 '앱 일감' 기록도 전부 보이게", hasAiBlock: true, doneWhen: "탭 줄에 [앱 일감 · 총 N개] 항상 보임, 전체 히스토리에도 합침", done: "jobs 이력 API·탭·전체 히스토리 합치기, factory_jobs 인덱스 마이그레이션",
  remaining: "배포 후 실제 화면에서 줄 클릭 확인", caution: "일감 목록 탭의 최근 50개 제한은 그대로(안내만 추가)",
  files: { committed: { list: ["lib/factory/approvals.ts", "components/admin/factory/FactoryOverview.tsx", "tests/factory-history.test.mjs"], more: 8 }, uncommitted: { list: [], more: 0 } },
  checks: [{ name: "감독 문법·타입 검사", result: "통과" }, { name: "prisma validate", result: "통과" }, { name: "앱 빌드", result: "건너뜀", detail: "Mac 필요" }],
  git: { head: "a6bed92b6f2a4f1f3c2f5f9f6e6d2e8c1a1b2c3d", branch: "main", dirty: false },
  memory: {
    current: "# 현재 일감 요약\n- 일감: 통제실 [현황] 이력에 앱 일감 추가 (정비 · Claude Code · 2026-10-13 09:10)\n- 상태: 완료 · 검사 감독 문법·타입 검사 통과; prisma validate 통과\n- 요청: [현황] 히스토리에 '앱 일감' 기록도 전부 보이게\n- 바꾼 파일: lib/factory/approvals.ts, components/admin/factory/FactoryOverview.tsx 외 8개\n- 한 일·결정: jobs 이력 API·탭·전체 히스토리 합치기, factory_jobs 인덱스 마이그레이션\n- 남은 일: 배포 후 실제 화면에서 줄 클릭 확인\n- 주의: 일감 목록 탭의 최근 50개 제한은 그대로\n- Git: main@a6bed92\n- 전체 요약: 갱신 반영",
    updatedAt: "2026-10-13T09:10:20.000Z", projectBytes: 6144, push: "ok", needsCompact: false,
  },
};
const handoffFailed = {
  ...handoffSample, kind: "job", taskId: "cjob000118", appSlug: "memo-pad", title: "메모장 수정", engine: "codex", model: "기본", at: "2026-10-13T08:30:00.000Z", status: "failed", hasAiBlock: false,
  request: "수정: 메모 삭제 버튼이 안 눌려요", doneWhen: "", done: "", remaining: "", caution: "", failReason: "필수 검증 실패: flutter analyze 오류 3개",
  files: { committed: { list: [], more: 0 }, uncommitted: { list: ["lib/main.dart", "lib/memo_list.dart"], more: 0 } },
  checks: [{ name: "필수 검증", result: "실패", detail: "flutter analyze 오류 3개" }], git: { head: "0f3c2d1e9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d", branch: "main", dirty: true },
};

// [현황] 상태 체계 견본: 진행 중 1 · 승인 필요 1 · 대기 3 · 완료 · 실패(+취소·감독·배포·정비)가 섞인 전체 히스토리, 맨 위 '지금 진행 중' 띠
const statusMixPage = () => {
  const run = { type: "job", id: "cjob000117", title: "물 마시기 알림 수정", sub: "water-log", kindLabel: "수정", startedAt: iso(now - 192_000), aiEngine: "claude", aiModel: "opus" };
  const mkJob = (n, status, extra = {}) => ({ ...jobRow(n), ...extra, status, id: `cjob${String(900 - n).padStart(6, "0")}` });
  const board = {
    active: { running: [run], queued: 3, next: { type: "job", title: "걸음 수 기록 수정" } },
    inbox: { jobs: [{ id: "cjob000200", appSlug: "timer-app", title: "타이머 새 앱", kind: "new", kindLabel: "새 앱", stack: "flutter", aiEngine: "claude", source: "통제실", createdAt: iso(now - 25 * MIN) }], turns: [{ id: "cturn1", threadId: "cthr0", threadTitle: "통제실 [현황] 색 정리", text: "x", aiEngine: "claude", source: "통제실", createdAt: iso(now - 9 * MIN) }], deploys: [] },
    jobs: [
      { ...mkJob(0, "running", { title: "물 마시기 알림 수정", startedAt: iso(now - 192_000), result: null }), id: "cjob000117" },
      mkJob(1, "approved", { title: "걸음 수 기록 수정", result: null }),
      mkJob(2, "approved", { title: "메모장 수정", result: null }),
      mkJob(3, "approved", { title: "타이머 새 앱", result: null }),
      mkJob(4, "done", { result: "앱 완성: 화면 5개, 빌드·시험 통과" }),
      mkJob(5, "failed", { result: "필수 검증 실패: flutter analyze 오류 3개" }),
      mkJob(6, "cancelled", { result: null }),
    ],
    threads: [{ ...threadRow(1), status: "closed", lastTurnStatus: "done" }],
  };
  const view = () =>
    h(HistoryPanelView, { data: historyData, open: true, tab: "progress", full: null, board, now, onToggle: noop2, onTab: noop2, onShowAll: noop2, onMore: noop2, onShowRecent: noop2 });
  const todo = h(
    Card,
    { className: "mb-6", "data-title": "todo · 승인·배포" },
    h(
      CardBody,
      { className: "space-y-3" },
      h("div", { className: "flex items-center gap-2 font-semibold" }, h(fx.StatusDot, { tone: "warn" }), "승인·배포 할 일", h("span", { className: "font-mono" }, "(2)")),
      ...[
        ["approval", "🛠 정비 지시", "통제실 [현황] 색 정리", "승인"],
        ["approval", "📱 새 앱", "timer-app 기획서", "승인"],
      ].map(([k, kind, t, btn]) =>
        h(
          "div",
          { key: t, className: "fx-row flex flex-col gap-2 rounded-lg border border-default-200 p-2 sm:flex-row sm:items-center sm:justify-between", "data-st": k },
          h("div", { className: "flex flex-wrap items-center gap-2 text-sm" }, h(fx.StatusChip, { kind: k }), h(fx.KindChip, { label: kind }), h("span", { className: "font-medium" }, t)),
          h(Button, { color: "primary", size: "sm" }, btn),
        ),
      ),
    ),
  );

  return h(
    "div",
    { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" },
    h("div", { className: "fx-split-main space-y-4" },
      h("h1", { className: "mb-4 flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
      h(FactoryTabs, { active: "status" }),
      h(ActiveStrip, { now, active: { running: [run], queued: 3, next: { type: "job", title: "걸음 수 기록 수정" } } }),
      todo,
      h("h2", { className: "fx-label" }, "── 작업 진행 (진행 중 1 · 승인 필요 2 · 대기 3 · 최근 완료·실패) ──"),
      view(),
      h("h2", { className: "fx-label mt-6" }, "── 띠: 진행 중 없음 / 4개 이상 ──"),
      h(ActiveStrip, { now, active: { running: [], queued: 3, next: { type: "job", title: "걸음 수 기록 수정" } } }),
      h(ActiveStrip, { now, active: { running: [1, 2, 3, 4, 5].map((n) => ({ ...run, id: `cjob${n}`, title: `앱 일감 ${n}`, startedAt: iso(now - n * 61_000) })), queued: 0, next: null } }),
    ),
  );
};

// [설정] '동시에 만들 앱 수' 카드(정한 적 없음 3 / 2로 정했는데 3개 도는 중) + 동시에 3개가 돌 때의 [현황] 띠
const appSlotsPage = () => {
  const mk = (n) => ({ type: "job", id: `cjob${n}`, title: ["물 마시기 알림 수정", "걸음 수 기록 새 앱", "메모장 수정"][n - 1], sub: ["water-log", "step-log", "memo-app"][n - 1], kindLabel: n === 2 ? "새 앱" : "수정", startedAt: iso(now - n * 97_000), aiEngine: n === 3 ? "codex" : "claude", aiModel: n === 3 ? null : ["opus", "sonnet"][n - 1] });
  return h(
    "div",
    { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" },
    h(
      "div",
      { className: "fx-split-main space-y-4" },
      h("h1", { className: "mb-4 flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
      h(FactoryTabs, { active: "settings" }),
      h("h2", { className: "fx-label" }, "── [설정] 동시에 만들 앱 수: 정한 적 없음(기본 3), 2개 도는 중 ──"),
      h(slotsCard.AppSlotsView, { s: { appSlots: 3, appSlotsDefault: true, running: 2 }, pick: 3 }),
      h("h2", { className: "fx-label" }, "── 2개로 줄였는데 3개가 돌고 있을 때(끊지 않음) ──"),
      h(slotsCard.AppSlotsView, { s: { appSlots: 2, appSlotsDefault: false, running: 3 }, pick: 2, notice: "동시에 만들 앱 수를 2개로 저장했어요. 감독 프로그램이 다음 확인 때 받아 가요. 줄여도 이미 도는 일감은 끊지 않고, 끝나면서 줄어들어요." }),
      h("h2", { className: "fx-label" }, "── [현황] 맨 위 띠: 동시에 3개 ──"),
      h(ActiveStrip, { now, active: { running: [1, 2, 3].map(mk), queued: 2, next: { type: "job", title: "타이머 새 앱" } } }),
    ),
  );
};
const turnLog = (i, text) => ({ id: "l" + i, role: "log", turnId: "t", text, status: null, source: null, createdAt: new Date(now - (30 - i) * 1000).toISOString() });
const maintLogPage = () =>
  h("div", { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" }, h("div", { className: "fx-split-main space-y-2" },
    h("h1", { className: "mb-4 flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
    h(FactoryTabs, { active: "maintenance" }),
    h("div", { className: "ml-6 rounded-lg bg-primary-50 p-2 text-sm" }, "👤 지시 · 통제실 · 진행 중 — 정비 진행 로그 상세 보기"),
    h(TurnLogs, { running: true, logs: [
      turnLog(1, "정비 폴더 준비: selfdev (main ba65b77)"), turnLog(2, "모델: 기본 설정(--model 없음)"),
      turnLog(3, "앱 일감이 진행 로그를 저장하는 방식을 먼저 찾아볼게요."), turnLog(4, "$ grep -rn FactoryJobLog lib app"),
      turnLog(5, "Edit: lib/factory/maintenance.ts"), turnLog(6, "Edit: components/admin/factory/MaintenancePanel.tsx"),
      turnLog(7, "검사: 감독 프로그램 문법, 타입 검사(tsc)…"),
    ] }),
    h("div", { className: "ml-6 mt-4 rounded-lg bg-primary-50 p-2 text-sm" }, "👤 지시 · 통제실 · 완료 — 이전 지시(끝난 뒤 로그를 다시 연 모습)"),
    h(TurnLogs, { running: false, logs: [turnLog(11, "정비 폴더 준비: selfdev (main 6ec8917)"), turnLog(12, "$ npm run test:factory-status"), turnLog(13, "검사 통과 · 커밋 ba65b77")] }),
  ));
const handoffPage = () =>
  h("div", { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" }, h("div", { className: "fx-split-main space-y-4" },
    h("h1", { className: "mb-4 flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
    h(FactoryTabs, { active: "jobs" }),
    h("h2", { className: "fx-label" }, "── 정비 대화의 결과 아래 (AI 인계 블록 있음) ──"),
    h("div", { "data-open-details": true }, h(HandoffBox, { entry: handoffSample })),
    h("h2", { className: "fx-label mt-6" }, "── 일감 상세의 결과 아래 (AI 블록 없음 · 실패) ──"),
    h("div", { "data-open-details": true }, h(HandoffBox, { entry: handoffFailed })),
    h("h2", { className: "fx-label mt-6" }, "── 접힌 모습(기본) ──"),
    h(HandoffBox, { entry: handoffSample }),
    h("h2", { className: "fx-label mt-6" }, "── [설정] 🤖 AI 도구 상태 칸 안의 '작업 메모리' 폴더별 한 줄 ──"),
    h("div", { className: "space-y-1 rounded-lg border border-default-200 p-3 text-sm" }, h(MemoryStatus, { report: "selfdev|2026-10-13T09:10:20.000Z|6|ok|0;memo-pad|2026-10-13T08:31:02.000Z|3|failed|0;timer-app|2026-10-12T21:00:00.000Z|22|none|1" })),
  ));
// 승인할 때 모델 고르기: 앱 일감(opus 고름)·정비 지시(기본 설정 사용)·Codex 출시 일감(모델 칸 없음) + 일감 이력 + 설정 탭 기본 모델
STATES["model-approve"] = { ...STATES.live, title: "승인 · 모델 고르기", model: true };
// Fable 사용량: Fable 주간 한도 카드(37%) + 오늘 모델별 비율 막대 + 상태바 'Fable 주 37%' / Fable 값을 못 받음('값 없음(한도 정보 못 받음)')
const claudeFable = { ...claudeLive, extra: [{ key: "weekly_scoped · Fable", usedPct: 37, resetsAt: now + 4 * 24 * HOUR + 3 * HOUR, reset: false }, { key: "seven_day_opus", usedPct: 3, resetsAt: null, reset: false }], modelTokens: { date: "d-13", asOf: now - MIN, models: { fable: 812_000, opus: 455_000, sonnet: 120_000, haiku: 30_000, other: 3_000 } } };
STATES["fable-usage"] = { ...STATES.live, title: "Fable 사용량", stats: { ...STATES.live.stats, limits: claudeFable }, bar: { ...STATES.live.bar, claude: claudeFable } };
const claudeNoFable = { ...claudeLive, extra: [], modelTokens: null };
STATES["fable-missing"] = { ...STATES.live, title: "Fable 값 없음", stats: { ...STATES.live.stats, limits: claudeNoFable }, bar: { ...STATES.live.bar, claude: claudeNoFable } };

const iso = (t) => new Date(t).toISOString();
const deployRow = (i) => ({
  id: `cdep${i}`,
  threadId: `cthr${i % 7}`,
  threadTitle: ["관리자 화면 뒤 흰색 노출 수정", "AI 한도 자동 갱신", "관리자 UI 2차: 터미널 HUD 스타일", "통제실 '히스토리 전체 보기' 복구", "공장 정비 대기열·배포 묶기", "앱 공장 통제실: 승인·배포 할 일", "통제실 탭화"][i % 7],
  commit: `${(0x1a81574 + i * 7919).toString(16)}0000`,
  via: i % 3 ? "통제실" : "자동",
  requestedAt: iso(now - i * 3 * HOUR),
  startedAt: iso(now - i * 3 * HOUR + MIN),
  finishedAt: i === 0 ? null : iso(now - i * 3 * HOUR + 4 * MIN),
  ok: i === 0 ? null : i % 9 !== 4,
  result: i === 0 ? null : i % 9 === 4 ? "빌드 실패: next build 종료 코드 1\nType error: …\n로그 끝" : "배포 완료 · 헬스체크 통과",
  items: i % 2 ? [{ title: `정비 지시 ${i}-1`, commit: "ebde9fa" }, { title: `정비 지시 ${i}-2`, commit: "1a81574" }] : null,
});
const historyData = {
  deploys: Array.from({ length: 40 }, (_, i) => deployRow(i)),
  updates: [],
  threads: [],
  totals: { deploys: 95, updates: 130, threads: 45, jobs: 138 },
};
// 앱 일감 한 줄(/api/admin/factory/history?kind=jobs 항목 모양)
const JOB_ROWS = [
  ["done", "new", "새 앱", "claude", "opus", "앱 완성: 화면 5개, 빌드·시험 통과, 스크린샷 4장 올림"],
  ["failed", "revision", "수정", "claude", "sonnet", "빌드 실패: flutter build apk 종료 코드 1 — Gradle 의존성을 내려받지 못했어요. ".repeat(4)],
  ["running", "revision", "수정", "claude", null, null],
  ["cancelled", "new", "새 앱", "codex", null, null],
  ["pending", "release", "출시 준비", "claude", "default", null],
  ["approved", "revision", "수정", "claude", "fable", null],
  ["review", "release", "출시 준비", "claude", null, "스토어 자료를 만들었어요. 검토 대기"],
];
const jobRow = (i) => {
  const [status, kind, kindLabel, aiEngine, aiModel, result] = JOB_ROWS[i % JOB_ROWS.length];

  return {
    id: `cjob${String(1000 - i).padStart(6, "0")}`,
    appSlug: ["memo-pad", "walk-count", "water-log"][i % 3],
    title: ["메모장", "걸음 수 기록", "물 마시기 알림"][i % 3] + (kind === "revision" ? " 수정" : ""),
    kind,
    kindLabel,
    status,
    aiEngine,
    aiModel: aiModel === "default" ? null : aiModel,
    result,
    createdAt: iso(now - (i * 3 + 1) * HOUR),
    startedAt: status === "pending" || status === "approved" ? null : iso(now - (i * 3 + 0.9) * HOUR),
    finishedAt: status === "done" || status === "failed" ? iso(now - (i * 3 + 0.4) * HOUR) : null,
  };
};
// [전체 히스토리] 탭: 배포·감독 프로그램 업데이트·정비 대화를 시각순으로 합친 첫 20개(배포 하나는 긴 빌드 로그)
const updateRow = (i) => ({
  id: 130 - i,
  at: iso(now - (i * 4 + 1) * HOUR),
  fromCommit: i % 2 ? null : `${(0xbeef000 + i).toString(16)}`,
  commit: `${(0xc0de000 + i * 31).toString(16)}000`,
  subject: ["관리자 화면 뒤 흰색 노출 수정", "정비 대기열 묶음 배포", "도구 요청 중계 제한 시간", "AI 한도 자동 갱신"][i % 4],
  note: i % 2 ? "자동 업데이트 확인: 이미 최신" : "자동 업데이트 완료 → 재시작",
  thread: i % 2 ? null : { id: `cthr${i}`, title: "통제실 탭화" },
});
const threadRow = (i) => ({
  id: `cthr${i}`,
  title: ["통제실 히스토리 '전체' 탭", "도구함 한눈에 보기", "가입자 명단", "홈 통계 카드 복구"][i % 4],
  status: i ? "closed" : "open",
  lastTurnStatus: i ? "done" : "running",
  turns: 1 + i,
  pushedCommit: i ? `${(0x1a605bd + i).toString(16)}000` : null,
  needsDeploy: i === 1,
  deployInProgress: false,
  deployedAt: i > 1 ? iso(now - (i * 7) * HOUR) : null,
  deployResult: null,
  updatedAt: iso(now - (i * 5 + 0.5) * HOUR),
});
const noop2 = () => {};
const historyPanel = (state) =>
  h(HistoryPanelView, {
    data: STATES[state].history === "all" ? historyData : { ...historyData, deploys: historyData.deploys.slice(0, 5) },
    open: true,
    tab: STATES[state].history === "merged" ? "progress" : STATES[state].history === "jobs" ? "jobs" : "deploys",
    full: STATES[state].history === "jobs" ? { kind: "jobs", items: Array.from({ length: 20 }, (_, i) => jobRow(i)), nextCursor: "cjob000981", total: 138, loading: false, error: null } : STATES[state].history === "all" ? { kind: "deploys", items: historyData.deploys.slice(0, 20), nextCursor: "cdep19", total: 95, loading: false, error: null } : null,
    board: STATES[state].history === "merged" ? { active: { running: [], queued: 0, next: null }, inbox: { jobs: [], turns: [], deploys: [] }, jobs: Array.from({ length: 12 }, (_, i) => jobRow(i)), threads: [] } : undefined,
    now,
    onToggle: noop2,
    onTab: noop2,
    onShowAll: noop2,
    onMore: noop2,
    onShowRecent: noop2,
  });

// 가짜 가입자 30명: 이메일 / Google / GitHub / 이메일+Google 이 돌아가며, 0번은 관리자
const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임"];
const memberRows = Array.from({ length: 30 }, (_, i) => ({
  id: `cfake${String(i).padStart(4, "0")}`,
  name: i === 4 ? "아주아주긴이름을쓰는회원님의닉네임입니다" : `${SURNAMES[i % 10]}회원${String(30 - i).padStart(2, "0")}`,
  email: i === 4 ? "a.very.long.email.address.for.layout.check@example-company.co.kr" : `member${30 - i}@example.com`,
  role: i === 0 ? "admin" : "user",
  methods: [["email"], ["google"], ["github"], ["email", "google"]][i % 4],
  joinedAt: iso(now - (i < 2 ? i * 5 * HOUR + 30 * MIN : i * 2.5 * 24 * HOUR)),
}));
const usersData = {
  many: {
    summary: { total: 30, today: 2, week: 3, month: 6, byMethod: { email: 15, google: 15, github: 7 }, byRole: { admin: 1, user: 29 } },
    list: { items: memberRows.slice(0, 25), total: 30, page: 1, pages: 2, limit: 25 },
  },
  empty: {
    summary: { total: 0, today: 0, week: 0, month: 0, byMethod: { email: 0, google: 0, github: 0 }, byRole: { admin: 0, user: 0 } },
    list: { items: [], total: 0, page: 1, pages: 1, limit: 25 },
  },
};

// ── 화면 ──
const { Card, CardBody, Button, Input } = heroui;
const Item = (label, value, mono = false) =>
  h("div", { key: label, className: "min-w-0" }, h("dt", { className: "text-default-500" }, label), h("dd", { className: `${mono ? "font-mono " : ""}font-medium break-words` }, value));

function leftWork(state) {
  const online = state !== "failed";

  return h(
    "div",
    { className: "fx-split-main" },
    h(
      "header",
      { className: "mb-4" },
      h("h1", { className: "flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
      h("p", { className: "mt-2 text-sm fx-muted" }, "기획서를 승인하면 내 PC의 감독 프로그램이 가져가서 앱을 만들어요"),
    ),
    h(FactoryTabs, { active: "status" }),
    // 승인·배포 할 일 (FactoryOverview 모양)
    h(
      Card,
      { className: "mb-6", "data-title": "todo · 승인·배포" },
      h(
        CardBody,
        { className: "space-y-3" },
        h(
          "div",
          { className: "flex flex-wrap items-center justify-between gap-2" },
          h("div", { className: "flex items-center gap-2 font-semibold" }, h(fx.StatusDot, { tone: "warn" }), "승인·배포 할 일", h("span", { className: "font-mono" }, "(2)")),
          h("span", { className: "text-xs text-default-500" }, "텔레그램 버튼과 같은 동작이에요. 어느 쪽에서 먼저 눌러도 한 번만 처리돼요."),
        ),
        ...[
          ["관리자 UI 2차: 가독성 + 네비바·푸터", "배포 대기 · 83793a9"],
          ["timer-app 기획서", "승인 기다림 · 3분 전"],
        ].map(([t, sub], i) =>
          h(
            "div",
            { key: t, className: "flex flex-col gap-2 rounded-lg border border-default-200 p-2 sm:flex-row sm:items-center sm:justify-between" },
            h("div", { className: "min-w-0 text-sm" }, h("div", { className: "font-medium" }, t), h("div", { className: "mt-1 font-mono text-xs text-default-500" }, sub)),
            h("div", { className: "flex gap-2" }, i === 0 ? h(Button, { color: "primary", size: "sm" }, "배포") : h(Button, { color: "success", size: "sm" }, "승인"), h(Button, { size: "sm", variant: "flat" }, "자세히")),
          ),
        ),
      ),
    ),
    // 감독 프로그램 (SupervisorControl 모양)
    h(
      Card,
      { className: "mb-6", "data-title": "supervisor · 감독 프로그램" },
      h(
        CardBody,
        { className: "space-y-2" },
        h(
          "div",
          { className: "flex flex-wrap items-center justify-between gap-3" },
          h("div", { className: "flex items-center gap-2 font-semibold" }, h(fx.StatusDot, { tone: online ? "ok" : "bad" }), "감독 프로그램: ", h("span", { className: online ? "fx-ok" : "fx-bad" }, online ? "작동 중" : "응답 없음")),
          h(Button, { color: "warning", size: "sm" }, "일시 정지"),
        ),
        h("p", { className: "text-sm text-default-600" }, online ? "승인된 일감을 가져가서 만들어요." : "PC 가 47분째 응답하지 않아요. 작업 PC 가 켜져 있는지 확인하세요."),
        h(
          "dl",
          { className: "grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-default-200 bg-background p-2 text-xs sm:grid-cols-4" },
          Item("연결", online ? "연결됨" : "응답 없음"),
          Item("작업 PC", "work-pc", true),
          Item("마지막 응답", online ? "2026. 10. 13. 오후 12:41:40" : "2026. 10. 13. 오전 11:55:00", true),
          Item("일감 받기", "작동 중"),
          Item("현재 버전", "a1b2c3d", true),
          Item("자동 업데이트", "켜짐"),
          Item("진행 중 / 승인된 대기", online ? "1 / 2" : "0 / 3", true),
          Item("승인 기다림", "1", true),
        ),
      ),
    ),
    historyPanel(state),
    // 일감 카드
    h(
      "div",
      { className: "grid gap-4" },
      ...[
        ["timer-app", "running", "제작 중 · 화면 3/5"],
        ["memo-app", "review", "검토 대기"],
        ["weather", "failed", "빌드 실패"],
      ].map(([name, status, note]) =>
        h(
          "div",
          { key: name, className: "fx-panel flex flex-col gap-3 p-4" },
          h("div", { className: "flex items-center justify-between gap-2" }, h("span", { className: "font-semibold font-mono" }, name), h(meters.Led, { tone: fx.jobTone(status) }, note)),
          h(fx.JobSteps, { status, startedAt: status === "failed" ? "x" : null }),
          status === "running" ? h(fx.ProgressBar, { label: "제작 진행", value: 0.6 }) : null,
        ),
      ),
      // 옛 화면(회색 유틸리티)이 토큰으로 바뀌는지 견본
      h(
        "div",
        { className: "bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl p-5" },
        h("p", { className: "text-sm text-gray-600 dark:text-gray-400" }, "옛 관리자 화면 카드(bg-white·border-gray-200·text-gray-600) → HUD 토큰"),
        h("p", { className: "text-gray-900 font-bold" }, "글/노트 관리 · 문의함 · 일감 화면 공통"),
        h("input", { className: "mt-2 w-full px-3 py-2 border rounded-lg", placeholder: "기본 입력칸 (placeholder)" }),
        h("div", { className: "mt-3" }, h(Input, { label: "HeroUI 입력칸", placeholder: "앱 이름", size: "sm" })),
      ),
    ),
  );
}

// 도구함: 실제 정리 함수(buildToolbox)에 가짜 읽은 값을 넣는다. 실패 모양은 칸별 실패(중계 기록·PC 정보) + 패널 전체 실패(null) 두 가지를 한 화면에
const toolUse = (total, ok, denied, failed) => ({ total, ok, denied, failed });
const toolboxData = {
  live: toolboxLib.buildToolbox({
    broker: { mode: "allow", maxRequests: 30, toolTimeoutSec: 0 },
    runtime: { claudeTool: "2.1.0 (Claude Code) · 로그인됨", codexTool: "0.42.0 · 로그인 안 됨", aiToolsAt: iso(now - HOUR), ffmpeg: "7.1-full_build-www.gyan.dev | C:/x/ffmpeg.exe", ffprobe: "7.1-full_build-www.gyan.dev | C:/x/ffprobe.exe" },
    usage: { echo: toolUse(2, 2, 0, 0), "toolkit.run": toolUse(17, 14, 1, 2), "?": toolUse(1, 0, 1, 0) },
    connectorToken: true,
  }),
  failed: toolboxLib.buildToolbox({ broker: null, runtime: null, usage: null, connectorToken: false }),
};

// 툴킷 도구 상세: 감독 프로그램이 보내는 모양(toolkitinfo.mjs)의 가짜 보고서를 실제 검사·정리 함수에 통과시킨다
const toolkitReport = toolkitLib.validateToolkitReport(
  {
    state: "ok",
    count: 5,
    manifestMod: "2026-10-13",
    tools: [
      { id: "pixel-codex", desc: "codex exec 로 도트 PNG 를 만들고 정리·검사한다. layout=sheet 면 소품 시트, frames>1 이면 같은 세션에서 프레임을 순서대로.", entry: "cli.py", script: "toolkit/codexgen.py", dir: "toolkit", doc: "pixel-codex: codex exec 를 하위 프로세스로 띄워 도트 PNG 를 만든다.", opts: ["description", "size", "layout", "rows", "cols", "frames"], a: ["description:string", "size:int", "layout:string", "frames:int", "name:string"], out: [], tags: ["sheet", "sprite", "webp", "cut"], net: true, sec: [], to: 900, en: true, mod: "2026-10-12" },
      { id: "pixel-anim", desc: "프레임 PNG 들을 같은 크기·팔레트로 맞추고 GIF·WebP 움짤을 만든다.", entry: "cli.py", script: "toolkit/anim.py", dir: "toolkit", doc: "pixel-anim: 프레임 PNG 여러 장을 움짤로 묶는다.", opts: ["frames", "name", "fps", "format"], a: ["frames:string", "name:string", "out:string", "fps:int", "format:string"], out: ["out"], tags: ["gif", "webp"], net: false, sec: [], to: 300, en: true, mod: "2026-10-12" },
      { id: "pixel-slice", desc: "단색 키 배경 스프라이트 시트를 소품별 투명 PNG 로 자른다.", entry: "cli.py", script: "toolkit/slice.py", dir: "toolkit", doc: "", opts: ["input", "rows", "cols"], a: ["input:path*", "output_dir:path*", "rows:int", "cols:int"], out: ["output_dir"], tags: ["sheet", "sprite"], net: false, sec: [], to: 120, en: true, mod: "2026-10-12" },
      { id: "pixel-generate", desc: "PixelLab 으로 도트 오브젝트 후보를 만든다.", entry: "cli.py", script: "toolkit/pixellab.py", dir: "toolkit", doc: "", opts: [], a: ["description:string*", "size:int*", "output_dir:path*"], out: ["output_dir"], tags: [], net: true, sec: ["PIXELLAB_TOKEN"], to: 900, en: true, mod: "2026-10-12" },
      { id: "env-doctor", desc: "환경 점검: 파이썬/Pillow, node, ffmpeg 가 있는지.", entry: "cli.py", script: "toolkit/envcheck.py", dir: "toolkit", doc: "", opts: [], a: [], out: [], tags: [], net: false, sec: [], to: 60, en: true, mod: "2026-10-12" },
    ],
  },
  new Date(now),
).info;
const toolkitView = toolkitLib.buildToolkitView(toolkitReport, { "pixel-generate": "game" });
const toolkitUsage = {
  "pixel-codex": { total: 41, ok: 36, denied: 1, failed: 4 },
  "pixel-slice": { total: 22, ok: 20, denied: 0, failed: 2 },
  "pixel-anim": { total: 9, ok: 9, denied: 0, failed: 0 },
  "?": { total: 13, ok: 9, denied: 2, failed: 2 },
};

function page(state) {
  const st = STATES[state];
  // 실제 레이아웃에 실제 상단바·상태줄 '보기' 부품을 가짜 값으로 끼운다(훅 없이)
  const { default: AdminLayout } = loadTs("app/admin/layout.tsx", {
    "./admin-ui.css": {},
    "@/config/fonts": { fontMono: { variable: "" } },
    "@/components/admin/ui/AdminDocumentTheme": { __esModule: true, default: () => null },
    "@/components/admin/ui/AdminTopBar": { __esModule: true, default: () => h(topBar.AdminTopBarView, { pathname: st.users ? "/admin/users" : "/admin/factory", clock: "12:42", account: "부영실" }) },
    "@/components/admin/ui/AdminStatusBar": { __esModule: true, default: () => h(statusBar.AdminStatusBarView, { data: st.bar, now, error: st.barError ?? null }) },
  });

  if (st.users) return h(AdminLayout, null, h(MembersView, usersData[st.users]));
  if (st.model) return h(AdminLayout, null, modelApprove());
  if (st.maintLog) return h(AdminLayout, null, maintLogPage());
  if (st.handoff) return h(AdminLayout, null, handoffPage());
  if (st.statusMix) return h(AdminLayout, null, statusMixPage());
  if (st.appSlots) return h(AdminLayout, null, appSlotsPage());
  if (st.devices)
    return h(
      AdminLayout,
      null,
      h(
        "div",
        { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" },
        h(
          "div",
          { className: "fx-split" },
          h(
            "div",
            { className: "fx-split-main" },
            h("h1", { className: "mb-4 flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
            h(FactoryTabs, { active: "usage" }),
            h("div", { className: "space-y-6" }, h(DevicePanelView, { data: devicesData, now })),
          ),
          h("aside", { "aria-label": "AI 사용량 계기판", className: "fx-split-side" }, h(UsageDashView, { stats: st.stats, now, error: null })),
        ),
      ),
    );
  if (st.studio) {
    const studioTools = toolkitView.rows.map((r) => ({ id: r.id, desc: r.desc, purpose: r.purpose, purposeSource: r.purposeSource, enabled: r.enabled })).concat([{ id: "setup-runtime", desc: "작업 PC 런타임 설치(사람이 직접 실행)", purpose: "common", purposeSource: "guess", enabled: true }]);
    const studioApps = [
      { appSlug: "saessak-hub", title: "새싹 허브", stack: "flutter", status: "done", finishedAt: "2026-10-12T01:02:03.000Z", done: true },
      { appSlug: "memo-app", title: "메모", stack: "flutter", status: "running", finishedAt: null, done: false },
      { appSlug: "timer-app", title: "타이머", stack: "flutter", status: "done", finishedAt: "2026-10-11T08:30:00.000Z", done: true },
    ];

    return h(
      AdminLayout,
      null,
      h(
        "div",
        { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" },
        h(
          "div",
          { className: "fx-split-main" },
          h("h1", { className: "mb-4 flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
          h(FactoryTabs, { active: "studio" }),
          h(StudioWorkbench, {
            apps: studioApps,
            tools: studioTools,
            toolsReported: true,
            initialPicked: "saessak-hub",
            initial: { "saessak-hub": { kind: "game", tools: ["pixel-generate", "pixel-slice"], studioUrl: "https://hub.example.com/studio/" }, "timer-app": { kind: "app", tools: [] } },
          }),
        ),
      ),
    );
  }
  if (st.toolkit)
    return h(
      AdminLayout,
      null,
      h(
        "div",
        { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" },
        h(
          "div",
          { className: "fx-split-main" },
          h("h1", { className: "mb-4 flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
          h(FactoryTabs, { active: "settings" }),
          h(ToolkitToolsView, { view: toolkitView, usage: toolkitUsage }),
          h("div", { className: "mt-6" }, h(ToolboxView, { toolbox: toolboxData.live })),
        ),
      ),
    );
  if (st.toolbox)
    return h(
      AdminLayout,
      null,
      h(
        "div",
        { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" },
        h(
          "div",
          { className: "fx-split-main" },
          h("h1", { className: "mb-4 flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
          h(FactoryTabs, { active: "settings" }),
          h(ToolboxView, { toolbox: toolboxData[st.toolbox] }),
          st.toolbox === "failed" ? h("h2", { className: "fx-label mt-10 mb-3" }, "── 패널 전체 실패 ──") : null,
          st.toolbox === "failed" ? h(ToolboxView, { toolbox: null }) : null,
        ),
      ),
    );

  return h(
    AdminLayout,
    null,
    h(
      "div",
      { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" },
      h("div", { className: "fx-split" }, leftWork(state), h("aside", { "aria-label": "AI 사용량 계기판", className: "fx-split-side" }, h(UsageDashView, { stats: st.stats, now, error: st.error ?? null }))),
      h("h2", { className: "fx-label mt-10 mb-3" }, `── 상태 견본: ${st.title} (패널 펼침) ──`),
      h("div", { className: "max-w-md" }, h(UsageDashView, { stats: st.stats, now, error: st.error ?? null, open: true })),
    ),
  );
}

// 승인 줄(FactoryOverview 의 할 일 줄과 같은 모양)에 실제 모델 선택 부품을 끼운다. Codex 일감은 부품이 스스로 숨는다
function modelApprove() {
  const defaults = { model: "sonnet", engine: "claude" };
  const rows = [
    { id: "j1", chip: "📱 새 앱", title: "timer-app 기획서", sub: "timer-app · flutter · 2026. 10. 13. 오후 12:39:00", engine: "claude", value: "opus" },
    { id: "t1", chip: "🛠 정비 지시", title: "통제실 모델 선택", sub: "채팅 · 2026. 10. 13. 오후 12:40:00", engine: "claude", value: "default" },
    { id: "j2", chip: "📦 출시 준비", title: "memo-app 첫 출시", sub: "memo-app · flutter · Codex 일감(모델 선택 없음)", engine: "codex", value: "default" },
  ];
  const jobs = [
    ["timer-app", "Claude Code", "claude", "opus", "제작 중"],
    ["memo-app", "Codex", "codex", null, "완료"],
    ["weather", "Claude Code", "claude", null, "실패"],
  ];

  return h(
    "div",
    { className: "fx-wide mx-auto w-full px-4 py-4 sm:py-8" },
    h(
      "div",
      { className: "fx-split-main" },
      h("h1", { className: "mb-4 flex items-center gap-2 text-2xl font-bold sm:text-3xl" }, h("span", { "aria-hidden": true, className: "fx-dot fx-run" }), "앱 공장 통제실"),
      h(FactoryTabs, { active: "status" }),
      h(
        Card,
        { className: "mb-6", "data-title": "todo · 승인·배포" },
        h(
          CardBody,
          { className: "space-y-3" },
          h("div", { className: "flex items-center gap-2 font-semibold" }, h(fx.StatusDot, { tone: "warn" }), "승인·배포 할 일", h("span", { className: "font-mono" }, "(3)")),
          ...rows.map((r) =>
            h(
              "div",
              { key: r.id, className: "flex flex-col gap-2 rounded-lg border border-default-200 p-2 sm:flex-row sm:items-center sm:justify-between" },
              h("div", { className: "min-w-0 text-sm" }, h("div", { className: "flex flex-wrap items-center gap-2" }, h(heroui.Chip, { size: "sm", variant: "flat", color: "primary" }, r.chip), h("span", { className: "font-medium" }, r.title), h("span", { className: "font-mono text-xs text-default-500" }, r.sub))),
              h(
                "div",
                { className: "flex flex-wrap items-center gap-2", "data-approve": r.id },
                h(modelSelect.default, { engine: r.engine, value: r.value, onChange: () => {}, defaults }),
                h(Button, { className: "min-h-11 sm:min-h-0", color: "primary", size: "sm" }, "승인"),
              ),
            ),
          ),
        ),
      ),
      h("h2", { className: "fx-label mt-6 mb-3" }, "── 일감 이력: 모델: ○○ (Codex 는 표시 안 함) ──"),
      h(
        "div",
        { className: "grid gap-2" },
        ...jobs.map(([slug, ai, engine, model, status]) =>
          h(
            "div",
            { key: slug, className: "rounded-lg border border-default-200 p-3" },
            h("div", { className: "font-semibold" }, slug, " · ", status),
            h("div", { className: "mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-default-500" }, h("span", { className: "font-mono" }, slug), h("span", null, ai), h(modelSelect.ModelTag, { engine, model })),
          ),
        ),
      ),
      h("h2", { className: "fx-label mt-6 mb-3" }, "── [설정] 주사용 AI · 기본 모델 ──"),
      h(DefaultAiSettings),
    ),
  );
}

// ── CSS: 저장소 Tailwind 설정 + 관리자 CSS ──
fs.mkdirSync(out, { recursive: true });
const bodies = Object.fromEntries(Object.keys(STATES).map((k) => [k, renderToStaticMarkup(page(k))]));
// 펼침 칸은 닫힌 채로 그려지니, 도구 상세 견본은 앞 두 개를 연다
bodies.toolkit = bodies.toolkit.replace(/<details>/g, (m, i, all) => (all.slice(0, i).split("<details>").length <= 2 ? "<details open>" : m));
// 인계 기록 견본은 앞의 두 칸만 펼쳐서 찍는다(세 번째는 접힌 기본 모습)
bodies.handoff = bodies.handoff.replace(/<details /g, (m, i, all) => (all.slice(0, i).split("<details ").length <= 2 ? "<details open=\"\" " : m));
bodies.maintLog = bodies.maintLog.replace(/<details /g, "<details open=\"\" ");
const scan = path.join(out, "admin-ui-scan.html");
fs.writeFileSync(scan, Object.values(bodies).join("\n")); // Tailwind 가 쓰인 클래스를 찾을 수 있게 먼저 쓴다
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const entry = [
  '@import "tailwindcss" source(none);',
  `@config "${path.join(repo, "tailwind.config.js").replaceAll("\\", "/")}";`,
  `@source "${scan.replaceAll("\\", "/")}";`,
].join("\n");
const { css } = await postcss([tailwind()]).process(entry, { from: path.join(repo, "styles", "admin-ui-preview.css") });
const files = {};
for (const [k, body] of Object.entries(bodies)) {
  files[k] = path.join(out, `admin-ui-${k}.html`);
  fs.writeFileSync(
    files[k],
    `<!doctype html><html lang="ko" class="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>관리자 HUD 미리보기 · ${STATES[k].title}</title><style>${css}</style><style>${read("app/admin/admin-ui.css")}</style>
<style>body{margin:0;background:#fff;font-family:Inter,system-ui,"Malgun Gothic",sans-serif}</style></head>
<body><main>${body}</main></body></html>`,
  );
  console.log(`미리보기: ${files[k]}`);
}
fs.rmSync(scan, { force: true });

// ── 스크린샷(선택) ──
if (process.argv.includes("--shot")) {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const browser = candidates.find((p) => fs.existsSync(p));
  if (!browser) {
    console.log("Chrome/Edge 를 찾지 못해 스크린샷은 건너뜀 (CHROME_PATH 로 지정 가능)");
  } else {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "admin-ui-shot-"));
    const only = process.argv.find((a) => a.startsWith("--state="))?.slice(8);
    try {
      for (const [k, file] of Object.entries(files)) {
        if (only && only !== k) continue;
        // 헤드리스 창은 최소 폭이 있어(약 500px) 360px 은 iframe 에 넣어 찍는다
        const mobile = path.join(out, `admin-ui-${k}-360.html`);
        const [tall, tallMobile] = STATES[k].statusMix ? [4200, 7600] : STATES[k].history ? [3600, 6400] : STATES[k].users === "many" ? [2000, 5200] : STATES[k].toolbox ? [2600, 5600] : STATES[k].devices ? [2400, 6200] : [2200, 3600]; // 이력 패널·카드 목록이 들어가 길다
        fs.writeFileSync(mobile, `<!doctype html><body style="margin:0;background:#333"><iframe src="${path.basename(file)}" width="360" height="${tallMobile}" style="border:0;display:block"></iframe></body>`);
        for (const [w, size, target] of [["1440", `1440,${tall}`, file], ["1024", `1024,${tall}`, file], ["360", `600,${tallMobile}`, mobile]]) {
          const png = path.join(out, `admin-ui-${k}-${w}.png`);
          const r = spawnSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${profile}`, `--window-size=${size}`, `--screenshot=${png}`, pathToFileURL(target).href], { timeout: 60_000 });
          console.log(r.status === 0 && fs.existsSync(png) ? `스크린샷: ${png}` : `스크린샷 실패(${k} ${w})`);
        }
      }
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
}
