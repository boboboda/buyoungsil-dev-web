// lib/factory/toolbox.ts
// 통제실 [설정] '도구함 한눈에 보기'(읽기 전용) 자료. 코드에 있는 '도구'를 한 줄 카드로 정리한다.
// - 도구 요청 중계(통제실 스위치, factory_settings.toolBroker)와 허용 목록(echo·toolkit.run, 감독 프로그램 toolbroker.mjs 의 ADAPTERS)
// - 작업 PC 의 도구(Claude Code·Codex·ffmpeg·ffprobe: 감독 프로그램이 /api/factory/next 로 알려 준 supervisorRuntime)
// - 결과 이미지 올리기(assetupload.mjs), Claude 채팅 커넥터 도구(/api/mcp, lib/drafts/mcp.ts·lib/factory/mcp.ts·maintenance-mcp.ts)
// 최근 사용 횟수는 이미 있는 factory_jobs.toolRequests(중계 기록)에서만 센다. 새 기록은 만들지 않는다.
// 비밀값·토큰은 읽지 않는다(커넥터 토큰은 '설정됨/없음'만). 하나를 못 읽어도 그 칸만 '확인 못 함'(null).
import { cleanToolRequests, readStoredToolBroker, TOOL_BROKER_MODE_LABELS, toolBrokerLimitLabel, type ToolBrokerSettings } from "@/lib/factory/toolBroker";

// 감독 프로그램 허용 목록(tools/factory-supervisor/toolbroker.mjs 의 ADAPTERS 와 같아야 한다. 시험이 맞춰 본다)
export const ALLOWED_TOOLS = ["echo", "toolkit.run"] as const;

// Claude 채팅 커넥터(/api/mcp) 도구 이름(코드에 고정). 묶음별
export const CONNECTOR_TOOLS = {
  drafts: ["list_categories", "list_existing_titles", "create_sub_category", "save_draft"],
  factory: ["list_factory_jobs", "get_factory_job", "list_secret_names", "enqueue_app_job", "get_release_status", "enqueue_release_job", "supervisor_control"],
  maintenance: ["maintenance_list", "maintenance_get", "maintenance_send"],
} as const;

export const TOOLBOX_USAGE_DAYS = 30;
const SETTINGS = "/admin/factory?tab=settings";

export type Tone = "ok" | "warn" | "bad" | "muted";
export type Manager = "통제실 스위치" | "작업 PC 설정" | "코드";
export type ToolGroup = "allowed" | "blocked" | "pc" | "connector";

export interface ToolUsage {
  total: number;
  ok: number;
  denied: number;
  failed: number; // failed + timeout
}

export interface ToolCard {
  key: string;
  name: string;
  does: string; // 하는 일 한 문장
  state: string; // 꺼짐 / 보고만 / 허용 / 있음 · 버전 / 확인 못 함 …
  tone: Tone;
  managers: Manager[];
  where: { label: string; href: string };
  usage?: ToolUsage | null; // undefined = 기록이 없는 도구(표시 안 함), null = 기록을 못 읽음
  group: ToolGroup;
  note?: string;
}

// 각 칸: null = 읽지 못함
export interface ToolboxSource {
  broker: ToolBrokerSettings | null;
  runtime: { claudeTool?: string; codexTool?: string; aiToolsAt?: string; ffmpeg?: string; ffprobe?: string } | null;
  usage: Record<string, ToolUsage> | null; // 도구 이름 → 최근 N일 횟수. "?" = 형식이 틀리거나 목록에 없는 요청
  connectorToken: boolean | null; // 커넥터 토큰이 서버에 설정돼 있는지(값은 읽지 않음)
}

export interface Toolbox {
  broker: { mode: string; tone: Tone; limits: string } | null;
  cards: ToolCard[];
  usageDays: number;
}

const EMPTY_USAGE: ToolUsage = { total: 0, ok: 0, denied: 0, failed: 0 };

