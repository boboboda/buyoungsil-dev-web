// 초안함용 MCP 서버(Streamable HTTP, 무상태). Claude 커스텀 커넥터가 이 주소로 호출한다.
// 공개(발행) 기능은 없다: 초안을 "대기" 상태로 쌓는 것까지만 할 수 있다.
import prisma from "@/lib/prisma";
import { parseDraftInput } from "@/lib/drafts/validate";

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_PENDING = 100; // 초안함이 이 개수를 넘으면 더 받지 않는다 (폭주 방지)

const STORY_CATEGORIES = ["삽질기", "꿀팁", "일상"];

const INSTRUCTIONS =
  "부영실 개발 홈페이지의 초안함 커넥터예요. save_draft 로 글 초안을 보내면 관리자 초안함에 '대기' 상태로 쌓이고, " +
  "관리자가 분류를 정해 비공개 글로 보내요. 보내기 전에 list_categories 로 실제 섹션/카테고리 이름을 확인하세요.";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(isError ? { isError: true } : {}),
});

export const TOOLS = [
  {
    name: "list_categories",
    description:
      "초안을 어디에 넣을지 고르기 위한 목록을 돌려줍니다: 개발노트 섹션(slug, name), 섹션별 세부 카테고리, 스토리 분류. " +
      "save_draft 의 recommendedSection / recommendedCategory 에는 여기 나온 값을 그대로 쓰세요.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_existing_titles",
    description:
      "이미 쓴 개발노트 제목(최근 80개)과 초안함에 대기 중인 초안 제목을 돌려줍니다. 같은 글감을 중복해서 쓰지 않도록 글감을 고르기 전에 확인하세요.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "save_draft",
    description:
      "글 초안을 초안함에 저장합니다(대기 상태). 공개되지는 않으며, 관리자가 초안함에서 확인하고 보내기/버리기를 결정합니다. " +
      "markdown 본문에는 마크다운(굵게, 목록, 인용, 코드블록 ```언어)을 쓸 수 있고, 초안 머리말(제목/추천 정보)은 본문이 아니라 각 필드에 넣으세요.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "글 제목 (200자 이내)" },
        markdown: { type: "string", description: "글 본문(마크다운)" },
        recommendedTarget: { type: "string", enum: ["note", "story"], description: "추천 구분: note=개발노트, story=스토리" },
        recommendedSection: { type: "string", description: "추천 섹션 (list_categories 의 slug 또는 name). 개발노트일 때" },
        recommendedCategory: {
          type: "string",
          description: "추천 세부 카테고리(개발노트) 또는 스토리 분류(삽질기/꿀팁/일상)",
        },
        level: { type: "string", enum: ["BEGINNER", "INTERMEDIATE", "ADVANCED"], description: "난이도 (기본 BEGINNER)" },
        tags: { type: "array", items: { type: "string" }, description: "태그 (최대 20개)" },
        source: { type: "string", description: "어느 대화/프로젝트에서 나온 글감인지 짧게 (선택)" },
      },
      required: ["title", "markdown"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (name === "list_categories") {
    const [cats, subs] = await Promise.all([
      prisma.noteCategory.findMany({ orderBy: { order: "asc" }, select: { slug: true, name: true, platform: true } }),
      prisma.noteSubCategory.findMany({ orderBy: { order: "asc" }, select: { mainCategory: true, name: true } }),
    ]);
    return text(
      JSON.stringify(
        {
          개발노트_섹션: cats.map((c) => ({
            slug: c.slug,
            name: c.name,
            platform: c.platform,
            세부카테고리: subs.filter((s) => s.mainCategory === c.slug).map((s) => s.name),
          })),
          스토리_분류: STORY_CATEGORIES,
          난이도: ["BEGINNER(초급)", "INTERMEDIATE(중급)", "ADVANCED(고급)"],
        },
        null,
        1,
      ),
    );
  }

  if (name === "list_existing_titles") {
    const [notes, drafts] = await Promise.all([
      prisma.developNote.findMany({
        orderBy: { noteId: "desc" },
        take: 80,
        select: { noteId: true, title: true, mainCategory: true, isPublished: true },
      }),
      prisma.draft.findMany({ where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 50, select: { title: true } }),
    ]);
    return text(
      JSON.stringify(
        {
          개발노트: notes.map((n) => ({ id: n.noteId, title: n.title, section: n.mainCategory, published: n.isPublished })),
          초안함_대기: drafts.map((d) => d.title),
        },
        null,
        1,
      ),
    );
  }

  if (name === "save_draft") {
    const parsed = parseDraftInput(args);
    if (parsed.ok === false) return text(`저장하지 못했어요: ${parsed.message}`, true);

    const pending = await prisma.draft.count({ where: { status: "pending" } });
    if (pending >= MAX_PENDING) {
      return text(`초안함에 대기 중인 초안이 ${MAX_PENDING}개예요. 관리자가 정리한 뒤에 다시 보내 주세요.`, true);
    }

    const draft = await prisma.draft.create({ data: parsed.data, select: { id: true } });
    return text(`초안함에 저장했어요 (id: ${draft.id}). 관리자 메뉴의 초안함(/admin/drafts)에서 확인하고 보낼 수 있어요.`);
  }

  return text(`알 수 없는 도구예요: ${name}`, true);
}

export type RpcOutcome = { status: number; body?: unknown };

async function handleOne(msg: JsonRpcRequest): Promise<unknown | null> {
  const isNotification = msg.id === undefined || msg.id === null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });

  if (typeof msg.method !== "string") return isNotification ? null : fail(-32600, "Invalid Request");
  if (isNotification) return null; // notifications/initialized 등: 응답 없음

  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      const version = typeof asked === "string" && SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[1];
      return reply({
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "buyoungsil-drafts", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = msg.params?.name;
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (typeof name !== "string") return fail(-32602, "도구 이름이 필요해요");
      try {
        return reply(await callTool(name, args));
      } catch (error) {
        console.error("MCP 도구 오류:", error);
        return reply(text("서버에서 오류가 났어요. 잠시 뒤 다시 시도해 주세요.", true));
      }
    }
    default:
      return fail(-32601, `지원하지 않는 메서드예요: ${msg.method}`);
  }
}

export async function handleRpc(payload: unknown): Promise<RpcOutcome> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return { status: 400, body: { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } } };
    const out = (await Promise.all(payload.map((m) => handleOne(m as JsonRpcRequest)))).filter((r) => r !== null);
    return out.length ? { status: 200, body: out } : { status: 202 };
  }
  if (!payload || typeof payload !== "object") {
    return { status: 400, body: { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } } };
  }
  const result = await handleOne(payload as JsonRpcRequest);
  return result === null ? { status: 202 } : { status: 200, body: result };
}
