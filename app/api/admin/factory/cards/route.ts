// app/api/admin/factory/cards/route.ts
// 통제실 스튜디오의 결과물 카드 보기·만들기·고치기. 관리자만. 이력의 "누가"는 늘 '통제실'.
//   GET  ?appSlug=…[&cardId=…]            → { cards, tools, fields, history? }  (cardId 를 주면 그 카드의 변경 이력도)
//   POST { appSlug, card: {…} }            → 새 카드(도구 설명서 검사를 통과해야 저장)
//   PUT  { appSlug, card: id 또는 이름, patch: {…}, note? } → 카드 고치기(판 번호 +1, 이력 한 줄)
// 카드 내용: { name, description, tool, method, options, refRules, settings, enabled }. 키는 저장하지 않는다(설명서에서 자동).
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/factory/admin";
import { auth } from "@/lib/auth/get-sesstion";
import { cardFields, type CardField } from "@/lib/factory/cards";
import { createCard, findCardRow, getCard, listCardHistory, listCards, updateCard } from "@/lib/factory/cardsDb";
import { readManifestsView } from "@/lib/factory/toolManifestDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

async function adminName(): Promise<string> {
  const session = await auth().catch(() => null);

  return session?.user?.name || session?.user?.email || "관리자";
}

/** 화면이 도구·방법을 고르면 입력칸을 만들 수 있게: 도구 → 방법 → 입력칸 */
async function toolChoices() {
  const view = await readManifestsView();
  const fields: Record<string, Record<string, CardField[]>> = {};
  const tools = view.tools.map((t) => {
    fields[t.name] = { "": cardFields(t, "") };
    for (const m of t.methods) fields[t.name][m.id] = cardFields(t, m.id);

    return { name: t.name, label: t.label, methods: t.methods.map((m) => ({ id: m.id, label: m.label, secrets: m.secretStates })) };
  });

  return { tools, fields };
}

async function snapshot(appSlug: string, cardId?: string) {
  const [cards, choices] = await Promise.all([listCards(appSlug), toolChoices()]);
  const history = cardId ? await listCardHistory(cardId) : undefined;

  return { appSlug, cards, ...choices, ...(history ? { history } : {}) };
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const appSlug = req.nextUrl.searchParams.get("appSlug") ?? "";
  const cardId = req.nextUrl.searchParams.get("cardId") ?? "";

  if (!SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 형식이 올바르지 않아요." }, { status: 400 });
  const row = cardId ? await findCardRow(appSlug, cardId) : null;

  return NextResponse.json(await snapshot(appSlug, row?.id), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { appSlug?: unknown; card?: unknown } | null;
  const appSlug = typeof body?.appSlug === "string" ? body.appSlug.trim() : "";

  if (!SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 형식이 올바르지 않아요." }, { status: 400 });
  if (!body?.card || typeof body.card !== "object" || Array.isArray(body.card)) return NextResponse.json({ message: "card 가 필요해요." }, { status: 400 });
  const res = await createCard(appSlug, body.card as Record<string, unknown>, "통제실", await adminName());

  if (res.ok === false) return NextResponse.json({ message: `카드를 만들지 못했어요: ${res.errors.slice(0, 5).join(" / ")}`, errors: res.errors }, { status: res.status });

  return NextResponse.json({ message: res.message, ...(await snapshot(appSlug, res.card.id)) });
}

export async function PUT(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { appSlug?: unknown; card?: unknown; patch?: unknown; note?: unknown } | null;
  const appSlug = typeof body?.appSlug === "string" ? body.appSlug.trim() : "";

  if (!SLUG_RE.test(appSlug)) return NextResponse.json({ message: "appSlug 형식이 올바르지 않아요." }, { status: 400 });
  if (!body?.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) return NextResponse.json({ message: "patch 가 필요해요." }, { status: 400 });
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 100) : "수정";
  const res = await updateCard(appSlug, body.card, body.patch as Record<string, unknown>, "통제실", await adminName(), note);

  if (res.ok === false) return NextResponse.json({ message: `카드를 저장하지 못했어요: ${res.errors.slice(0, 5).join(" / ")}`, errors: res.errors }, { status: res.status });
  const fresh = await getCard(appSlug, res.card.id);

  return NextResponse.json({ message: res.message, unchanged: res.unchanged === true, ...(await snapshot(appSlug, fresh?.id)) });
}
