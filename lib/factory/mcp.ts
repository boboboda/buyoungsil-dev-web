// 앱 공장용 커넥터 도구. lib/drafts/mcp.ts 의 MCP 서버에 합쳐서 쓴다. (같은 커넥터, 같은 토큰)
// Claude 채팅은 여기서 지시를 "등록"만 한다. 승인은 관리자가 통제실에서 한다.
import { PURPOSE_LABELS } from "@/lib/factory/projectLinks";
import { readLinksView } from "@/lib/factory/projectLinksDb";
import { inspectPlan, readManifestsView } from "@/lib/factory/toolManifestDb";
import { limitLines } from "@/lib/factory/toolManifest";
import { createCard, getCard, listCardHistory, listCards, resolveCardForEnqueue, updateCard, type CardView } from "@/lib/factory/cardsDb";
import { DEFAULT_CARD_NAME } from "@/lib/factory/cards";
import { createHash } from "crypto";

import prisma from "@/lib/prisma";
import { isAiEngine } from "@/lib/factory/ai";
import { getDefaultAiEngine } from "@/lib/factory/settings";
import { knownSecretNames } from "@/lib/factory/secretEntries";
import { notifyJobEvent } from "@/lib/factory/telegram";
import { LAB_KIND, LAB_SLUG, labResultView } from "@/lib/factory/lab";
import { runSupervisorAction, SUPERVISOR_ACTIONS, supervisorSnapshot, type SupervisorAction } from "@/lib/factory/supervisor";
import type { InboxTier } from "@/lib/factory/inbox"; // 타입만. 값은 getInbox 안에서 불러온다(다른 시험이 이 파일을 가볍게 불러올 수 있게)
import {
  OVERWRITE_KINDS,
  RELEASE_KIND_LABELS,
  REVIEW_KINDS,
  buildReleasePlan,
  isReleaseKind,
  normalizeUpdateItems,
  releaseOverview,
  stageLabel,
  readinessProblem,
  updateItemsText,
} from "@/lib/factory/release";
import { readStoreAssets, savePromoVideoUrl } from "@/lib/factory/storeAssets";
import { NOT_TARGET_MESSAGE, isStoreTarget } from "@/lib/factory/storeTarget";
import { appQueue, allAppQueues, numberQueue } from "@/lib/factory/queue";
import { enqueueToolJob } from "@/lib/factory/toolJobsDb";
import { TOOL_KIND, toolResultView } from "@/lib/factory/toolJobs";
import { MAX_GROUP_SIZE, newGroupId, PARALLEL_KIND, SOURCE_MANUAL } from "@/lib/factory/parallel";
import {
  ACTIVE_STATUSES,
  adminAction,
  APP_SLUG_RE,
  ID_RE,
  JOB_KINDS,
  JOB_STATUSES,
  MAX_PENDING_JOBS,
  MAX_PLAN,
  MIN_PLAN,
  STACK_LABELS,
  STACKS,
} from "@/lib/factory/jobs";

// 채팅(커넥터)에서는 배포할 수 없으므로 자동 배포 켜고 끄기(auto_deploy_on/off)는 통제실에서만 한다.
const CONNECTOR_SUPERVISOR_ACTIONS = SUPERVISOR_ACTIONS.filter((a) => a !== "auto_deploy_on" && a !== "auto_deploy_off");

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

const json = (v: unknown) => text(JSON.stringify(v, null, 1));

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// 제어문자를 지우고 길이를 자른다.
function clean(v: unknown, max: number, keepNewlines = false): string {
  if (typeof v !== "string") return "";
  const re = keepNewlines
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
    : /[\u0000-\u001f\u007f]/g;

  return v.replace(re, "").trim().slice(0, max);
}