/** "버전 · 로그인됨" 같은 AI 도구 상태 → 화면 글과 색 */
export function aiToolState(v: string | undefined, runtimeOk: boolean): { state: string; tone: Tone } {
  if (!runtimeOk) return { state: "확인 못 함", tone: "muted" };
  if (!v || v === "확인 안 함") return { state: "아직 확인 안 함", tone: "muted" };
  if (v === "없음") return { state: "없음(설치 안 됨)", tone: "bad" };
  if (v.includes("로그인 안 됨")) return { state: v, tone: "bad" };
  if (v.includes("로그인됨")) return { state: v, tone: "ok" };

  return { state: v, tone: "warn" };
}

/** ffmpeg "버전 | 경로" → "있음 · 버전"(PC 경로는 보이지 않는다) */
export function pcProgramState(v: string | undefined, runtimeOk: boolean): { state: string; tone: Tone } {
  if (!runtimeOk) return { state: "확인 못 함", tone: "muted" };
  if (!v) return { state: "아직 확인 안 함", tone: "muted" };
  if (v === "없음") return { state: "없음", tone: "bad" };
  const version = v.split(" | ")[0].trim().slice(0, 40);

  return { state: version ? `있음 · ${version}` : "있음", tone: "ok" };
}

const MODE_TONE: Record<ToolBrokerSettings["mode"], Tone> = { off: "muted", report: "warn", allow: "ok" };

/** 허용 목록 도구의 상태: 중계 모드를 따른다 */
function allowedState(b: ToolBrokerSettings | null): { state: string; tone: Tone } {
  if (!b) return { state: "확인 못 함", tone: "muted" };
  if (b.mode === "off") return { state: "꺼짐(중계가 꺼져 있어요)", tone: "muted" };
  if (b.mode === "report") return { state: "보고만(기록만, 실행 안 함)", tone: "warn" };

  return { state: "허용(감독 프로그램이 실행)", tone: "ok" };
}

const usageOf = (src: ToolboxSource, name: string): ToolUsage | null => (src.usage ? (src.usage[name] ?? EMPTY_USAGE) : null);

