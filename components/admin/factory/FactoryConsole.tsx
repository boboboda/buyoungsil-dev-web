// components/admin/factory/FactoryConsole.tsx
// 앱 공장 통제실 본체: 머리말 + 상단 탭 + 탭 내용. 기능 컴포넌트는 그대로 두고 위치만 탭으로 나눈다.
// [현황] 진행 중 띠·승인·배포 할 일·정비/감독 한 줄 요약·이력  [일감] 앱 일감·수정 지시  [정비] 공장 정비 대화·대기열·로그  [감독] 감독 프로그램 상세·감독 로그  [스튜디오] 프로젝트 종류·도구 연결
// [출시] 출시 패키지  [설정] 도구함 한눈에 보기·AI·도구·텔레그램·PC 토큰·키·배포 계정·프로젝트 연결·작업 규칙  [사용량] 장비 상태(서버1·서버2·메인PC)·Claude 세션·토큰
// 넓은 화면은 왼쪽 작업 영역(약 7) + 오른쪽 AI 사용량 계기판(약 3, 따라옴), 좁은 화면은 계기판이 위에 접혀 있다.
import { Card, CardBody } from "@heroui/react";

import AppProjectLinks from "./AppProjectLinks";
import ProjectConnections from "./ProjectConnections";
import AppChecksSettings from "./AppChecksSettings";
import LoopGuardSettings from "./LoopGuardSettings";
import AppSlotsSettings, { ApprovalWaitSettings, ConductorSettings, ParallelPerAppSettings, UpdateBundleSettings } from "./AppSlotsSettings";
import DefaultAiSettings from "./DefaultAiSettings";
import DevicePanel from "./DevicePanel";
import FactoryControl from "./FactoryControl";
import FactoryOverview, { type HistoryTab } from "./FactoryOverview";
import FactoryTabs from "./FactoryTabs";
import { FACTORY_TABS, type FactoryTab } from "./consoleTabs";
import MaintenancePanel from "./MaintenancePanel";
import ReleaseAccounts from "./ReleaseAccounts";
import ResourceAlertStrip from "./RunningPanel";
import ReleasePanel from "./ReleasePanel";
import AppQueue from "./AppQueue";
import RevisionSender from "./RevisionSender";
import SecretEntries from "./SecretEntries";
import SecretNames from "./SecretNames";
import { SettingsGroup } from "./SettingsCard";
import StudioPanel from "./StudioPanel";
import StudioAccessKeys from "./StudioAccessKeys";
import SupervisorControl from "./SupervisorControl";
import SupervisorLog from "./SupervisorLog";
import SupervisorSummary from "./SupervisorSummary";
import TelegramSetup from "./TelegramSetup";
import UsageDash from "./UsageDash";
import ToolBrokerSettings from "./ToolBrokerSettings";
import ToolboxPanel from "./ToolboxPanel";
import ToolkitToolsPanel from "./ToolkitToolsPanel";
import ToolManifestPanel from "./ToolManifestPanel";
import WorkerTokens from "./WorkerTokens";
import WorkRules from "./WorkRules";

import ClaudeStatusView from "@/components/admin/claude/ClaudeStatusView";
import NovelPanel from "@/components/admin/novel/NovelPanel";
import { type ClaudeStats, getClaudeStats } from "@/lib/claude-status/stats";

const INTRO: Record<FactoryTab, string> = {
  status: "기획서를 승인하면 내 PC의 감독 프로그램이 가져가서 앱을 만들어요",
  jobs: "앱 일감 목록·상세, 완성된 앱 수정 지시",
  maint: "공장 정비: 정비 대화 목록, 지시 대기열, 지시별 진행 로그, 커밋·서버 배포 상태",
  supervisor: "내 PC 감독 프로그램: 연결·버전·자동 업데이트·재시작·일시 정지, 그리고 감독 로그(업데이트·재시작·장비 보고·오류)",
  studio: "스튜디오: 프로젝트(앱)를 게임/앱으로 나누고, 프로젝트마다 쓸 도구와 스튜디오 주소를 연결해 저장해요. 일감 보내기는 다음 단계예요.",
  release:
    "앱마다 배포 계정을 고르고 종류(첫 출시·스토어 자료 수정·프로젝트 업데이트)를 골라 승인하면, 스토어 문구·데이터 보안·콘텐츠 등급·체크리스트·개인정보처리방침 초안과 AAB 정보가 여기 모여요. 최초 업로드와 프로덕션 출시는 사람이 Play Console 에서 해요.",
  settings:
    "주제별로 묶여 있어요: 실행·동시성 / 병렬화·지휘자 / 검사 / 도구 / 알림·연결 / 키·계정 / 프로젝트·규칙",
  usage:
    "서버1·서버2·메인PC 장비 상태와 배포된 프로젝트 수, 내 PC의 Claude Code가 지금 하는 일과 토큰 사용량 (앱별 사용량은 [일감] 상세에 있어요)",
  novels:
    "소설 공장: PC의 글 제작 실행기가 보고한 작품과 화를 읽고 설정 승인·화 승인·수정 요청을 해요. 승인한 화는 예약 시각에 /novel 에 공개돼요.",
};