export const FACTORY_INSTRUCTIONS =
  " 앱 공장: 확정된 앱 기획서는 enqueue_app_job 으로 등록해요(승인은 관리자가 통제실 /admin/factory 에서 해요). " +
  "등록 전에 list_factory_jobs 로 같은 앱 이름이 이미 있는지, list_secret_names 로 쓸 수 있는 키 이름을 확인하세요. " +
  "이미 만든 앱을 고칠 때는 kind=revision 으로, 반드시 기존 앱 이름(appSlug)과 고칠 내용만 보내세요. 같은 앱에 지시를 여러 개 쌓아 둘 수 있고, 앱마다 한 번에 하나씩 priority(큰 값 먼저)→승인 순→등록 순으로 실행해요(응답에 대기 순서가 나와요. 순서는 set_job_priority 로 바꿔요). "
  + "서로 겹치지 않는 수정 지시는 enqueue_app_job 의 parallelWith(같은 앱 다른 대기 일감 id)로 같은 묶음에 넣어 같이 돌릴 수 있어요(묶음은 모두 승인돼야 시작, 승인은 관리자가 통제실 [묶음 승인]으로 한 번에). "
  + "관리자가 통제실에서 직접 보낸 수정 지시는 source 가 '통제실'로 나와요. 결과는 get_factory_job(includePlan=true)으로 읽고 사용자와 의논하세요. "
  + "작업 PC 감독 프로그램은 supervisor_control 로 봐요: action=status(연결·버전·일시 정지·자동 업데이트·진행/대기 일감 수), "
  + "update_now(GitHub main 의 새 감독 프로그램 코드를 지금 받게 함. 15초~1분 뒤 status 의 commit 으로 확인), "
  + "restart(감독 프로그램 재시작: 진행 중 작업이 끝난 뒤 껐다 켜며 윈도우 PATH 를 새로 읽음. 1분쯤 뒤 status 의 시작시각·재시작 으로 확인), pause/resume(새 일감 받기 멈춤/재개), "
  + "auto_update_on/off. 사용자가 요청한 경우에만 상태를 바꾸세요. "
  + "출시: get_release_status 로 앱별 출시 상태·배포 계정·패키지(스토어 문구·체크리스트)·AAB 정보·테스트 일정을 보고, "
  + "enqueue_release_job(appSlug, kind) 으로 출시 일감을 등록해요(kind: first=첫 출시, store=스토어 자료 수정, project=프로젝트 업데이트. 지시문은 서버가 배포 계정 정보로 만들고, 승인은 관리자). "
  + "출시 준비는 enqueue_app_job 이 아니라 이 도구로만 보내요. 앱별 git 원격·배포 서버·도메인·컨테이너는 get_project_links 로 읽어요(읽기 전용). 결과물 카드(프로젝트마다 이런 결과물을 이렇게 만든다는 뜻: 도구·방법·옵션·참고 규칙)는 list_cards·get_card 로 읽고 create_card·update_card 로 만들고 고쳐요(설명서 한계 검사를 통과해야 저장, 키는 저장하지 않고 방법에 맞게 자동). 카드로 일을 시키려면 enqueue_app_job 의 card 에 카드 이름을 적어요. 게임 툴킷 도구의 방법·필요한 키·한계는 list_tools 와 get_tool_manifest 로 읽어요(읽기 전용, 지시문이 설명서 한계를 넘으면 등록이 거절되고 필요한 키는 자동으로 들어가요). 결과는 get_factory_job 과 get_release_status 로 확인하세요. "
  + "실험: 도구·방식이 되는지 확인하는 테스트는 앱 수정 일감이 아니라 enqueue_lab_job(title, planMarkdown, aiEngine?, keep?)으로 보내요(앱 이름 없이, 작업 PC 의 실험 폴더에서 무인 실행. 승인은 관리자). "
  + "끝나면 get_factory_job 의 실험_결과에 올라온 이미지·mp4 주소(몇 시간 뒤 만료)와 report.md 본문이 나와요. 이미지 주소를 열어 직접 보고 검수할 수 있어요. "
  + "그림 만들기(결과물 카드): AI 에이전트 없이 카드로 바로 만들려면 앱 수정 일감 대신 generate_with_card(appSlug, card, subject, count, extra?)를 쓰세요. 도구 일감 id 를 돌려주고, get_factory_job 의 도구_결과에 상태·비용·만든 그림 주소가 나와요(비용 한도를 넘으면 확인 대기로 멈춰요). "
  + "통제실 할 일 목록은 get_inbox 로 읽어요(읽기 전용: 막힘·다시 시작 필요·키 부족 > 승인 대기·비용 한도 확인·묶음 승인·스튜디오 검수 > 업데이트 상태. 처리는 관리자가 통제실·텔레그램에서 해요).";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const FACTORY_TOOLS = [
  {
    name: "list_factory_jobs",
    description:
      "앱 공장의 지시 목록(최근 순)을 돌려줍니다. 기획서 본문은 빼고 앱 이름(appSlug), 표시 이름, 종류, 상태, 단계, 요약만 담아요. " +
      "새 앱을 등록하기 전에 같은 이름이 이미 있는지, 수정 지시를 보내기 전에 어떤 앱이 완성돼 있는지(status=done) 확인하는 용도예요. " +
      "실행 중·승인됨·승인 대기 지시에는 앱별 대기 순서(대기순서: 0=지금 실행 중, 1부터 다음 차례)와 priority 가 붙어요.",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: {
          type: "string",
          description: "이 앱 이름의 지시만 보기 (선택)",
        },
        status: {
          type: "string",
          enum: [...JOB_STATUSES],
          description: "이 상태만 보기 (선택)",
        },
        kind: {
          type: "string",
          enum: [...JOB_KINDS],
          description: "이 종류만 보기 (선택). 실험 일감만 보려면 lab",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "개수 (기본 20)",
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_factory_job",
    description:
      "지시 하나의 상세를 돌려줍니다: 상태, 완료 요약, 실패 이유, 최근 로그, 스크린샷 주소. includePlan=true 면 등록했던 기획서 본문도 같이 줘요. " +
      "도구 일감(kind=tool)이면 도구_결과(상태·비용·만든 그림 주소)도 같이 줘요. 실험(lab) 일감이면 실험_결과(올라온 이미지·mp4·report.md 파일 주소와 report.md 본문, 올리지 못한 파일 목록, 기존 저장소 변경 사후 검사)도 같이 줘요. " +
      "끝난 일감이면 변경_내용(바뀐 파일 수·추가/삭제 줄 수·파일별 줄 수, 키·비밀 파일은 이름만)도 같이 줘요. 계획 먼저 승인을 쓴 일감이면 계획_단계(상태와 계획)도 줘요. " +
      "수정 지시를 쓰기 전에 원래 기획과 결과 요약을 확인할 때 쓰세요.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "지시 id (list_factory_jobs 의 id)",
        },
        includePlan: {
          type: "boolean",
          description: "기획서 본문 포함 (기본 false)",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_inbox",
    description:
      "통제실 [현황] '할 일' 목록을 읽어요(읽기 전용). 우선순위순: 막힘·실패(막힘, 다시 시작 필요, 키 부족) > 승인(일감·정비 지시·묶음·비용 한도 확인·스튜디오 검수 대기·서버 배포) > 정보(업데이트로 일시 중지, 업데이트 묶는 중). " +
      "항목마다 종류·제목·설명과 사람이 어디서 무엇을 누르면 되는지(처리)가 나와요. 처리는 이 도구로 못 하고 관리자가 통제실·텔레그램에서 해요. 값(키·토큰)은 나오지 않아요.",
    inputSchema: {
      type: "object",
      properties: {
        tier: { type: "string", enum: ["blocked", "approval", "info"], description: "이 단계만 보기 (선택). blocked=막힘·실패, approval=승인, info=정보" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_usage_by_block",
    description:
      "블록별 비용·시간 통계를 읽어요(읽기 전용). by 로 묶는 기준(agent=에이전트 종류, app=앱, card=결과물 카드, tool=도구·방법)과 period 로 기간(day=최근 24시간, week=최근 7일, month=최근 30일)을 골라요. " +
      "묶음마다 실행 횟수(성공·실패·막힘), 토큰(입력+출력+캐시 생성), 대기·실행·일시 중지 시간, 다시 맞추기 횟수, 외부 비용(PixelLab 호출 수)이 나와요. appSlug 로 한 앱만 볼 수도 있어요. 키·토큰 값은 나오지 않아요.",
    inputSchema: {
      type: "object",
      properties: {
        by: { type: "string", enum: ["agent", "app", "card", "tool"], description: "묶는 기준 (기본 agent)" },
        period: { type: "string", enum: ["day", "week", "month"], description: "기간 (기본 week)" },
        appSlug: { type: "string", description: "이 앱만 보기 (선택)" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "list_secret_names",
    description:
      "앱 기획서에서 쓸 수 있는 키 이름과 설명 목록입니다. 값은 이 서버에 없고 작업 PC에만 있어요. " +
      "enqueue_app_job 의 requiredSecrets 에는 여기 나온 이름만 쓸 수 있어요.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "enqueue_app_job",
    description:
      "확정된 앱 기획서(또는 수정 내용)를 앱 공장 대기열에 등록합니다. 등록만 되고 '승인 대기' 상태로 쌓이며, 관리자가 통제실에서 승인해야 제작이 시작돼요. " +
      "규칙: appSlug 는 앱 폴더 이름(영문 소문자·숫자·하이픈 3~40자)이고 이후 수정 지시에서도 똑같이 써야 해요. " +
      "kind=new 는 아직 없는 앱만, kind=revision 은 이미 완성(done)된 앱만 가능해요. 같은 앱에 승인 대기·승인됨·실행 중인 지시가 있어도 계속 쌓을 수 있어요: " +
      "앱마다 실행은 한 번에 1개이고, 승인된 지시는 priority(큰 값 먼저)→승인 시각→등록 시각 순으로 하나씩 실행해요. 응답에 이 앱의 대기 순서(몇 번째)가 나와요. " +
      "서로 겹치지 않는 수정 지시 여러 개를 같은 앱에서 동시에 돌리고 싶으면 parallelWith 에 같은 앱의 다른 대기 일감 id 를 주세요(같은 묶음으로 등록, 묶음은 모두 승인돼야 시작). " +
      "또 같은 앱에 승인 대기 수정 일감이 있으면 방금 승인된 일감도 잠깐(기본 60초, 설정) 다른 승인을 기다릴 수 있어요. " +
      "수정 지시가 이어받는 이전 지시(parentJobId)는 비우면 실행을 시작할 때 그 앱의 가장 최근 완료 지시로 정해져서, 앞 지시의 결과를 이어받아요. " +
      "planMarkdown 은 새 앱이면 기획서 전체, 수정이면 '고칠 내용만' 적으세요(원본 기획서를 다시 보내지 마세요). " +
      "측정·조사·시뮬레이션처럼 코드를 바꾸지 않는 일은 실험 일감으로 보내세요(enqueue_lab_job).",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: {
          type: "string",
          description: "앱 폴더 이름. 예: one-tiny-frame",
        },
        title: {
          type: "string",
          description: "화면에 표시할 앱 이름 (80자 이내)",
        },
        kind: {
          type: "string",
          enum: ["new", "revision"],
          description: "new=새 앱(기본), revision=완성된 앱 수정",
        },
        planMarkdown: {
          type: "string",
          description: `기획서(새 앱) 또는 고칠 내용(수정). ${MIN_PLAN}~${MAX_PLAN}자, 마크다운`,
        },
        aiEngine: { type: "string", enum: ["claude", "codex"], description: "작업 AI. 생략하면 홈페이지의 주사용 AI" },
        stack: {
          type: "string",
          enum: [...STACKS],
          description:
            "앱 종류 (새 앱만, 기본 flutter). 수정 지시는 원래 앱의 종류를 그대로 써요. " +
            STACKS.map((k) => `${k}=${STACK_LABELS[k]}`).join(" / "),
        },
        requiredSecrets: {
          type: "array",
          items: { type: "string" },
          description:
            "필요한 키 이름 (list_secret_names 에 있는 것만, 최대 10개)",
        },
        parentJobId: {
          type: "string",
          description:
            "수정 지시일 때 이어받을 이전 지시 id. 비우면 그 앱의 가장 최근 완료 지시로 이어요.",
        },
        priority: {
          type: "integer",
          minimum: -100,
          maximum: 100,
          description: "우선순위(클수록 먼저, 기본 0)",
        },
        card: {
          type: "string",
          description: "결과물 카드 이름 또는 id (선택, 그 앱의 카드: list_cards). 주면 일감이 그 카드의 도구·방법·옵션·참고 규칙으로 실행되고, 만든 그림에 카드와 판 번호가 붙어요. 카드 방법에 필요한 키는 requiredSecrets 에 자동으로 들어가요. 새 앱·출시 일감엔 쓸 수 없어요.",
        },
        parallelWith: {
          type: "string",
          description:
            "같이 돌릴 일감 id (선택, kind=revision 만). 같은 앱의 시작 전(승인 대기·승인됨) 수정 일감 id 를 주면 등록과 동시에 그 일감과 같은 묶음(사람이 정한 묶음)으로 넣어요. " +
            "서로 다른 파일을 고치는 지시만 묶으세요. 묶음은 안의 일감이 모두 승인돼야 같이 시작하고, 일부만 승인된 동안은 시작하지 않아요(관리자가 통제실 대기열 [묶음 승인]으로 한 번에 승인).",
        },
        source: {
          type: "string",
          description: "어느 기획 대화에서 온 건지 짧게 (선택, 100자 이내)",
        },
      },
      required: ["appSlug", "title", "planMarkdown"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "set_job_priority",
    description:
      "아직 시작하지 않은(승인 대기·승인됨) 지시의 우선순위를 바꿉니다. 같은 앱 안에서 클수록 먼저 실행해요(-100~100, 기본 0, 같으면 먼저 승인한 순). " +
      "승인은 하지 않아요(승인은 관리자). 응답에 바뀐 대기 순서가 나와요. 실행 중이거나 끝난 지시는 바꿀 수 없어요.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "지시 id (list_factory_jobs 의 id)" },
        priority: { type: "integer", minimum: -100, maximum: 100, description: "새 우선순위" },
      },
      required: ["id", "priority"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "enqueue_lab_job",
    description:
      "실험(lab) 일감을 등록합니다. 도구·방식이 되는지 확인하는 테스트 전용이에요(앱 수정 일감으로 돌리면 권한이 맞지 않아 막혀요). " +
      "앱 이름 없이 등록하고, 승인 대기 상태로 쌓여요(승인은 관리자가 통제실·텔레그램에서). 작업 PC 의 실험 폴더(lab\<일감id>)에서 승인 없이 끝까지 돌아가요: " +
      "공장 안 다른 폴더는 읽기·복사만, 실험 폴더에만 쓰기·실행, 인터넷 허용. 기존 폴더 수정·삭제와 커밋·푸시는 금지이고, 끝난 뒤 저장소가 바뀌었으면 실패로 표시해요. " +
      "결과로 보고 싶은 이미지(png/webp/gif)·영상(mp4)은 실험 폴더의 outputs\ 에 저장하라고 planMarkdown 에 적고, 요약은 report.md 에 쓰게 하세요. " +
      "실험은 동시에 1개만 돌아요. 끝나면 get_factory_job 의 실험_결과로 결과를 보세요. 좋은 결과면 그때 정식 일감(앱 수정·정비)으로 붙여요. " +
      "측정·조사·시뮬레이션처럼 코드를 바꾸지 않는 일은 실험 일감으로 보내세요.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "실험 이름 (80자 이내)" },
        planMarkdown: {
          type: "string",
          description: `실험 내용: 무엇을 해 보고 어떤 결과(이미지·영상·report.md)를 남길지. ${MIN_PLAN}~${MAX_PLAN}자, 마크다운`,
        },
        aiEngine: { type: "string", enum: ["claude", "codex"], description: "작업 AI. 생략하면 홈페이지의 주사용 AI" },
        card: { type: "string", description: "결과물 카드 이름 또는 id (선택). 주면 그 카드로 만든 pixel-art 설정(card-settings.json)과 카드 정보를 실험 폴더에 내려 줘요. 이름이면 cardApp 도 같이 주세요" },
        cardApp: { type: "string", description: "card 가 이름일 때 그 카드가 있는 프로젝트(앱) 이름" },
        keep: { type: "boolean", description: "false 면 '지워도 되는 실험'으로 표시해요(자동 삭제는 안 해요. 폴더는 통제실 [폴더 지우기]로 지움). 기본 true" },
        source: { type: "string", description: "어느 기획 대화에서 온 건지 짧게 (선택, 100자 이내)" },
      },
      required: ["title", "planMarkdown"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "generate_with_card",
    description:
      "결과물 카드로 AI 없이 바로 그림을 만드는 '도구 일감'을 등록합니다(2-3). 작업 PC 의 감독 프로그램이 도구 중계로 카드의 도구·방법·옵션을 그대로 실행하고(임시 폴더, 앱 폴더는 열지 않음), " +
      "만든 그림을 그림 저장소에 '후보'로 올려요(카드 id·판 번호·참고 그림·비용 기록). 앱 수정 일감(enqueue_app_job)보다 가볍고 권한·경로 문제가 적어요. " +
      "승인은 기존과 같이 관리자가 통제실·텔레그램에서 해요(설정에서 '비용 한도 안이면 자동 승인'을 켠 경우만 자동). PixelLab 비용 한도(일·월)를 넘으면 확인 대기(needs_confirmation)로 멈추고 통제실 할 일과 텔레그램으로 알려요. " +
      "결과로 도구 일감 id 를 돌려주고, get_factory_job(id) 의 도구_결과에서 상태·비용·만든 그림 주소를 볼 수 있어요. 카드는 list_cards 로 확인하세요. 앱 데이터를 바꾸는 일(배치 등)은 이 도구가 아니라 enqueue_app_job 으로.",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: { type: "string", description: "카드가 있는 프로젝트(앱) 이름. 예: one-tiny-frame" },
        card: { type: "string", description: "결과물 카드 이름 또는 id (list_cards)" },
        subject: { type: "string", description: "대상 이름 하나. 예: 싹이 (subjects 와 둘 중 하나)" },
        subjects: { type: "array", items: { type: "string" }, maxItems: 8, description: "대상 이름 여러 개(최대 8). 대상마다 count 장씩 만들어요" },
        count: { type: "integer", minimum: 1, maximum: 8, description: "대상마다 만들 장 수 (기본 1). 한 일감은 전체 16장까지" },
        extra: { type: "string", description: "추가 지시 (선택, 500자 이내). 그릴 내용에 덧붙어요" },
        refArtIds: { type: "array", items: { type: "string" }, maxItems: 4, description: "참고로 고를 승인 그림 id (선택, 최대 4장, 그림 저장소의 id)" },
        source: { type: "string", description: "어느 기획 대화에서 온 건지 짧게 (선택, 100자 이내)" },
      },
      required: ["appSlug", "card"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "get_release_status",
    description:
      "출시 대상(통제실 출시 패키지 목록에 넣은 앱)인 완성된 앱들의 출시 상태를 돌려줍니다(대상이 아닌 앱은 대상아님 에 이름·종류만): 출시 단계(준비중/패키지 생성/검토/비공개 테스트/출시), 배포 계정(A/B)과 키 준비 상태(경로·PC 에 있는지만), " +
      "패키지 이름, 최초 업로드 여부, 비공개 테스트 시작·완료 예정일, 출시 패키지 요약(스토어 제목·짧은 설명·체크리스트 남은 할 일·찾은 SDK), AAB 정보(경로·크기·버전, 파일은 PC 에만), " +
      "최근 출시 일감의 종류·현재 단계와 실패했으면 마지막 오류 요약(실패 단계·이유), 연결된 홈페이지 프로젝트(홈페이지프로젝트: 연결 여부·제목). 키 값·비밀번호는 담지 않아요.",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: { type: "string", description: "이 앱만 보기 (선택)" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_project_links",
    description:
      "앱별 배포·저장소 연결 정보를 읽어요(읽기 전용): 앱 폴더·종류·기본 브랜치, git 원격 목록(이름·호스트·용도 백업/배포/GitHub), 배포 서버(serverpc=서버1 / serverpc2=서버2 / none), 배포 방법, 도메인, 도커 컨테이너 이름과 서버에서 찾았는지, 연결된 서비스, 비고, 경고(원격 없음·컨테이너 못 찾음·git 폴더 아님). " +
      "git 원격·브랜치와 서버 컨테이너 이름은 작업 PC 가 하루 1회(또는 통제실 [새로 읽기]) 읽어 보낸 값이고, 도메인·배포 방법 같은 값은 사람이 통제실에서 입력한 값이에요. 비밀값은 담지 않아요.",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: { type: "string", description: "이 앱만 보기 (선택)" },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "list_tools",
    description:
      "작업 PC 의 게임 툴킷 도구 목록과 요약을 읽어요(읽기 전용): 도구 이름·하는 일·방법(엔진) 이름·방법마다 필요한 키가 준비됐는지(키 이름이 등록돼 있는지만, 값은 없음)·설명서 출처(file=툴킷 설명서 / fallback=도구함 정보로 만든 최소 설명서)와 툴킷 판(커밋). " +
      "자세한 한계·입력 항목은 get_tool_manifest 로 읽어요.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: "get_tool_manifest",
    description:
      "도구 하나의 설명서를 읽어요(읽기 전용): 방법별 필요한 키 이름과 준비 상태, 네트워크 여부, 한계(크기·프레임·호출 수·제한 시간), 비용 단위, 입력 항목(이름·종류·필수·범위·고를 값), 결과 형식. " +
      "enqueue_app_job 은 지시문이 이 설명서의 한계를 넘으면(예: 크기 256 > 최대 128) 등록을 거절하고, 지시문이 부르는 방법에 필요한 키는 requiredSecrets 에 자동으로 넣어요. 키 값은 담지 않아요.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "도구 이름 (list_tools 의 name). 예: pixel-art" } },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "list_cards",
    description:
      "프로젝트의 결과물 카드 목록을 읽어요(읽기 전용). 카드 = 이름 붙은 '이런 결과물을 이렇게 만든다': 도구·방법·옵션(설명서 입력 항목)·참고 규칙(기본 그림 고정·같은 대상/종류 승인 그림·최대 장 수)·판 번호. 방법에 맞는 키 이름과 등록 여부(값은 없음)와 경고도 나와요.",
    inputSchema: {
      type: "object",
      properties: { appSlug: { type: "string", description: "프로젝트(앱) 이름. 예: one-tiny-frame" } },
      required: ["appSlug"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_card",
    description: "결과물 카드 한 장과 최근 변경 이력(판 번호·누가 통제실/채팅/정비·바뀐 곳)을 읽어요(읽기 전용).",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: { type: "string", description: "프로젝트(앱) 이름" },
        card: { type: "string", description: "카드 이름 또는 id" },
      },
      required: ["appSlug", "card"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: "create_card",
    description:
      "프로젝트에 결과물 카드를 만들어요. 도구 설명서 검사를 통과해야 저장돼요(방법 이름, 옵션 형식, 크기·프레임 수 한계). 키는 저장하지 않고 방법에 맞는 키가 설명서에서 자동으로 정해져요. 이력에는 '채팅'으로 남아요. " +
      "카드로 일감을 시키는 건 enqueue_app_job 의 card 에 카드 이름을 적어서 해요(카드로 생성 요청하는 전용 도구는 따로 나와요).",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: { type: "string", description: "프로젝트(앱) 이름" },
        name: { type: "string", description: "카드 이름 (한국어, 40자 이하, 프로젝트 안에서 겹치지 않게). 예: 싹이 단독 짤" },
        description: { type: "string", description: "카드 설명 (300자 이하)" },
        tool: { type: "string", description: "도구 이름 (list_tools 의 name, 기본 pixel-art)" },
        method: { type: "string", description: "도구 방법 id (get_tool_manifest 의 방법 id. 예: pixellab). 그 방법에 필요한 키는 도구 설명서에서 자동으로 정해져요(키는 카드에 저장하지 않아요)" },
        options: { type: "object", description: "설명서 입력 항목 값 { kind, size, frames, preset, background(transparent|scene) } 중 필요한 것. 설명서 한계(크기·프레임 수)를 넘으면 저장되지 않아요" },
        refRules: {
          type: "object",
          description: "참고 규칙 { pinDefault(기본 그림 1순위 고정), defaultArtId(승인된 그림 id), sameSubject(같은 대상 승인 그림), sameKind(같은 종류 승인 그림), maxRefs(0~4, 고정 그림 포함 최대 장 수) }",
        },
        settings: { type: "object", description: "(고급) 카드가 갖는 pixel-art 프로젝트 설정 묶음 { spec, style, motion, cost, aliases … }. 비우려면 {}" },
        enabled: { type: "boolean", description: "false 면 카드를 꺼요(일감이 부를 수 없음)" },
      },
      required: ["appSlug", "name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "update_card",
    description:
      "결과물 카드를 고쳐요(보낸 칸만 바뀌고 나머지는 그대로). 설명서 검사를 통과해야 저장되고, 저장하면 판 번호가 올라가요(이력에 '채팅'으로 남음). 새로 시작하는 일감부터 적용돼요. 기본 카드의 설정 묶음(settings)은 프로젝트 도구 설정을 따라가요.",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: { type: "string", description: "프로젝트(앱) 이름" },
        card: { type: "string", description: "고칠 카드 이름 또는 id" },
        name: { type: "string", description: "새 카드 이름 (바꿀 때만)" },
        description: { type: "string", description: "카드 설명 (300자 이하)" },
        tool: { type: "string", description: "도구 이름 (list_tools 의 name, 기본 pixel-art)" },
        method: { type: "string", description: "도구 방법 id (get_tool_manifest 의 방법 id. 예: pixellab). 그 방법에 필요한 키는 도구 설명서에서 자동으로 정해져요(키는 카드에 저장하지 않아요)" },
        options: { type: "object", description: "설명서 입력 항목 값 { kind, size, frames, preset, background(transparent|scene) } 중 필요한 것. 설명서 한계(크기·프레임 수)를 넘으면 저장되지 않아요" },
        refRules: {
          type: "object",
          description: "참고 규칙 { pinDefault(기본 그림 1순위 고정), defaultArtId(승인된 그림 id), sameSubject(같은 대상 승인 그림), sameKind(같은 종류 승인 그림), maxRefs(0~4, 고정 그림 포함 최대 장 수) }",
        },
        settings: { type: "object", description: "(고급) 카드가 갖는 pixel-art 프로젝트 설정 묶음 { spec, style, motion, cost, aliases … }. 비우려면 {}" },
        enabled: { type: "boolean", description: "false 면 카드를 꺼요(일감이 부를 수 없음)" },
        note: { type: "string", description: "이력에 남길 한 줄 (100자 이하, 선택)" },
      },
      required: ["appSlug", "card"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "enqueue_release_job",
    description:
      "완성된 앱에 출시 일감을 등록합니다(승인 대기, 승인은 관리자). 지시문은 서버가 그 앱의 배포 계정 정보로 종류(kind)별로 만들어요. " +
      "first(기본, 첫 출시): 키 준비, 개인정보처리방침 초안, 스토어 문구(한/영), 데이터 보안·콘텐츠 등급 답안, 체크리스트, 서명 AAB, 홈페이지 프로젝트 빈 칸 채우기, " +
      "(최초 업로드 뒤 서비스 계정 키가 있으면) 감독 프로그램이 업데이트 AAB 를 비공개 테스트 트랙에 업로드. " +
      "first 와 store 는 자료를 만든 뒤 '검토 대기'에서 관리자가 통제실에서 확인해야([이대로 진행]) Play 업로드·홈페이지 반영·완료가 돼요. " +
      "store(스토어 수정): 고른 항목(이미지·문구·영상 링크·개인정보처리방침)을 만들고, 승인 뒤 조건이 맞으면 Play 등록정보·이미지 업로드, (overwriteProject 면) 홈페이지 프로젝트도 덮어쓰기. " +
      "update(앱 업데이트, 기능 추가): updateText(필수) 대로 코드 수정·시험 → 버전 올림 → 서명 AAB → 최초 업로드한 앱이면 비공개 테스트 트랙 업로드(프로덕션 아님). 최초 AAB 업로드 완료가 체크된 앱만. " +
      "project(프로젝트 업데이트)는 예전 종류(호환용). 출시 대상(통제실 출시 패키지 목록에 넣은 앱)만 받아요. 먼저 통제실 출시 패키지에서 배포 계정을 골라 둬야 해요. " +
      "끝나면 get_factory_job 과 get_release_status 로 확인하세요.",
    inputSchema: {
      type: "object",
      properties: {
        appSlug: { type: "string", description: "완성된 앱 이름 (list_factory_jobs 의 appSlug)" },
        aiEngine: { type: "string", enum: ["claude", "codex"], description: "작업 AI. 생략하면 홈페이지의 주사용 AI" },
        kind: {
          type: "string",
          enum: ["first", "store", "update", "project", "apk"],
          description: "first=첫 출시(기본) | store=스토어 수정 | update=앱 업데이트(기능 추가) | project=프로젝트 업데이트(예전, 호환용) | apk=시험용 APK(등록된 서명 키로 release APK 를 만들어 통제실에서 내려받기, Play 는 안 건드림. Flutter 만)",
        },
        overwriteProject: {
          type: "boolean",
          description: "store/project 만: true 면 홈페이지 프로젝트의 기존 값(설명·대표 이미지·앱 링크·기술 스택)도 덮어써요(개인정보처리방침 제외). 기본 false(빈 칸만 채움). 사용자가 원할 때만",
        },
        updateItems: {
          type: "array",
          items: { type: "string", enum: ["images", "listing", "video", "videoLink", "privacy", "description", "cover"] },
          description:
            "store/project 만: 갱신할 항목(고른 것만 만들고·올리고·반영). store = images(아이콘·대표 이미지·폰 스크린샷), listing(제목·짧은/긴 설명), video(홍보 영상 링크), privacy(개인정보처리방침 갱신: 홈페이지 방침 덮어쓰기). " +
            "project = description(설명·기술 스택), cover(대표 이미지), privacy. 빼면 store=images·listing·video, project=description·cover(방침은 안 건드림). 빈 배열은 안 돼요",
        },
        videoUrl: { type: "string", description: "store + updateItems 에 videoLink(홍보 영상 링크만 반영)일 때: YouTube 링크(youtube.com/watch 또는 youtu.be). 저장된 링크가 있으면 생략 가능" },
        updateText: { type: "string", description: "update 만(필수): 무엇을 추가·수정할지(수정 지시처럼 구체적으로)" },
        versionName: { type: "string", description: "update 만(선택): 새 버전 이름(예: 1.3.0). 비우면 patch +1, 버전 코드는 늘 +1" },
        releaseNotes: { type: "string", description: "update 만(선택): 출시 노트(What's new, 500자 이내). 비우면 공장이 업데이트 내용으로 초안" },
        source: { type: "string", description: "어느 대화에서 온 건지 짧게 (선택, 100자 이내)" },
      },
      required: ["appSlug"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "supervisor_control",
    description:
      "작업 PC 의 감독 프로그램 상태를 보거나 정해진 명령을 보냅니다. 명령은 홈페이지에 신호로 남고, 감독 프로그램이 15초마다 확인할 때 가져가요. " +
      "status=연결 여부·현재 버전(commit)·최근 업데이트 소식·일시 정지/자동 업데이트 상태·진행/대기 일감 수, " +
      "update_now=GitHub main 의 새 감독 프로그램 코드를 지금 확인해 받게 함(돌고 있는 일감이 있으면 끝난 뒤. 새 버전이면 30초쯤 뒤 다시 켜짐), " +
      "restart=감독 프로그램 재시작(새 일감 받기를 멈추고 진행 중 작업이 끝나면 종료 → 실행기가 30초쯤 뒤 다시 켬. 윈도우 레지스트리 PATH 를 새로 읽어 새로 설치한 ffmpeg 등을 찾음), " +
      "pause=새 일감 받기 멈춤(진행 중 작업은 끝까지), resume=다시 받기, auto_update_on/off=10분마다 하는 자동 업데이트 켜고 끄기. " +
      "상태를 바꾸는 명령은 사용자가 요청했을 때만 쓰세요.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...CONNECTOR_SUPERVISOR_ACTIONS],
          description: "status | update_now | restart | pause | resume | auto_update_on | auto_update_off",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

const FACTORY_NAMES = new Set(FACTORY_TOOLS.map((t) => t.name));

export const isFactoryTool = (name: string) => FACTORY_NAMES.has(name);

export async function callFactoryTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "list_factory_jobs":
      return listJobs(args);
    case "get_factory_job":
      return getJob(args);
    case "get_inbox":
      return getInbox(args);
    case "get_usage_by_block":
      return getUsageByBlock(args);
    case "list_secret_names":
      return listSecretNames();
    case "enqueue_app_job":
      // 출시 준비는 서버가 지시문을 만드는 enqueue_release_job 으로만
      if (args.kind === "release") return text("출시 준비 일감은 enqueue_release_job(appSlug) 으로 보내세요.", true);
      return enqueue(args);
    case "set_job_priority":
      return setJobPriority(args);
    case "enqueue_lab_job":
      return enqueueLabJob(args);
    case "generate_with_card":
      return generateWithCard(args);
    case "supervisor_control":
      return supervisorControl(args);
    case "get_release_status":
      return getReleaseStatus(args);
    case "get_project_links":
      return getProjectLinks(args);
    case "list_tools":
      return listTools();
    case "get_tool_manifest":
      return getToolManifest(args);
    case "list_cards":
      return listCardsTool(args);
    case "get_card":
      return getCardTool(args);
    case "create_card":
      return createCardTool(args);
    case "update_card":
      return updateCardTool(args);
    case "enqueue_release_job":
      return enqueueReleaseJob(args);
    default:
      return text(`알 수 없는 도구예요: ${name}`, true);
  }
}

// 스토어 자료 결과 요약(단계별 상태·Play 업로드). 영상은 경로·크기·길이만
function storeSummary(v: unknown) {
  const s = readStoreAssets(v);

  if (!s) return null;

  return {
    시각: s.at,
    단계: Object.fromEntries(Object.entries(s.stages ?? {}).map(([k, x]) => [stageLabel(k), x ? `${x.status}${x.note ? `: ${x.note.slice(0, 200)}` : ""}` : null])),
    이미지: Object.keys(s.images ?? {}),
    영상: s.video,
    Play업로드: s.upload,
    AAB업로드: s.aabUpload,
  };
}

// 출시 상태. 키 값은 없다(경로·이름·존재 여부만). 패키지는 요약만(전문은 통제실 출시 패키지 화면).
// 도구 설명서(읽기 전용): 목록 / 하나
async function listTools(): Promise<ToolResult> {
  const view = await readManifestsView();

  if (!view.tools.length) return text("아직 작업 PC 가 보낸 도구 설명서가 없어요(감독 프로그램이 시작할 때 보내요).", true);

  return json({
    툴킷판: view.commit || "(읽지 못함)",
    받은시각: view.reportedAt,
    도구: view.tools.map((t) => ({
      name: t.name,
      이름: t.label,
      설명: t.description,
      출처: t.source,
      방법: t.methods.map((m) => ({ id: m.id, 이름: m.label, 필요한키: m.secretStates.map((s) => `${s.name}(${s.ready ? "등록됨" : "없음"})`), 준비: m.ready })),
    })),
  });
}

async function getToolManifest(args: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const view = await readManifestsView();
  const t = view.tools.find((x) => x.name === name);

  if (!t) return text(`${name || "(이름 없음)"} 설명서가 없어요. list_tools 로 이름을 확인하세요.`, true);

  return json({
    툴킷판: view.commit || "(읽지 못함)",
    받은시각: view.reportedAt,
    name: t.name,
    이름: t.label,
    설명: t.description,
    출처: t.source,
    설명서버전: t.version,
    방법: t.methods.map((m) => ({
      id: m.id,
      이름: m.label,
      필요한키: m.secretStates.map((s) => ({ name: s.name, 등록됨: s.ready })),
      네트워크: m.network,
      한계: limitLines(m),
      한계원본: m.limits,
      비용: m.cost ?? null,
      메모: m.notes ?? null,
    })),
    입력: t.inputs,
    결과: t.outputs,
  });
}

// ───────── 결과물 카드(2-2) ─────────

const CARD_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

function cardJson(c: CardView) {
  return {
    id: c.id,
    이름: c.name,
    설명: c.description,
    도구: c.tool,
    방법: c.method || "(설정의 기본 방식)",
    옵션: c.options,
    참고규칙: c.refRules,
    설정묶음: c.settings ? Object.keys(c.settings).filter((k) => k !== "version") : [],
    필요한키: c.secrets.map((s) => `${s.name}(${s.ready ? "등록됨" : "없음"})`),
    판: c.version,
    사용: c.enabled,
    기본카드: c.isDefault,
    기본그림: c.pinnedArt ? { id: c.pinnedArt.id, 대상: c.pinnedArt.subject } : null,
    마지막수정: { 시각: c.updatedAt, 누가: c.updatedBy },
    ...(c.warnings.length ? { 경고: c.warnings } : {}),
  };
}

function cardSlugArg(args: Record<string, unknown>): string | null {
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";

  return CARD_SLUG_RE.test(appSlug) ? appSlug : null;
}

async function listCardsTool(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = cardSlugArg(args);

  if (!appSlug) return text("appSlug(프로젝트 이름)가 필요해요. 예: one-tiny-frame", true);
  const cards = await listCards(appSlug);

  if (!cards.length) return text(`${appSlug} 에는 아직 카드가 없어요. create_card 로 만들 수 있어요.`);

  return json({ 프로젝트: appSlug, 카드: cards.map(cardJson) });
}

async function getCardTool(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = cardSlugArg(args);

  if (!appSlug) return text("appSlug(프로젝트 이름)가 필요해요.", true);
  const card = await getCard(appSlug, args.card);

  if (!card) return text(`${appSlug} 에 그 카드가 없어요. list_cards 로 이름을 확인하세요.`, true);
  const history = await listCardHistory(card.id);

  return json({
    ...cardJson(card),
    설정묶음내용: card.settings,
    이력: history.map((h) => ({ 판: h.version, 누가: h.source, 이름: h.who, 시각: h.createdAt, 메모: h.note, 바뀐곳: h.changed })),
  });
}

/** 커넥터 인자 → 카드 칸(보낸 칸만) */
function cardPatchFrom(args: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};

  for (const k of ["name", "description", "tool", "method", "options", "refRules", "settings", "enabled"]) if (args[k] !== undefined) patch[k] = args[k];

  return patch;
}

async function createCardTool(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = cardSlugArg(args);

  if (!appSlug) return text("appSlug(프로젝트 이름)가 필요해요.", true);
  if (typeof args.name !== "string" || !args.name.trim()) return text("name(카드 이름)이 필요해요.", true);
  const res = await createCard(appSlug, cardPatchFrom(args), "채팅", "채팅(커넥터)");

  if (res.ok === false) return text(`카드를 만들지 못했어요: ${res.errors.join(" / ")}`, true);

  return text(`${res.message} ${res.card.secrets.length ? `필요한 키(설명서 기준): ${res.card.secrets.map((s) => `${s.name}(${s.ready ? "등록됨" : "없음"})`).join(", ")}. ` : ""}카드 id: ${res.card.id}${res.card.warnings.length ? ` / 경고: ${res.card.warnings.join(" ")}` : ""}`);
}

async function updateCardTool(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = cardSlugArg(args);

  if (!appSlug) return text("appSlug(프로젝트 이름)가 필요해요.", true);
  const patch = cardPatchFrom(args);

  if (!Object.keys(patch).length) return text("바꿀 칸(name, description, tool, method, options, refRules, settings, enabled 중)을 하나 이상 보내세요.", true);
  const note = typeof args.note === "string" && args.note.trim() ? clean(args.note, 100) : "수정";
  const res = await updateCard(appSlug, args.card, patch, "채팅", "채팅(커넥터)", note);

  if (res.ok === false) return text(`카드를 저장하지 못했어요: ${res.errors.join(" / ")}`, true);

  return text(`${res.message}${res.card.warnings.length ? ` 경고: ${res.card.warnings.join(" ")}` : ""}`);
}

// 앱별 배포·저장소 연결 정보(읽기 전용)
async function getProjectLinks(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";
  const view = await readLinksView();
  const rows = view.rows.filter((r) => !appSlug || r.appSlug === appSlug);

  if (appSlug && rows.length === 0) return text(`${appSlug} 라는 앱 연결 기록이 없어요.`, true);

  return json({
    읽은시각: view.reportAt,
    낡음: view.reportStale,
    서버컨테이너목록: view.servers,
    경고수: view.warningCount,
    앱: rows.map((r) => ({
      appSlug: r.appSlug,
      폴더: r.folder,
      git폴더: r.isGit,
      종류: r.stack,
      브랜치: r.branch,
      git원격: r.remotes.map((x) => ({ 이름: x.name, 호스트: x.host, 경로: x.path, 용도: PURPOSE_LABELS[x.purpose] })),
      배포서버: r.deployServer,
      배포방법: r.deployMethod,
      도메인: r.domain,
      컨테이너: r.containerName,
      컨테이너찾음: r.containersFound,
      연결된서비스: r.services,
      비고: r.notes,
      경고: r.warnings.map((w) => w.text),
    })),
  });
}

async function getReleaseStatus(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";
  const o = await releaseOverview();
  const label = (v: string) => o.statuses.find((s) => s.value === v)?.label ?? v;
  // 출시 대상(출시 패키지 목록)인 앱만. 대상이 아닌 앱은 이름·종류만 따로
  const apps = o.apps.filter((a) => a.done && (!appSlug || a.appSlug === appSlug));

  if (appSlug && apps.length === 0) {
    return text(o.otherApps.some((a) => a.appSlug === appSlug) ? `${appSlug}: ${NOT_TARGET_MESSAGE}` : `${appSlug} 라는 완성된 앱이 없어요.`, true);
  }
  const summarize = (pkg: Record<string, unknown> | null) => {
    if (!pkg) return null;
    const listing = (pkg.storeListing ?? {}) as Record<string, { title?: string; shortDescription?: string }>;
    const checklist = Array.isArray(pkg.checklist) ? (pkg.checklist as { item?: string; done?: boolean }[]) : [];

    return {
      스토어제목: Object.fromEntries(Object.entries(listing).map(([k, v]) => [k, v?.title ?? null])),
      짧은설명: Object.fromEntries(Object.entries(listing).map(([k, v]) => [k, v?.shortDescription ?? null])),
      체크리스트: `${checklist.filter((c) => c.done).length}/${checklist.length} 완료`,
      남은할일: checklist.filter((c) => !c.done).map((c) => c.item).slice(0, 15),
      찾은SDK: pkg.sdks ?? null,
      메모: typeof pkg.notes === "string" ? pkg.notes.slice(0, 500) : null,
    };
  };

  return json({
    배포계정: o.accounts.map((a) => {
      const pc = (k: string) => o.pcStatus?.items.find((i) => i.key === `${a.label}.${k}`);

      return {
        계정: a.label,
        이름: a.name,
        비공개테스트필요: a.requiresTesting,
        개발자이름: a.developerName,
        연락이메일: a.contactEmail,
        서명키: a.keystorePath ? (pc("keystore")?.exists ? "PC 에 있음" : pc("keystore") ? "PC 에 없음" : "경로만 등록(PC 확인 전)") : "없음",
        서비스계정키: a.serviceAccountKeyPath ? (pc("serviceAccount")?.exists ? "PC 에 있음" : pc("serviceAccount") ? "PC 에 없음" : "경로만 등록(PC 확인 전)") : "없음",
      };
    }),
    앱: apps.map((a) => ({
      appSlug: a.appSlug,
      이름: a.displayName, // 출시 카드 제목과 같은 앱 이름
      작업이름: a.title,
      종류: a.stack,
      출시상태: label(a.releaseStatus),
      배포계정: o.accounts.find((x) => x.id === a.releaseAccountId)?.label ?? null,
      패키지이름: a.packageName,
      최초업로드완료: a.firstUploadDone,
      비공개테스트: a.testingStartedAt ? { 시작: iso(a.testingStartedAt), 완료예정: iso(a.testingDueAt) } : null,
      진행중일감: a.active,
      최근출시준비일감: a.lastReleaseJob
        ? {
            id: a.lastReleaseJob.id,
            상태: a.lastReleaseJob.status,
            종류: RELEASE_KIND_LABELS[a.lastReleaseJob.releaseKind],
            현재단계: a.lastReleaseJob.status === "running" ? a.lastReleaseJob.phaseLabel : null,
            끝난시각: iso(a.lastReleaseJob.finishedAt),
          }
        : null,
      // 마지막 오류 요약(실패했을 때만). 이유는 서버에서 비밀번호를 가린 값
      마지막오류:
        a.lastReleaseJob?.status === "failed"
          ? {
              실패단계: a.lastReleaseJob.failStageLabel,
              이유: a.lastReleaseJob.failReason?.slice(0, 400) ?? null,
              재시도: "통제실 출시 패키지의 [재시도]로 실패한 단계부터 다시 할 수 있어요",
            }
          : null,
      키: a.key ? { 출처: a.key.source === "custom" ? "앱별 다른 키" : "배포 계정 공용 키", 경로: a.key.path, 별칭: a.key.alias, 비밀번호: a.key.password === "none" ? "미등록" : "등록됨" } : null,
      패키지생성: iso(a.releasePackageAt),
      패키지: summarize(a.releasePackage as Record<string, unknown> | null),
      AAB: a.aab,
      홍보영상링크: a.promoVideoUrl,
      Play업로드: a.playMissing.length ? { 가능: false, 부족한것: a.playMissing } : { 가능: true },
      스토어자료: storeSummary(a.storeAssets),
      // 연결된 홈페이지 프로젝트. 연결이 없으면 출시 일감의 홈페이지 반영·[홈페이지만 반영]이 거절된다(통제실 출시 카드에서 연결)
      홈페이지프로젝트: a.projectId ? { 연결: true, 제목: a.projectTitle } : { 연결: false, 제목: null },
    })),
    ...(appSlug ? {} : { 대상아님: o.otherApps.map((a) => ({ appSlug: a.appSlug, 이름: a.displayName, 종류: a.stack })) }),
  });
}

// 출시 준비 일감 등록. 지시문은 서버가 배포 계정 정보로 만든다(채팅이 쓰지 않음). 승인은 관리자가 통제실/텔레그램에서.
export async function enqueueReleaseJob(args: Record<string, unknown>): Promise<ToolResult> {
  if (args.aiEngine !== undefined && !isAiEngine(args.aiEngine)) return text("작업 AI는 claude 또는 codex만 쓸 수 있어요.", true);
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";

  if (!APP_SLUG_RE.test(appSlug)) return text("appSlug 가 올바르지 않아요.", true);
  // 출시 대상(출시 패키지 목록)인 앱만 출시 일감을 받는다. 아무것도 저장하기 전에 확인한다
  if (!isStoreTarget(await prisma.factoryApp.findUnique({ where: { appSlug }, select: { storeTarget: true } }))) return text(`${appSlug}: ${NOT_TARGET_MESSAGE}`, true);
  if (args.kind !== undefined && !isReleaseKind(args.kind)) return text("kind 는 first, store, update, apk 중 하나예요(project 는 예전 종류).", true);
  const kind = isReleaseKind(args.kind) ? args.kind : "first";
  if (args.overwriteProject !== undefined && typeof args.overwriteProject !== "boolean") return text("overwriteProject 는 true/false 예요.", true);
  // 홈페이지 프로젝트 덮어쓰기(앱 업데이트는 '홈페이지 프로젝트도 반영')는 store/project/update 만(기본 꺼짐)
  const overwriteProject = args.overwriteProject === true && OVERWRITE_KINDS.includes(kind);
  const items = normalizeUpdateItems(kind, args.updateItems);

  if ("message" in items) return text(items.message, true);
  // 앱 업데이트(기능 추가): 업데이트 내용 필수, 버전 이름·출시 노트는 선택
  let updateText = "";
  let versionName: string | null = null;
  let releaseNotes: string | null = null;

  if (kind === "update") {
    updateText = clean(args.updateText, 8000, true);
    if (updateText.length < 10) return text("앱 업데이트는 업데이트 내용(무엇을 추가·수정할지, 10자 이상)이 필요해요.", true);
    versionName = clean(args.versionName, 40) || null;
    if (versionName && !/^\d+(\.\d+){1,3}([-+][0-9A-Za-z.-]+)?$/.test(versionName)) return text("버전 이름은 1.2.3 같은 형식이에요(비우면 patch +1).", true);
    releaseNotes = clean(args.releaseNotes, 500, true) || null;
  }
  // '홍보 영상 링크만 반영': 링크가 있어야 한다(같이 보낸 링크는 먼저 저장)
  const linkOnly = kind === "store" && items.items.includes("videoLink");

  if (linkOnly && args.videoUrl !== undefined && args.videoUrl !== null && args.videoUrl !== "") {
    const saved = await savePromoVideoUrl(appSlug, args.videoUrl);

    if (!saved.ok) return text(saved.message, true);
  }
  const o = await releaseOverview();
  const app = o.apps.find((a) => a.appSlug === appSlug);

  if (!app?.done) return text(`${appSlug} 는 완성된 앱이 아니에요.`, true);
  if (linkOnly && !app.promoVideoUrl) return text("'홍보 영상 링크만 반영'은 YouTube 링크가 필요해요(videoUrl 로 보내거나 카드에서 저장).", true);
  // 링크만 반영이면 만들 자료가 없어 Claude·검토 없이 바로 Play 반영 단계부터
  const linkOnlyJob = linkOnly && items.items.length === 1;
  // 종류별 필요한 준비가 부족하면 등록하지 않는다(출시 카드의 체크 목록과 같다. 예전 종류 project 는 예전처럼)
  const lack = kind === "project" ? null : readinessProblem(app.readiness[kind]);

  if (lack) return text(`${app.displayName}: ${RELEASE_KIND_LABELS[kind]} 준비가 부족해요 — ${lack}`, true);
  if (kind === "update" && !app.firstUploadDone) {
    return text("먼저 첫 출시를 끝내세요(최초 AAB 를 Console 에 올리고 출시 카드에서 '최초 AAB 업로드 완료'를 체크).", true);
  }
  const plan = await buildReleasePlan(appSlug, kind, { overwriteProject, updateItems: items.items, updateText, versionName, releaseNotes });

  if ("message" in plan) return text(plan.message, true);

  return enqueue({
    appSlug,
    title: `${app.displayName} (${RELEASE_KIND_LABELS[kind]}${items.items.length ? `: ${updateItemsText(kind, items.items)}` : ""}${versionName ? ` ${versionName}` : ""})`,
    kind: "release",
    releaseKind: kind,
    overwriteProject,
    updateItems: items.items,
    reviewRequired: REVIEW_KINDS.includes(kind) && !linkOnlyJob,
    resumeFrom: linkOnlyJob ? "upload" : null,
    versionName,
    releaseNotes,
    planMarkdown: plan.plan,
    requiredSecrets: plan.requiredSecrets,
    aiEngine: args.aiEngine,
    source: clean(args.source, 100) || "채팅",
  });
}

async function supervisorControl(args: Record<string, unknown>): Promise<ToolResult> {
  const action = args.action;

  if (typeof action !== "string" || !(CONNECTOR_SUPERVISOR_ACTIONS as readonly string[]).includes(action)) {
    return text(`action 은 ${CONNECTOR_SUPERVISOR_ACTIONS.join(", ")} 중 하나예요.`, true);
  }
  const { message, snapshot: s } = await runSupervisorAction(action as SupervisorAction);

  return json({
    ...(message ? { 결과: message } : {}),
    연결: s.online ? "연결됨" : "응답 없음(PC 꺼짐 또는 감독 프로그램 멈춤)",
    작업PC: s.workerName,
    마지막응답: iso(s.lastSeenAt),
    현재버전: s.commit,
    최근업데이트소식: s.updateNote,
    최근업데이트소식시각: s.updateNoteAt,
    지금업데이트요청대기: s.updateNowRequestedAt,
    시작시각: s.startedAt,
    재시작으로켜짐: s.restartedBoot,
    재시작: s.restartNote,
    배포상태: s.deployNote, // "배포 중 · 재전송 대기 N개" 또는 null
    대기상태: s.drainNote, // 업데이트·배포를 진행 중 일감이 끝나길 기다리는 중이면 문구(정비 중에도 앱 일감은 돈다)
    업데이트일시중지: s.pausedNote, // "업데이트로 일시 중지 N개" 또는 null(새 버전이 켜지면 같은 세션으로 이어 줌)
    업데이트묶기: s.bundleNote, // "업데이트 대기(묶는 중, 남은 n분)" 또는 null
    업데이트묶는시간분: s.updateBundleMin,
    재시작요청대기: s.restartRequestedAt,
    ffmpeg: s.ffmpeg ?? "알 수 없음(예전 감독 프로그램)",
    ffprobe: s.ffprobe ?? "알 수 없음(예전 감독 프로그램)",
    일시정지: !s.enabled,
    자동업데이트: s.autoUpdate,
    정비대기열끝나면자동배포: s.autoDeploy,
    진행중: s.running,
    승인됨_대기열: s.approved,
    승인기다림: s.pending,
  });
}

async function listJobs(args: Record<string, unknown>): Promise<ToolResult> {
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";
  const status = typeof args.status === "string" ? args.status : "";
  const kindArg = typeof args.kind === "string" ? args.kind : "";

  if (status && !(JOB_STATUSES as readonly string[]).includes(status))
    return text("status 값이 올바르지 않아요.", true);
  if (kindArg && !(JOB_KINDS as readonly string[]).includes(kindArg)) return text("kind 값이 올바르지 않아요.", true);

  const limitRaw = typeof args.limit === "number" ? Math.floor(args.limit) : 20;
  const limit = Math.min(
    50,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20),
  );

  const jobs = await prisma.factoryJob.findMany({
    where: { ...(appSlug ? { appSlug } : {}), ...(status ? { status } : {}), ...(kindArg ? { kind: kindArg } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      appSlug: true,
      title: true,
      kind: true,
      stack: true,
      aiEngine: true,
      parentJobId: true,
      status: true,
      phase: true,
      summary: true,
      failReason: true,
      source: true,
      priority: true,
      createdAt: true,
      finishedAt: true,
    },
  });
  // 실행 중·승인됨·승인 대기 지시에는 앱별 대기 순서를 붙인다
  const queues = jobs.some((j) => ["running", "approved", "pending"].includes(j.status)) ? await allAppQueues() : {};
  const place = (j: { id: string; appSlug: string }) => queues[j.appSlug]?.find((q) => q.id === j.id)?.position;

  return json({
    지시: jobs.map((j) => ({
      id: j.id,
      appSlug: j.appSlug,
      title: j.title,
      kind: j.kind,
      stack: j.stack,
      aiEngine: j.aiEngine,
      parentJobId: j.parentJobId,
      status: j.status,
      phase: j.phase,
      summary: j.summary ? j.summary.slice(0, 300) : null,
      failReason: j.failReason ? j.failReason.slice(0, 300) : null,
      source: j.source,
      ...(place(j) !== undefined ? { 대기순서: place(j), priority: j.priority } : {}),
      createdAt: iso(j.createdAt),
      finishedAt: iso(j.finishedAt),
    })),
  });
}

async function getJob(args: Record<string, unknown>): Promise<ToolResult> {
  const id = typeof args.id === "string" ? args.id.trim() : "";

  if (!ID_RE.test(id))
    return text(
      "id 가 올바르지 않아요. list_factory_jobs 의 id 를 쓰세요.",
      true,
    );

  const job = await prisma.factoryJob.findUnique({
    where: { id },
    include: {
      images: { orderBy: { createdAt: "asc" }, take: 30 },
      logs: { orderBy: { id: "desc" }, take: 30 },
    },
  });

  if (!job) return text("없는 지시예요.", true);
  // 변경 내용(5-1): 파일·줄 수 요약만(diff 본문은 통제실 일감 상세에서). 키·비밀 파일은 이름과 숨김 표시만. 계획 먼저 승인을 쓴 일감이면 계획 단계와 계획
  const diff = job.diffInfo ? (await import("@/lib/factory/diffReport").catch(() => null))?.diffSummary(job.diffInfo) : null;
  const labels = job.planFirst ? (await import("@/lib/factory/planLabels").catch(() => null))?.PLAN_LABELS : null;

  return json({
    id: job.id,
    appSlug: job.appSlug,
    aiEngine: job.aiEngine,
    title: job.title,
    kind: job.kind,
    parentJobId: job.parentJobId,
    stack: job.stack,
    requiredSecrets: job.requiredSecrets,
    source: job.source,
    status: job.status,
    phase: job.phase,
    summary: job.summary,
    failReason: job.failReason,
    createdAt: iso(job.createdAt),
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
    스크린샷: job.images.map((i) => ({ label: i.label, url: i.url })),
    최근_로그: [...job.logs]
      .reverse()
      .map((l) => `${iso(l.at)} [${l.level}] ${l.message}`),
    ...(job.kind === LAB_KIND ? { 실험_결과: await labResultView(job.id, job.labResult, { signed: true }) } : {}),
    ...(job.kind === TOOL_KIND ? { 도구_결과: toolResultView(job.toolInput, job.toolResult, job.status, job.cardId) } : {}),
    ...(args.includePlan === true ? { planMarkdown: job.planMarkdown } : {}),
    ...(diff ? { 변경_내용: diff } : {}),
    ...(job.planFirst ? { 계획_단계: { 상태: (labels as Record<string, string> | null | undefined)?.[job.planStatus ?? ""] ?? job.planStatus, 계획: job.planText } } : {}),
  });
}

/** 통제실 '할 일' 목록(읽기 전용): 기존 승인 목록 + 새 항목(막힘·키 부족·묶음 승인·업데이트 상태·스튜디오 검수 대기)을 우선순위순으로 */
async function getInbox(args: Record<string, unknown>): Promise<ToolResult> {
  const tier = args.tier === undefined ? null : typeof args.tier === "string" && ["blocked", "approval", "info"].includes(args.tier) ? (args.tier as InboxTier) : undefined;

  if (tier === undefined) return text("tier 는 blocked, approval, info 중 하나여야 해요.", true);
  const [{ approvalInbox }, { flattenInbox, readInboxItems, TIER_LABEL }] = await Promise.all([import("@/lib/factory/approvals"), import("@/lib/factory/inbox")]);
  const [lists, sup] = await Promise.all([approvalInbox(), supervisorSnapshot().catch(() => null)]);
  const items = await readInboxItems(sup).catch(() => []);
  const flat = flattenInbox(lists, items).filter((i) => !tier || i.tier === tier);

  return json({
    할_일_수: flat.length,
    단계별: { 막힘_실패: flat.filter((i) => i.tier === "blocked").length, 승인: flat.filter((i) => i.tier === "approval").length, 정보: flat.filter((i) => i.tier === "info").length },
    할_일: flat.map((i) => ({ 단계: TIER_LABEL[i.tier], 종류: i.kind, 제목: i.title, ...(i.appSlug ? { 앱: i.appSlug } : {}), 설명: i.detail, 처리: i.how, key: i.key })),
    안내: "읽기 전용이에요. 승인·확인·다시 시작은 관리자가 통제실 [현황] 할 일이나 텔레그램에서 해요.",
  });
}

async function getUsageByBlock(args: Record<string, unknown>): Promise<ToolResult> {
  const { GROUP_BYS, PERIODS, usageText } = await import("@/lib/factory/runStats");
  const by = args.by === undefined ? "agent" : GROUP_BYS.find((g) => g === args.by);
  const period = args.period === undefined ? "week" : PERIODS.find((p) => p === args.period);

  if (!by) return text("by 는 agent, app, card, tool 중 하나여야 해요.", true);
  if (!period) return text("period 는 day, week, month 중 하나여야 해요.", true);
  const appSlug = typeof args.appSlug === "string" && APP_SLUG_RE.test(args.appSlug) ? args.appSlug : undefined;

  if (args.appSlug !== undefined && !appSlug) return text("appSlug 형식이 올바르지 않아요.", true);
  const { readUsageByBlock } = await import("@/lib/factory/runStatsDb");
  const u = await readUsageByBlock(by, period, Date.now(), appSlug);

  return json({
    기준: by,
    기간: period,
    ...(appSlug ? { 앱: appSlug } : {}),
    표: usageText(u),
    묶음: u.rows.map((r) => ({ 이름: r.label, 키: r.key, 횟수: r.runs, 성공: r.success, 실패: r.failed, 막힘: r.blocked, 토큰: r.tokens, 대기초: Math.round(r.waitMs / 1000), 실행초: Math.round(r.runMs / 1000), 중지초: Math.round(r.pausedMs / 1000), 다시맞추기: r.redo, 외부비용: r.externalCost })),
    안내: "읽기 전용이에요. 토큰은 Claude 기준이고 Codex 일감은 토큰이 0으로 잡혀요. 일시 중지는 서버 배포·업데이트로 보고가 멈춘 시간이에요.",
  });
}

async function listSecretNames(): Promise<ToolResult> {
  // 이름 카탈로그 + 통제실에서 등록한 키의 설명 + 작업 PC 가 알려 준 이름(값은 없음)
  const names = await knownSecretNames();

  if (names.length === 0)
    return text(
      "등록된 키 이름이 없어요. 관리자가 통제실에서 먼저 등록해야 해요.",
    );

  return json({
    키_이름: names.map((n) => ({ name: n.name, description: n.description })),
  });
}

type EnqueueFail = { ok: false; message: string };
type EnqueueOk = { ok: true; id: string; message: string };

export async function enqueue(args: Record<string, unknown>): Promise<ToolResult> {
  const r = await enqueueWithId(args);

  return r.isError ? { content: r.content, isError: true } : { content: r.content };
}

/** enqueue 와 같은 검사·저장. 등록되면 일감 id 도 함께 돌려준다(Studio 요청 입구 등 코드에서 부르는 곳용). */
export async function enqueueWithId(args: Record<string, unknown>): Promise<ToolResult & { jobId?: string }> {
  if (args.aiEngine !== undefined && !isAiEngine(args.aiEngine)) return text("작업 AI는 claude 또는 codex만 쓸 수 있어요.", true);
  const aiEngine = isAiEngine(args.aiEngine) ? args.aiEngine : await getDefaultAiEngine();
  const appSlug = typeof args.appSlug === "string" ? args.appSlug.trim() : "";
  const title = clean(args.title, 80);
  const kind = args.kind === undefined ? "new" : args.kind;
  const plan = clean(args.planMarkdown, MAX_PLAN + 1, true);
  const stackArg = args.stack;
  const source = clean(args.source, 100) || null;
  const parentArg =
    typeof args.parentJobId === "string" ? args.parentJobId.trim() : "";

  if (!APP_SLUG_RE.test(appSlug)) {
    return text(
      "appSlug 는 앱 폴더 이름이에요: 영문 소문자·숫자·하이픈, 3~40자, 하이픈으로 시작하거나 끝나면 안 돼요. 예: one-tiny-frame",
      true,
    );
  }
  if (!title) return text("title(표시할 앱 이름)이 필요해요.", true);
  if (appSlug === LAB_SLUG) return text(`${LAB_SLUG} 는 실험 일감 전용 이름이라 앱 이름으로 쓸 수 없어요. 실험은 enqueue_lab_job 으로 보내세요.`, true);
  if (kind !== "new" && kind !== "revision" && kind !== "release")
    return text("kind 는 new, revision, release 중 하나예요.", true);
  if (
    stackArg !== undefined &&
    (typeof stackArg !== "string" ||
      !(STACKS as readonly string[]).includes(stackArg))
  ) {
    return text(`stack 은 ${STACKS.join(", ")} 만 쓸 수 있어요.`, true);
  }
  if (plan.length < MIN_PLAN)
    return text(`planMarkdown 이 너무 짧아요(${MIN_PLAN}자 이상).`, true);
  if (plan.length > MAX_PLAN)
    return text(
      `planMarkdown 이 너무 길어요(${MAX_PLAN}자 이하). 핵심만 줄여서 다시 보내세요.`,
      true,
    );
  if (parentArg && !ID_RE.test(parentArg))
    return text("parentJobId 가 올바르지 않아요.", true);
  if (kind === "new" && parentArg)
    return text("parentJobId 는 kind=revision/release 일 때만 쓸 수 있어요.", true);
  // 같이 돌리기: 같은 앱의 다른 대기(승인 대기·승인됨) 수정 일감 id. 등록과 동시에 같은 묶음(사람이 정한 묶음)으로 넣는다
  if (args.parallelWith !== undefined && (typeof args.parallelWith !== "string" || !ID_RE.test(args.parallelWith.trim())))
    return text("parallelWith 는 같은 앱의 다른 대기 일감 id 예요(list_factory_jobs 의 id).", true);
  const parallelWith = typeof args.parallelWith === "string" ? args.parallelWith.trim() : "";

  if (parallelWith && kind !== PARALLEL_KIND)
    return text("parallelWith 는 kind=revision(수정 지시)일 때만 쓸 수 있어요. 새 앱·출시 일감은 같이 돌릴 수 없어요.", true);

  let priority = 0;

  if (args.priority !== undefined) {
    if (
      typeof args.priority !== "number" ||
      !Number.isInteger(args.priority) ||
      args.priority < -100 ||
      args.priority > 100
    ) {
      return text("priority 는 -100 에서 100 사이 정수예요.", true);
    }
    priority = args.priority;
  }

  let secrets: string[] = [];

  if (args.requiredSecrets !== undefined) {
    if (
      !Array.isArray(args.requiredSecrets) ||
      args.requiredSecrets.some((s) => typeof s !== "string")
    ) {
      return text("requiredSecrets 는 키 이름 문자열 목록이에요.", true);
    }
    secrets = [
      ...new Set((args.requiredSecrets as string[]).map((s) => s.trim())),
    ];
    if (secrets.length > 10)
      return text("requiredSecrets 는 최대 10개예요.", true);
  }
  if (secrets.length > 0) {
    const known = await knownSecretNames();
    const set = new Set(known.map((k) => k.name));
    const unknown = secrets.filter((s) => !set.has(s));

    if (unknown.length > 0) {
      return text(
        `등록되지 않은 키 이름이에요: ${unknown.join(", ")}. list_secret_names 에 있는 이름만 쓸 수 있어요. ` +
          `필요한 키가 목록에 없으면 관리자가 통제실에서 이름을 먼저 추가해야 해요.`,
        true,
      );
    }
  }

  // 결과물 카드(2-2): 카드 이름·id → 그 앱의 켜진 카드. 카드 방법에 필요한 키는 설명서에서 정해 requiredSecrets 에 넣는다(등록된 이름만)
  let cardId: string | null = null;
  const cardKeys: string[] = [];

  if (args.card !== undefined && args.card !== null && args.card !== "") {
    if (typeof args.card !== "string") return text("card 는 카드 이름 또는 id 예요(list_cards).", true);
    if (kind === "release") return text("출시 일감에는 카드를 쓸 수 없어요.", true);
    const found = await resolveCardForEnqueue(appSlug, args.card);

    if (found.ok === false) return text(found.message, true);
    cardId = found.id;
    const registered = new Set((await knownSecretNames()).map((k) => k.name));

    for (const name of found.secrets) {
      if (!secrets.includes(name) && registered.has(name) && secrets.length < 10) {
        secrets.push(name);
        cardKeys.push(name);
      }
    }
  }

  // 도구 설명서(2-1b): 지시문이 설명서의 한계를 넘으면 바로 거절하고, 지시문이 부르는 방법에 필요한 키는 requiredSecrets 에 자동으로 넣는다(등록된 키 이름만)
  const autoSecrets: string[] = [];

  if (kind !== "release") {
    const inspected = await inspectPlan(appSlug, plan).catch(() => null);

    if (inspected?.violations.length) {
      return text(`도구 설명서의 한계를 넘어서 등록하지 않았어요: ${inspected.violations.slice(0, 5).join(" / ")}. 지시문의 값을 고쳐서 다시 보내세요(get_tool_manifest 로 한계를 볼 수 있어요).`, true);
    }
    if (inspected?.autoSecrets.length) {
      const registered = new Set((await knownSecretNames()).map((k) => k.name));

      for (const a of inspected.autoSecrets) {
        if (!secrets.includes(a.name) && registered.has(a.name) && secrets.length < 10) {
          secrets.push(a.name);
          autoSecrets.push(a.name);
        }
      }
    }
  }

  const planHash = createHash("sha256").update(plan).digest("hex");

  // 같은 앱 이름의 동시 등록을 막으려고 앱 이름 단위로 잠근 뒤 검사하고 저장한다.
  const result: EnqueueFail | EnqueueOk = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"factory:" + appSlug}))`;

      const pendingTotal = await tx.factoryJob.count({
        where: { status: "pending" },
      });

      if (pendingTotal >= MAX_PENDING_JOBS) {
        return {
          ok: false,
          message: `승인 대기 중인 지시가 ${MAX_PENDING_JOBS}개예요. 관리자가 정리한 뒤에 다시 등록하세요.`,
        } as EnqueueFail;
      }

      // 같은 앱에 승인 대기·승인됨·실행 중인 지시가 있어도 쌓을 수 있다(앱마다 실행은 1개: 가져갈 때 서버가 지킨다).
      // 같은 내용을 두 번 누른 중복 등록은 막고, 검토 대기(review) 출시 일감이 있으면(검토 중인 자료·AAB 를 PC 에 보존) 막는다.
      const clash = await tx.factoryJob.findFirst({
        where: { appSlug, OR: [{ status: "review" }, { status: { in: [...ACTIVE_STATUSES] }, planHash }] },
        select: { id: true, status: true },
      });

      if (clash) {
        return {
          ok: false,
          message:
            clash.status === "review"
              ? `${appSlug} 에는 검토 대기 중인 출시 일감이 있어요 (id: ${clash.id}). 검토가 끝난 뒤에 다시 등록하세요.`
              : `${appSlug} 에 내용이 똑같은 지시가 이미 있어요 (id: ${clash.id}, 상태: ${clash.status}). 중복 등록이에요.`,
        } as EnqueueFail;
      }

      const done = await tx.factoryJob.findMany({
        where: { appSlug, status: "done" },
        orderBy: { finishedAt: "desc" },
        select: { id: true, title: true, stack: true },
      });

      let parentJobId: string | null = null;
      let parentExplicit = false; // 요청에 parentJobId 를 직접 적었으면 true: 실행 시작 때 부모를 다시 정하지 않는다
      // 새 앱은 고른 종류(기본 flutter), 수정 지시는 원래 앱의 종류를 그대로 쓴다.
      let stack = typeof stackArg === "string" ? stackArg : "flutter";

      if (kind === "new") {
        if (done.length > 0) {
          return {
            ok: false,
            message: `${appSlug} 는 이미 만들어진 앱이에요(${done[0].title}). 고치려면 kind=revision 으로, 새 앱이면 다른 appSlug 를 쓰세요.`,
          } as EnqueueFail;
        }
      } else {
        if (done.length === 0) {
          const known = await tx.factoryJob.findMany({
            where: { status: "done", kind: { not: LAB_KIND } },
            distinct: ["appSlug"],
            select: { appSlug: true, title: true },
            take: 30,
          });
          const list = known.length
            ? known.map((k) => `${k.appSlug}(${k.title})`).join(", ")
            : "아직 없어요";

          return {
            ok: false,
            message: `${appSlug} 라는 완성된 앱이 없어서 수정 지시를 만들 수 없어요. 완성된 앱: ${list}. 앱 이름을 정확히 확인하세요.`,
          } as EnqueueFail;
        }
        if (parentArg) {
          const parent = await tx.factoryJob.findUnique({
            where: { id: parentArg },
            select: { appSlug: true, status: true, stack: true },
          });

          if (!parent)
            return {
              ok: false,
              message: "parentJobId 에 해당하는 지시가 없어요.",
            } as EnqueueFail;
          if (parent.appSlug !== appSlug) {
            return {
              ok: false,
              message: "parentJobId 의 앱 이름이 appSlug 와 달라요.",
            } as EnqueueFail;
          }
          if (parent.status !== "done") {
            return {
              ok: false,
              message: "parentJobId 는 완료(done)된 지시여야 해요.",
            } as EnqueueFail;
          }
          parentJobId = parentArg;
          parentExplicit = true;
          stack = parent.stack;
        } else {
          parentJobId = done[0].id;
          stack = done[0].stack;
        }
        if (typeof stackArg === "string" && stackArg !== stack) {
          return {
            ok: false,
            message: `${appSlug} 는 ${stack} 앱이라 수정 지시도 ${stack} 이에요. stack 을 빼고 다시 보내세요.`,
          } as EnqueueFail;
        }
      }

      // 같이 돌리기: 짝이 될 일감이 같은 앱의 시작 전(승인 대기·승인됨) 수정 일감인지 확인하고, 이미 묶음이 있으면 거기에 합류한다
      let joinGroup: { group: string; targetId: string; existing: boolean } | null = null;

      if (parallelWith) {
        const target = await tx.factoryJob.findUnique({ where: { id: parallelWith }, select: { id: true, appSlug: true, kind: true, status: true, parallelGroup: true } });

        if (!target) return { ok: false, message: "parallelWith 에 해당하는 일감이 없어요." } as EnqueueFail;
        if (target.appSlug !== appSlug) return { ok: false, message: "parallelWith 일감은 같은 앱(appSlug)의 것이어야 해요." } as EnqueueFail;
        if (target.kind !== PARALLEL_KIND) return { ok: false, message: "parallelWith 일감은 수정 지시여야 해요(새 앱·출시·실험은 같이 돌릴 수 없어요)." } as EnqueueFail;
        if (target.status !== "pending" && target.status !== "approved") {
          return { ok: false, message: `parallelWith 일감은 시작 전(승인 대기·승인됨)이어야 해요. 지금 상태: ${target.status}.` } as EnqueueFail;
        }
        const size = target.parallelGroup ? await tx.factoryJob.count({ where: { appSlug, parallelGroup: target.parallelGroup, status: { in: ["pending", "approved", "running"] } } }) : 1;

        if (size + 1 > MAX_GROUP_SIZE) return { ok: false, message: `이 묶음은 이미 ${size}개예요. 한 묶음은 최대 ${MAX_GROUP_SIZE}개까지예요.` } as EnqueueFail;
        joinGroup = { group: target.parallelGroup ?? newGroupId(), targetId: target.id, existing: !!target.parallelGroup };
      }

      const job = await tx.factoryJob.create({
        data: {
          appSlug,
          title,
          kind,
          parentJobId,
          parentExplicit,
          planMarkdown: plan,
          planHash,
          aiEngine,
          stack,
          requiredSecrets: secrets,
          priority,
          source,
          cardId,
          // 출시 일감 종류(enqueueReleaseJob 만 넘긴다. enqueue_app_job 은 kind=release 를 막는다)
          releaseKind: kind === "release" && typeof args.releaseKind === "string" ? args.releaseKind : null,
          overwriteProject: kind === "release" && args.overwriteProject === true,
          // 갱신 항목(enqueueReleaseJob 이 normalizeUpdateItems 로 확인한 값만 넘긴다)
          updateItems: kind === "release" && Array.isArray(args.updateItems) ? (args.updateItems as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 10) : [],
          // 검토 단계·앱 업데이트 입력(enqueueReleaseJob 이 확인한 값만 넘긴다)
          reviewRequired: kind === "release" && args.reviewRequired === true,
          // 출시 일감이 처음부터 시작할 단계(enqueueReleaseJob 의 '링크만 반영'만: upload)
          resumeFrom: kind === "release" && args.resumeFrom === "upload" ? "upload" : null,
          versionName: kind === "release" && typeof args.versionName === "string" ? args.versionName.slice(0, 40) : null,
          releaseNotes: kind === "release" && typeof args.releaseNotes === "string" ? args.releaseNotes.slice(0, 500) : null,
          ...(joinGroup ? { parallelGroup: joinGroup.group, parallelSource: SOURCE_MANUAL } : {}),
        },
        select: { id: true },
      });

      if (joinGroup) {
        // 짝(처음 묶는 경우)도 같은 묶음으로, 이미 있던 묶음의 시작 전 일감은 사람이 정한 묶음으로 바꾼다(지휘자가 건드리지 않게)
        await tx.factoryJob.updateMany({
          where: joinGroup.existing ? { appSlug, parallelGroup: joinGroup.group, status: { in: ["pending", "approved"] } } : { id: joinGroup.targetId, status: { in: ["pending", "approved"] } },
          data: { parallelGroup: joinGroup.group, parallelSource: SOURCE_MANUAL },
        });
      }

      // 이 앱의 대기 순서(실행 중 포함). 같은 트랜잭션에서 읽는다
      const waiting = await tx.factoryJob.findMany({
        where: { appSlug, status: { in: ["running", "approved", "pending"] } },
        select: { id: true, title: true, kind: true, status: true, priority: true, approvedAt: true, createdAt: true },
      });
      const mine = numberQueue(waiting).find((q) => q.id === job.id);
      const ahead = (mine?.position ?? 1) - 1; // 앞에 대기 중인 지시 수(실행 중인 것은 따로 세지 않는다)
      const running = waiting.some((w) => w.status === "running");

      return {
        ok: true,
        id: job.id,
        message:
          `${kind === "new" ? "새 앱" : kind === "release" ? "출시 준비 일감" : "수정 지시"}를 등록했어요 (id: ${job.id}, appSlug: ${appSlug}). ` +
          `승인 대기 상태예요. 관리자가 통제실(/admin/factory)에서 승인하면 대기열에 들어가요. ` +
          (waiting.length > 1
            ? `이 앱의 대기 순서는 ${mine?.position}번째예요(앞에 대기 ${ahead}개${running ? " + 지금 실행 중 1개" : ""}, priority ${priority}). 앱마다 한 번에 하나씩 priority 큰 값 → 승인 순 → 등록 순으로 실행해요.`
            : `이 앱의 대기 순서는 1번째예요(앞에 쌓인 지시 없음).`) +
          (autoSecrets.length ? ` 도구 설명서에 따라 필요한 키를 자동으로 넣었어요: ${autoSecrets.join(", ")}.` : "") +
          (cardId ? ` 결과물 카드로 실행해요(${typeof args.card === "string" ? args.card.slice(0, 40) : cardId}).${cardKeys.length ? ` 카드 방법에 필요한 키를 자동으로 넣었어요: ${cardKeys.join(", ")}.` : ""}` : "") +
          (joinGroup ? ` 일감 ${joinGroup.targetId} 와 같은 묶음(${joinGroup.group})으로 넣었어요. 묶음 안 일감이 모두 승인돼야 같이 돌기 시작해요(관리자가 통제실 대기열의 [묶음 승인]으로 한 번에 승인할 수 있어요).` : ""),
      } as EnqueueOk;
    },
  );

  // 승인 대기 알림. 통제실에서 직접 보낸 지시는 보낸 사람이 이미 아니까 알리지 않는다.
  if (result.ok && source !== "통제실") void notifyJobEvent(result.id, "pending");

  return result.ok ? { ...text(result.message), jobId: result.id } : text(result.message, true);
}

// 아직 시작하지 않은(승인 대기·승인됨) 지시의 우선순위 변경. 승인은 하지 않는다. 응답에 바뀐 대기 순서를 담는다.
async function setJobPriority(args: Record<string, unknown>): Promise<ToolResult> {
  const id = typeof args.id === "string" ? args.id.trim() : "";

  if (!ID_RE.test(id)) return text("id 가 올바르지 않아요. list_factory_jobs 의 id 를 쓰세요.", true);
  const r = await adminAction(id, { action: "set-priority", priority: args.priority });

  if (!r.ok) return text(r.message, true);
  const job = await prisma.factoryJob.findUnique({ where: { id }, select: { appSlug: true } });
  const place = job ? (await appQueue(job.appSlug)).find((q) => q.id === id)?.position : undefined;

  return text(`${r.message}${place !== undefined ? ` 이 앱의 대기 순서는 ${place}번째예요.` : ""}`);
}

// 실험(lab) 일감 등록. 앱 이름 없이(appSlug 는 고정 "lab") 승인 대기로 쌓는다. 같은 내용이 이미 대기·진행 중이면 중복으로 거절한다.
async function generateWithCard(args: Record<string, unknown>): Promise<ToolResult & { jobId?: string }> {
  const source = clean(args.source, 100) || null;
  const r = await enqueueToolJob(args, { source });

  return r.ok ? { ...text(`${r.message}\n끝나면 get_factory_job(${r.id}) 의 도구_결과로 상태·비용·만든 그림 주소를 보세요.`), jobId: r.id } : text(r.message, true);
}

export async function enqueueLabJob(args: Record<string, unknown>): Promise<ToolResult & { jobId?: string }> {
  if (args.aiEngine !== undefined && !isAiEngine(args.aiEngine)) return text("작업 AI는 claude 또는 codex만 쓸 수 있어요.", true);
  const aiEngine = isAiEngine(args.aiEngine) ? args.aiEngine : await getDefaultAiEngine();
  const title = clean(args.title, 80);
  const plan = clean(args.planMarkdown, MAX_PLAN + 1, true);
  const source = clean(args.source, 100) || null;

  if (!title) return text("title(실험 이름)이 필요해요.", true);
  if (args.keep !== undefined && typeof args.keep !== "boolean") return text("keep 은 true/false 예요.", true);
  // 결과물 카드(2-2): 이름이면 cardApp(프로젝트)도 필요하고, id 면 어느 프로젝트 카드든 된다
  let cardId: string | null = null;

  if (args.card !== undefined && args.card !== null && args.card !== "") {
    if (typeof args.card !== "string") return text("card 는 카드 이름 또는 id 예요(list_cards).", true);
    const given = typeof args.cardApp === "string" ? args.cardApp.trim() : "";
    const byId = /^card_[A-Za-z0-9_-]{1,35}$/.test(args.card.trim()) ? await prisma.factoryCard.findUnique({ where: { id: args.card.trim() }, select: { appSlug: true } }) : null;
    const cardApp = given || byId?.appSlug || "";

    if (!APP_SLUG_RE.test(cardApp)) return text("card 가 이름이면 cardApp(카드가 있는 프로젝트 이름)도 같이 보내세요.", true);
    const found = await resolveCardForEnqueue(cardApp, args.card);

    if (found.ok === false) return text(found.message, true);
    cardId = found.id;
  }
  if (plan.length < MIN_PLAN) return text(`planMarkdown 이 너무 짧아요(${MIN_PLAN}자 이상).`, true);
  if (plan.length > MAX_PLAN) return text(`planMarkdown 이 너무 길어요(${MAX_PLAN}자 이하). 핵심만 줄여서 다시 보내세요.`, true);
  const planHash = createHash("sha256").update(plan).digest("hex");

  const result: EnqueueFail | EnqueueOk = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"factory:" + LAB_SLUG}))`;

    const pendingTotal = await tx.factoryJob.count({ where: { status: "pending" } });

    if (pendingTotal >= MAX_PENDING_JOBS) {
      return { ok: false, message: `승인 대기 중인 지시가 ${MAX_PENDING_JOBS}개예요. 관리자가 정리한 뒤에 다시 등록하세요.` } as EnqueueFail;
    }
    const dup = await tx.factoryJob.findFirst({ where: { kind: LAB_KIND, planHash, status: { in: [...ACTIVE_STATUSES] } }, select: { id: true, status: true } });

    if (dup) return { ok: false, message: `같은 내용의 실험이 이미 있어요 (id: ${dup.id}, 상태: ${dup.status}). 중복 등록이에요.` } as EnqueueFail;
    const job = await tx.factoryJob.create({
      data: {
        appSlug: LAB_SLUG,
        title,
        kind: LAB_KIND,
        planMarkdown: plan,
        planHash,
        aiEngine,
        stack: "lab",
        source,
        cardId,
        labResult: args.keep === false ? { keep: false } : undefined,
      },
      select: { id: true },
    });

    return {
      ok: true,
      id: job.id,
      message:
        `실험 일감을 등록했어요 (id: ${job.id}). 승인 대기 상태예요. 관리자가 통제실(/admin/factory)·텔레그램에서 승인하면 작업 PC 의 실험 폴더에서 시작해요. ` +
        `끝나면 get_factory_job(id) 의 실험_결과로 이미지·mp4·report.md 를 보세요. 실험은 동시에 1개만 돌아서 앞 실험이 있으면 기다려요.`,
    } as EnqueueOk;
  });

  if (result.ok && source !== "통제실") void notifyJobEvent(result.id, "pending");

  return result.ok ? { ...text(result.message), jobId: result.id } : text(result.message, true);
}
