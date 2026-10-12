// Native hooks register instructions; only the existing supervisor executes approved work.
import { createHash } from "crypto";
import prisma from "@/lib/prisma";
import { isAiEngine, type AiEngine } from "@/lib/factory/ai";
import { getDefaultAiEngine } from "@/lib/factory/settings";
import { maskSecrets } from "@/lib/factory/mask";
import { notifyMaintenance } from "@/lib/factory/telegram";

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,100}$/;
type Submission = { requestId: string; provider: AiEngine; text: string; threadId?: string; aiEngine?: AiEngine };
type Result = { ok: boolean; status: number; message: string; threadId?: string; turnId?: string; aiEngine?: string; duplicate?: boolean };

export function parseHookSubmission(value: unknown): Submission | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  if (typeof b.requestId !== "string" || !REQUEST_ID.test(b.requestId) || !isAiEngine(b.provider)) return null;
  if (typeof b.text !== "string" || b.text.trim().length < 5 || b.text.length > 8000) return null;
  if (b.aiEngine !== undefined && !isAiEngine(b.aiEngine)) return null;
  if (b.threadId !== undefined && (typeof b.threadId !== "string" || !ID.test(b.threadId))) return null;
  // A hook cannot approve, execute, change defaults, or request deployment.
  if (Object.keys(b).some(k => !["requestId", "provider", "text", "threadId", "aiEngine"].includes(k))) return null;
  return { requestId: b.requestId, provider: b.provider, text: b.text.trim(), ...(isAiEngine(b.aiEngine) ? { aiEngine: b.aiEngine } : {}), ...(typeof b.threadId === "string" ? { threadId: b.threadId } : {}) };
}

export async function submitHookTask(b: Submission): Promise<Result> {
  const turnId = `hook_${createHash("sha256").update(b.requestId).digest("hex").slice(0, 32)}`;
  const source = b.provider === "codex" ? "Codex 훅" : "Claude 훅";
  const text = maskSecrets(b.text);
  const readExisting = async (): Promise<Result | null> => {
    const old = await prisma.factoryMaintenanceMessage.findUnique({ where: { id: turnId }, select: { id: true, maintenanceId: true, text: true, source: true, aiEngine: true, role: true } });
    if (!old) return null;
    if (old.role !== "user" || old.text !== text || old.source !== source || (b.threadId && b.threadId !== old.maintenanceId) || (b.aiEngine && b.aiEngine !== old.aiEngine)) return { ok: false, status: 409, message: "같은 요청 ID로 다른 지시를 보낼 수 없어요." };
    return { ok: true, status: 200, message: "이미 등록된 지시예요. 통제실에서 상태를 확인하세요.", threadId: old.maintenanceId, turnId: old.id, aiEngine: old.aiEngine, duplicate: true };
  };
  const existing = await readExisting();
  if (existing) return existing;
  const aiEngine = b.aiEngine ?? await getDefaultAiEngine();
  const threadId = b.threadId ?? turnId;
  try {
    await prisma.$transaction(async tx => {
      if (b.threadId) {
        const thread = await tx.factoryMaintenance.findUnique({ where: { id: threadId }, select: { status: true } });
        if (!thread || thread.status === "closed") throw new Error("HOOK_THREAD_UNAVAILABLE");
        await tx.factoryMaintenance.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
        await tx.factoryMaintenanceMessage.create({ data: { id: turnId, maintenanceId: threadId, role: "user", text, source, aiEngine, status: "awaiting_approval" } });
      } else {
        await tx.factoryMaintenance.create({ data: { id: threadId, title: text.split("\n")[0].slice(0, 60), messages: { create: { id: turnId, role: "user", text, source, aiEngine, status: "awaiting_approval" } } } });
      }
    });
  } catch (e) {
    if (e instanceof Error && e.message === "HOOK_THREAD_UNAVAILABLE") return { ok: false, status: 409, message: "이어갈 정비가 없거나 닫혔어요." };
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
      const duplicate = await readExisting();
      if (duplicate) return duplicate;
    }
    throw e;
  }
  // The instruction is durable even when the optional notification cannot be delivered.
  await notifyMaintenance("approval", threadId, turnId).catch(() => {});
  return { ok: true, status: 201, message: "정비 지시를 등록했어요. 통제실에서 승인하면 감독 프로그램이 처리해요.", threadId, turnId, aiEngine, duplicate: false };
}

export async function hookThreadStatus(threadId: string) {
  if (!ID.test(threadId)) return null;
  const thread = await prisma.factoryMaintenance.findUnique({ where: { id: threadId }, select: { id: true, title: true, status: true, messages: { where: { role: { in: ["user", "assistant", "system"] } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, role: true, aiEngine: true, status: true, text: true, createdAt: true } } } });
  return thread ? { ...thread, title: maskSecrets(thread.title), messages: thread.messages.reverse().map(m => ({ ...m, text: maskSecrets(m.text) })) } : null;
}