/** 읽은 값 → 카드 목록(순서 고정) */
export function buildToolbox(src: ToolboxSource): Toolbox {
  const b = src.broker;
  const allowed = allowedState(b);
  const rt = src.runtime;
  const claude = aiToolState(rt?.claudeTool, !!rt);
  const codex = aiToolState(rt?.codexTool, !!rt);
  const ffmpeg = pcProgramState(rt?.ffmpeg, !!rt);
  const ffprobe = pcProgramState(rt?.ffprobe, !!rt);
  const brokerLink = { label: "설정 › 도구 요청 중계", href: `${SETTINGS}#tool-broker` };
  const aiLink = { label: "설정 › AI 도구 상태", href: `${SETTINGS}#ai-tools` };
  const pcLink = { label: "현황 › 감독 프로그램", href: "/admin/factory?tab=status" };
  const connectorCount = Object.values(CONNECTOR_TOOLS).reduce((n, list) => n + list.length, 0);

  const cards: ToolCard[] = [
    {
      key: "echo",
      name: "echo",
      does: "받은 값을 그대로 돌려줘요. 중계 길이 잘 이어졌는지 확인하는 시험용 도구예요.",
      ...allowed,
      managers: ["코드", "통제실 스위치"],
      where: brokerLink,
      usage: usageOf(src, "echo"),
      group: "allowed",
    },
    {
      key: "toolkit.run",
      name: "toolkit.run",
      does: "작업 PC 게임 툴킷(파이썬 도구 모음)의 명령 하나를 실행해요. 이미지 만들기 같은 일을 여기서 해요.",
      ...allowed,
      managers: ["코드", "통제실 스위치", "작업 PC 설정"],
      where: brokerLink,
      usage: usageOf(src, "toolkit.run"),
      group: "allowed",
      note: "실행할 수 있는 명령은 작업 PC 의 game-toolkit/tools.json 에 적힌 것뿐이에요(목록은 바로 위 '도구 목록'에서 볼 수 있어요). 인터넷·키가 필요한 명령은 '허용' 모드이면서 그 일감의 필요한 키에 이름이 있을 때만 돌아요.",
    },
    {
      key: "blocked",
      name: "그 밖의 모든 도구 이름",
      does: "허용 목록에 없는 도구는 실행하지 않고 거절(denied)로 답해요.",
      state: "막힘",
      tone: "bad",
      managers: ["코드"],
      where: brokerLink,
      usage: usageOf(src, "?"),
      group: "blocked",
      note: "AI 가 다른 이름을 요청하면 감독 프로그램이 '허용 목록에 없는 도구예요'라고 답하고 아무것도 실행하지 않아요. 임의의 명령어 실행은 처음부터 없어요.",
    },
    {
      key: "asset-upload",
      name: "결과 이미지 올리기",
      does: "도구가 만든 이미지(.factory/assets)를 통제실 일감 상세의 이미지로 올려요.",
      ...(b ? (b.mode === "allow" ? { state: "자동(도구가 성공할 때마다)", tone: "ok" as Tone } : { state: "쉬는 중(중계가 '허용'일 때만)", tone: "muted" as Tone }) : { state: "확인 못 함", tone: "muted" as Tone }),
      managers: ["코드"],
      where: { label: "일감 › 일감 상세", href: "/admin/factory?tab=jobs" },
      group: "pc",
    },
    {
      key: "claude",
      name: "Claude Code",
      does: "작업 PC 에서 앱을 만들고 고치는 AI 프로그램이에요.",
      ...claude,
      managers: ["작업 PC 설정"],
      where: aiLink,
      group: "pc",
    },
    {
      key: "codex",
      name: "Codex",
      does: "Claude 대신 고를 수 있는 작업 PC 의 다른 AI 프로그램이에요.",
      ...codex,
      managers: ["작업 PC 설정"],
      where: aiLink,
      group: "pc",
    },
    {
      key: "ffmpeg",
      name: "ffmpeg",
      does: "출시 자료의 홍보 영상이 너무 크면 줄인 사본을 만들어요(작업 PC 프로그램).",
      ...ffmpeg,
      managers: ["작업 PC 설정"],
      where: pcLink,
      group: "pc",
    },
    {
      key: "ffprobe",
      name: "ffprobe",
      does: "영상 길이·크기 같은 정보를 읽어요(ffmpeg 와 같이 설치돼요).",
      ...ffprobe,
      managers: ["작업 PC 설정"],
      where: pcLink,
      group: "pc",
    },
    {
      key: "connector",
      name: `Claude 채팅 커넥터 도구 ${connectorCount}개`,
      does: "Claude 채팅에서 초안 보내기, 앱 일감·출시 등록, 정비 지시, 감독 프로그램 상태 보기를 해요.",
      ...(src.connectorToken === null
        ? { state: "확인 못 함", tone: "muted" as Tone }
        : src.connectorToken
          ? { state: "연결 가능(토큰 설정됨)", tone: "ok" as Tone }
          : { state: "꺼짐(토큰 없음)", tone: "bad" as Tone }),
      managers: ["코드"],
      where: { label: "Claude 커넥터 설정(claude.ai)", href: "#toolbox-guide" },
      group: "connector",
      note: `초안함: ${CONNECTOR_TOOLS.drafts.join(", ")} · 앱 공장: ${CONNECTOR_TOOLS.factory.join(", ")} · 정비: ${CONNECTOR_TOOLS.maintenance.join(", ")}. 등록·지시까지만 하고 승인·배포는 통제실에서 사람이 해요.`,
    },
  ];

  return {
    broker: b
      ? {
          mode: TOOL_BROKER_MODE_LABELS[b.mode],
          tone: MODE_TONE[b.mode],
          limits: `일감당 요청 ${toolBrokerLimitLabel(b.maxRequests, "개")} · 제한 시간 ${toolBrokerLimitLabel(b.toolTimeoutSec, "초")}`,
        }
      : null,
    cards,
    usageDays: TOOLBOX_USAGE_DAYS,
  };
}

