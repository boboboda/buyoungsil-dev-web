// lib/factory/maintenance-mcp.ts
// 공장 정비용 커넥터 도구(앱 일감 도구와 따로). 채팅에서 보낸 정비 지시는 관리자 승인(통제실·텔레그램) 뒤에 시작한다.
// 채팅에서는 서버 배포를 할 수 없다(배포는 통제실·텔레그램의 [배포] 버튼).
import { maintenanceOverview, sendMaintenance } from "@/lib/factory/maintenance";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export const MAINTENANCE_INSTRUCTIONS =
  " 공장 정비(공장 자체 = 홈페이지·감독 프로그램 코드를 고치는 일)는 앱 일감과 따로예요: maintenance_list 로 정비 대화 목록을, " +
  "maintenance_get(threadId) 로 대화·결과·배포 상태를 보고, maintenance_send(text, threadId?) 로 지시해요(threadId 를 주면 같은 Claude 세션에 이어서). " +
  "채팅에서 보낸 지시는 관리자가 승인해야 시작하고, 정비가 대기·진행 중이면 새 앱 일감은 멈춰요. 결과는 검사를 통과해야 GitHub 에 올라가고, " +
  "서버 배포는 관리자가 통제실·텔레그램에서 [배포]를 눌러야 해요(채팅에서는 배포 못 함). 앱 만들기·고치기는 enqueue_app_job 을 쓰세요.";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const MAINTENANCE_TOOLS = [
  {
    name: "maintenance_list",
    description: "공장 정비 대화 목록(최근 순): 제목, 상태, 처리 중인 지시, GitHub 에 올린 커밋, 배포 필요·배포 상태. 정비가 대기·진행 중이라 앱 일감이 멈춰 있는지(hold)도 알려 줘요.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ,
  },
  {
    name: "maintenance_get",
    description: "공장 정비 대화 하나: 지시와 Claude 결과, 최근 진행 로그, 배포 상태.",
    inputSchema: {
      type: "object",
      properties: { threadId: { type: "string", description: "maintenance_list 의 id" }, logs: { type: "boolean", description: "진행 로그 포함(기본 false)" } },
      required: ["threadId"],
      additionalProperties: false,
    },
    annotations: READ,
  },
  {
    name: "maintenance_send",
    description:
      "공장 정비 지시를 보냅니다(관리자 승인 뒤 시작). threadId 를 주면 그 정비 대화에 이어서(같은 Claude 세션), 없으면 새 정비를 만들어요. " +
      "홈페이지(Next.js)·감독 프로그램(tools/factory-supervisor) 코드를 고치는 일만 보내세요. 서버 설정(nginx, .env)·PC 환경은 여기서 못 고쳐요.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "지시 내용(5~8000자). 무엇을 왜 고칠지 구체적으로" },
        threadId: { type: "string", description: "이어서 할 정비 id (선택)" },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
];

const NAMES = new Set(MAINTENANCE_TOOLS.map((t) => t.name));

export const isMaintenanceTool = (name: string) => NAMES.has(name);

export async function callMaintenanceTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "maintenance_list") {
    const o = await maintenanceOverview({ limit: 20, withLogs: false });

    return text(
      JSON.stringify(
        {
          새앱일감멈춤: o.hold,
          정비: o.threads.map((t) => ({
            id: t.id,
            제목: t.title,
            상태: t.status,
            처리중지시: t.activeTurn,
            올린커밋: t.pushedCommit,
            배포필요: t.needsDeploy,
            배포: t.deploy,
            갱신: t.updatedAt,
          })),
        },
        null,
        1,
      ),
    );
  }
  if (name === "maintenance_get") {
    const id = typeof args.threadId === "string" ? args.threadId : "";

    if (!ID.test(id)) return text("threadId 가 올바르지 않아요.", true);
    const o = await maintenanceOverview({ threadId: id, withLogs: args.logs === true });
    const t = o.threads[0];

    if (!t) return text("없는 정비예요.", true);

    return text(JSON.stringify({ ...t, messages: t.messages.map((m) => ({ ...m, text: m.text.slice(0, 6000) })) }, null, 1));
  }
  if (name === "maintenance_send") {
    const r = await sendMaintenance({ threadId: args.threadId, text: args.text, source: "채팅" });

    return text(r.message, !r.ok);
  }

  return text(`알 수 없는 도구예요: ${name}`, true);
}