// 오른쪽 계기판 첫 값. DB 를 못 읽어도 통제실은 뜨고 계기판만 '수신 대기'
async function readStats() {
  try {
    return await getClaudeStats();
  } catch (e) {
    console.error("[claude-status] 계기판 첫 값 조회 실패:", e);

    return null;
  }
}

export default async function FactoryConsole({
  tab,
  jobId = null,
  historyTab,
  threadId = null,
}: {
  tab: FactoryTab;
  jobId?: string | null; // ?job=<id> → [일감] 탭에서 그 일감 상세를 바로 연다
  historyTab?: HistoryTab; // ?history=jobs → [현황] 이력의 그 탭을 바로 연다
  threadId?: string | null; // ?thread=<id> → [정비] 탭에서 그 정비 대화를 바로 연다
}) {
  const label = FACTORY_TABS.find((t) => t.key === tab)?.label;
  const stats = await readStats();

  return (
    <div className="fx-wide mx-auto w-full px-4 py-4 sm:py-8">
      <div className="fx-split">
        <div className="fx-split-main">
          <header className="mb-4">
            <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
              <span aria-hidden className="fx-dot fx-run" />앱 공장 통제실
              <span className="sr-only"> — {label}</span>
            </h1>
            <p className="mt-2 text-sm fx-muted">{INTRO[tab]}</p>
          </header>

          <FactoryTabs active={tab} />

          {tab === "status" && (
            <div className="space-y-4">
              <ResourceAlertStrip />
              <FactoryOverview initialTab={historyTab}>
                <SupervisorSummary />
              </FactoryOverview>
            </div>
          )}

          {tab === "jobs" && (
            <div className="space-y-6">
              <AppQueue />
              <FactoryControl initialJobId={jobId} />
              <RevisionSender />
            </div>
          )}

          {tab === "maint" && (
            <Card>
              <CardBody>
                <MaintenancePanel initialThreadId={threadId} />
              </CardBody>
            </Card>
          )}

          {tab === "supervisor" && (
            <div className="space-y-6">
              <SupervisorControl />
              <SupervisorLog />
            </div>
          )}

          {tab === "studio" && <StudioPanel />}

          {tab === "release" && <ReleasePanel />}

          {tab === "settings" && (
            <div className="space-y-8">
              <SettingsGroup hint="새 지시에 쓸 AI와 동시에 돌릴 앱 수" id="settings-run" title="실행·동시성">
                <DefaultAiSettings />
                <AppSlotsSettings />
                <LoopGuardSettings />
              </SettingsGroup>
              <SettingsGroup hint="새 버전을 받을 때 일감을 잠깐 멈췄다가 이어서 하는 방식" id="settings-update" title="감독 업데이트">
                <UpdateBundleSettings />
              </SettingsGroup>
              <SettingsGroup hint="같은 앱의 수정 일감을 같이 돌리는 방식" id="settings-parallel" title="병렬화·지휘자">
                <ParallelPerAppSettings />
                <ApprovalWaitSettings />
                <ConductorSettings />
              </SettingsGroup>
              <SettingsGroup hint="합치기·최종 점검 때 더 돌릴 명령" id="settings-checks" title="검사">
                <AppChecksSettings />
              </SettingsGroup>
              <SettingsGroup hint="도구 목록·접근 설정·요청 중계" id="settings-tools" title="도구">
                <ToolkitToolsPanel />
                <ToolManifestPanel />
                <ToolboxPanel />
                <ToolBrokerSettings />
              </SettingsGroup>
              <SettingsGroup hint="텔레그램 알림과 작업 PC 연결 토큰" id="settings-notify" title="알림·연결">
                <TelegramSetup />
                <WorkerTokens />
              </SettingsGroup>
              <SettingsGroup hint="외부 서비스 키, Studio 접근 키, 배포 계정" id="settings-keys" title="키·계정">
                <SecretEntries />
                <SecretNames />
                <StudioAccessKeys />
                <ReleaseAccounts />
              </SettingsGroup>
              <SettingsGroup hint="홈페이지 프로젝트 연결, 앱별 배포·저장소 연결, Claude 작업 규칙" id="settings-project" title="프로젝트·규칙">
                <AppProjectLinks />
                <ProjectConnections />
                <WorkRules />
              </SettingsGroup>
            </div>
          )}

          {tab === "usage" && (
            <div className="space-y-6">
              <DevicePanel />
              <UsageTab initial={stats} />
            </div>
          )}

          {tab === "novels" && <NovelPanel />}
        </div>

        <aside aria-label="AI 사용량 계기판" className="fx-split-side">
          <UsageDash initial={stats} />
        </aside>
      </div>
    </div>
  );
}

// 옛 /admin/claude 화면(상세: 세션·14일 그래프·이벤트): 첫 값은 계기판과 같이 읽은 값, 이후는 ClaudeStatusView 가 5초마다 갱신
function UsageTab({ initial }: { initial: ClaudeStats | null }) {
  const error = initial
    ? null
    : "작업 현황 DB를 읽지 못했습니다. claude_sessions 테이블이 만들어졌는지(마이그레이션) 확인하세요.";

  return error ? (
    <Card>
      <CardBody>
        <p className="text-sm text-default-500">{error}</p>
      </CardBody>
    </Card>
  ) : (
    <ClaudeStatusView initial={initial} />
  );
}