/** 중계 기록(일감마다 배열) → 도구별 최근 횟수. 형식이 틀린 항목은 버린다 */
export function countToolUsage(lists: unknown[], sinceMs: number): Record<string, ToolUsage> {
  const out: Record<string, ToolUsage> = {};

  for (const list of lists) {
    for (const r of cleanToolRequests(list) ?? []) {
      if (Date.parse(r.at) < sinceMs) continue;
      const key = (ALLOWED_TOOLS as readonly string[]).includes(r.tool) ? r.tool : "?";
      const u = (out[key] ??= { ...EMPTY_USAGE });

      u.total++;
      if (r.status === "ok") u.ok++;
      else if (r.status === "denied") u.denied++;
      else u.failed++;
    }
  }

  return out;
}

/** 중계 기록 → toolkit.run 하위 명령별 최근 횟수. 명령 이름이 없는 기록(예전 기록)은 "?"(미상)로 묶는다 */
export function countCommandUsage(lists: unknown[], sinceMs: number): Record<string, ToolUsage> {
  const out: Record<string, ToolUsage> = {};

  for (const list of lists) {
    for (const r of cleanToolRequests(list) ?? []) {
      if (r.tool !== "toolkit.run" || Date.parse(r.at) < sinceMs) continue;
      const u = (out[r.command || "?"] ??= { ...EMPTY_USAGE });

      u.total++;
      if (r.status === "ok") u.ok++;
      else if (r.status === "denied") u.denied++;
      else u.failed++;
    }
  }

  return out;
}

export interface ToolboxDb {
  factorySetting: { findUnique(args: { where: { key: string } }): PromiseLike<{ value: string } | null> };
  factoryJob: { findMany(args: object): PromiseLike<{ toolRequests: unknown }[]> };
}

async function part<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.error(`[toolbox] ${label} 읽기 실패:`, error instanceof Error ? error.name : "unknown");

    return null;
  }
}

const parseJson = (v: string | undefined | null): unknown => {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

/** DB·환경에서 읽기. 칸마다 따로 실패한다 */
export async function readToolboxSource(db: ToolboxDb, env: Record<string, string | undefined> = process.env, now = Date.now()): Promise<ToolboxSource> {
  const since = now - TOOLBOX_USAGE_DAYS * 24 * 3600_000;
  const [broker, runtime, usage] = await Promise.all([
    part("도구 요청 중계 설정", async () => readStoredToolBroker(parseJson((await db.factorySetting.findUnique({ where: { key: "toolBroker" } }))?.value))),
    part("감독 프로그램 실행 정보", async () => {
      const raw = parseJson((await db.factorySetting.findUnique({ where: { key: "supervisorRuntime" } }))?.value);
      const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);

      // 필요한 칸만 꺼낸다
      return { claudeTool: s("claudeTool"), codexTool: s("codexTool"), aiToolsAt: s("aiToolsAt"), ffmpeg: s("ffmpeg"), ffprobe: s("ffprobe") };
    }),
    part("도구 요청 기록", async () => {
      const rows = await db.factoryJob.findMany({
        where: { updatedAt: { gte: new Date(since) } },
        select: { toolRequests: true },
        orderBy: { updatedAt: "desc" },
        take: 500,
      });

      return countToolUsage(
        rows.map((r) => r.toolRequests),
        since,
      );
    }),
  ]);
  let connectorToken: boolean | null = null;

  try {
    connectorToken = typeof env.DRAFT_API_TOKEN === "string" && env.DRAFT_API_TOKEN.trim() !== "";
  } catch {
    connectorToken = null;
  }

  return { broker, runtime, usage, connectorToken };
}

/** 도구 목록 줄마다 보일 toolkit.run 하위 명령별 최근 횟수. 못 읽으면 null */
export async function readCommandUsage(db: Pick<ToolboxDb, "factoryJob">, now = Date.now()): Promise<Record<string, ToolUsage> | null> {
  const since = now - TOOLBOX_USAGE_DAYS * 24 * 3600_000;

  return part("도구별 사용 기록", async () => {
    const rows = await db.factoryJob.findMany({ where: { updatedAt: { gte: new Date(since) } }, select: { toolRequests: true }, orderBy: { updatedAt: "desc" }, take: 500 });

    return countCommandUsage(
      rows.map((r) => r.toolRequests),
      since,
    );
  });
}
