// lib/factory/cardsDb.ts
// 결과물 카드의 DB 읽기·쓰기(형식·검사는 cards.ts). 표 = factory_cards(현재 판) + factory_card_history(판마다 한 줄, 카드마다 최근 CARD_HISTORY_KEEP 개만).
// - 카드를 고치면 판 번호가 1 올라가고 이력에 "누가"(통제실 / 채팅 / 정비)와 바뀐 칸이 남는다. 같은 내용이면 올리지 않는다.
// - 프로젝트 도구 설정(factory_project_tool_settings)은 그대로 두고, 그 내용은 '기본 카드'에 같이 옮겨 둔다(mirrorLegacySettings).
//   카드를 부르지 않는 일감은 예전처럼 프로젝트 도구 설정으로 돈다.
import { randomBytes } from "node:crypto";

import prisma from "@/lib/prisma";
import { knownSecretNames } from "@/lib/factory/secretEntries";
import { readManifestTools } from "@/lib/factory/toolManifestDb";
import { cleanProjectSettings, readStoredSettings, type ProjectToolSettings } from "@/lib/factory/projectToolSettings";
import {
  CARD_HISTORY_KEEP,
  CARD_HISTORY_LIMIT,
  CARD_ID_RE,
  cardRef,
  cardSnapshot,
  changedCardFields,
  compileCardSettings,
  DEFAULT_CARD_NAME,
  MAX_CARDS_PER_APP,
  readCardData,
  readSnapshot,
  validateCard,
  type CardData,
  type CardInput,
  type CardSource,
  type RefRules,
} from "@/lib/factory/cards";
import { methodSecrets, type ToolManifestEntry } from "@/lib/factory/toolManifest";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export interface CardView extends CardData {
  id: string;
  appSlug: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
  isDefault: boolean;
  secrets: { name: string; ready: boolean }[]; // 설명서가 정해 준 이 방법의 키(이름과 등록 여부만)
  pinnedArt: { id: string; url: string; subject: string } | null;
  warnings: string[];
}

export interface CardHistoryItem {
  version: number;
  source: string;
  who: string;
  note: string;
  createdAt: string;
  changed: string[];
}

type Row = Awaited<ReturnType<typeof prisma.factoryCard.findFirstOrThrow>>;

const newId = () => `card_${randomBytes(12).toString("hex")}`;

async function viewOf(row: Row, tools: Record<string, ToolManifestEntry>, registered: ReadonlySet<string>): Promise<CardView> {
  const data = readCardData(row);
  const manifest = tools[data.tool];
  const names = manifest && data.method ? methodSecrets(manifest, data.method) : [];
  const warnings: string[] = [];
  let pinnedArt: CardView["pinnedArt"] = null;

  if (data.refRules.pinDefault) {
    if (!data.refRules.defaultArtId) warnings.push("기본 그림 고정이 켜져 있는데 기본 그림을 고르지 않았어요. 고를 때까지 고정은 적용되지 않아요.");
    else {
      const art = await prisma.factoryArt.findFirst({ where: { id: data.refRules.defaultArtId, appSlug: row.appSlug } });

      if (!art || art.status !== "approved") warnings.push("기본 그림이 승인된 그림이 아니에요(반려됐거나 없어요). 고정은 적용되지 않아요.");
      else pinnedArt = { id: art.id, url: art.url, subject: art.subject };
    }
  }
  for (const n of names) if (!registered.has(n)) warnings.push(`${n} 키 이름이 등록돼 있지 않아요. 등록하기 전에는 이 카드로 일감을 보내도 키 때문에 실패해요.`);
  if (Object.keys(tools).length && !manifest) warnings.push(`도구 설명서에 ${data.tool} 가 없어요.`);

  return {
    ...data,
    id: row.id,
    appSlug: row.appSlug,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    isDefault: row.name === DEFAULT_CARD_NAME,
    secrets: names.map((name) => ({ name, ready: registered.has(name) })),
    pinnedArt,
    warnings,
  };
}

async function context() {
  const [tools, names] = await Promise.all([readManifestTools(), knownSecretNames().catch(() => [] as { name: string }[])]);

  return { tools, registered: new Set(names.map((n) => n.name)) };
}

async function writeHistory(cardId: string, appSlug: string, version: number, data: CardData, source: CardSource, who: string, note: string) {
  await prisma.factoryCardHistory.create({ data: { cardId, appSlug, version, source, who: who.slice(0, 80), note: note.slice(0, 120), snapshot: cardSnapshot(data) as object } });
  if (version > CARD_HISTORY_KEEP) await prisma.factoryCardHistory.deleteMany({ where: { cardId, version: { lte: version - CARD_HISTORY_KEEP } } });
}

/** 프로젝트 도구 설정이 있고 '기본 카드'가 아직 없으면 만든다(옮김 마이그레이션 뒤에 생긴 프로젝트용) */
async function ensureDefaultCard(appSlug: string): Promise<void> {
  const [has, legacy] = await Promise.all([prisma.factoryCard.findUnique({ where: { appSlug_name: { appSlug, name: DEFAULT_CARD_NAME } } }), prisma.factoryProjectToolSetting.findUnique({ where: { appSlug } })]);

  if (has || !legacy || !readStoredSettings(legacy.settings)) return;
  const data: CardData = { name: DEFAULT_CARD_NAME, description: "프로젝트 도구 설정을 옮긴 카드. 설정 묶음은 프로젝트 도구 설정에서 고쳐요.", tool: "pixel-art", method: "", options: {}, refRules: { pinDefault: false, defaultArtId: null, sameSubject: true, sameKind: true, maxRefs: null }, settings: readStoredSettings(legacy.settings), enabled: true };
  const id = newId();

  try {
    await prisma.factoryCard.create({ data: { id, appSlug, name: data.name, description: data.description, tool: data.tool, method: "", options: {}, refRules: data.refRules as object, settings: legacy.settings, updatedBy: "자동(2-2 옮김)" } });
    await writeHistory(id, appSlug, 1, data, "정비", "자동(2-2 옮김)", "프로젝트 도구 설정에서 옮김");
  } catch {
    /* 동시에 만들었으면 하나만 남는다 */
  }
}

export async function listCards(appSlug: string): Promise<CardView[]> {
  if (!SLUG_RE.test(appSlug)) return [];
  await ensureDefaultCard(appSlug).catch(() => {});
  const [rows, ctx] = await Promise.all([prisma.factoryCard.findMany({ where: { appSlug }, orderBy: [{ createdAt: "asc" }, { name: "asc" }] }), context()]);

  return Promise.all(rows.map((r) => viewOf(r, ctx.tools, ctx.registered)));
}

/** id 또는 (프로젝트 안의) 카드 이름으로 한 장 */
export async function findCardRow(appSlug: string, ref: unknown): Promise<Row | null> {
  const key = cardRef(ref);

  if (!key || !SLUG_RE.test(appSlug)) return null;
  await ensureDefaultCard(appSlug).catch(() => {});
  if (CARD_ID_RE.test(key)) {
    const byId = await prisma.factoryCard.findFirst({ where: { id: key, appSlug } });

    if (byId) return byId;
  }

  return prisma.factoryCard.findUnique({ where: { appSlug_name: { appSlug, name: key } } });
}

export async function getCard(appSlug: string, ref: unknown): Promise<CardView | null> {
  const row = await findCardRow(appSlug, ref);

  if (!row) return null;
  const ctx = await context();

  return viewOf(row, ctx.tools, ctx.registered);
}

export async function listCardHistory(cardId: string, limit = CARD_HISTORY_LIMIT): Promise<CardHistoryItem[]> {
  const rows = await prisma.factoryCardHistory.findMany({ where: { cardId }, orderBy: { version: "desc" }, take: limit + 1 });

  return rows.slice(0, limit).map((r, i) => {
    const prev = rows[i + 1] ? readSnapshot(rows[i + 1].snapshot) : null;
    const cur = readSnapshot(r.snapshot);

    return { version: r.version, source: r.source, who: r.who, note: r.note, createdAt: r.createdAt.toISOString(), changed: cur ? changedCardFields(prev, cur) : [] };
  });
}

export type CardResult = { ok: true; card: CardView; unchanged?: boolean; message: string } | { ok: false; errors: string[]; status: number };

export async function createCard(appSlug: string, input: CardInput, source: CardSource, who: string, note = "새로 만듦"): Promise<CardResult> {
  if (!SLUG_RE.test(appSlug)) return { ok: false, errors: ["appSlug 형식이 올바르지 않아요."], status: 400 };
  const ctx = await context();
  const checked = validateCard(input, ctx.tools);

  if (checked.ok === false) return { ok: false, errors: checked.errors, status: 400 };
  if ((await prisma.factoryCard.count({ where: { appSlug } })) >= MAX_CARDS_PER_APP) return { ok: false, errors: [`카드는 프로젝트마다 ${MAX_CARDS_PER_APP}장까지예요.`], status: 400 };
  const d = checked.data;
  const id = newId();

  try {
    const row = await prisma.factoryCard.create({
      data: { id, appSlug, name: d.name, description: d.description, tool: d.tool, method: d.method, options: d.options, refRules: d.refRules as object, settings: d.settings ? JSON.stringify(d.settings) : "", enabled: d.enabled, updatedBy: who.slice(0, 80) },
    });

    await writeHistory(id, appSlug, 1, d, source, who, note);

    return { ok: true, card: await viewOf(row, ctx.tools, ctx.registered), message: `카드 '${d.name}'을 만들었어요(판 1).` };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { ok: false, errors: [`이 프로젝트에 '${d.name}' 카드가 이미 있어요.`], status: 409 };
    throw e;
  }
}

export async function updateCard(appSlug: string, ref: unknown, input: CardInput, source: CardSource, who: string, note = "수정"): Promise<CardResult> {
  const row = await findCardRow(appSlug, ref);

  if (!row) return { ok: false, errors: ["그 카드가 없어요."], status: 404 };
  const ctx = await context();
  const base = readCardData(row);
  const checked = validateCard(input, ctx.tools, base);

  if (checked.ok === false) return { ok: false, errors: checked.errors, status: 400 };
  const d = checked.data;
  const changed = changedCardFields(base, d);

  if (!changed.length) return { ok: true, card: await viewOf(row, ctx.tools, ctx.registered), unchanged: true, message: "바뀐 것이 없어서 저장하지 않았어요." };
  if (row.name === DEFAULT_CARD_NAME && d.name !== DEFAULT_CARD_NAME) return { ok: false, errors: ["기본 카드의 이름은 바꿀 수 없어요."], status: 400 };
  const version = row.version + 1;

  try {
    const hit = await prisma.factoryCard.updateMany({
      where: { id: row.id, version: row.version },
      data: { name: d.name, description: d.description, tool: d.tool, method: d.method, options: d.options, refRules: d.refRules as object, settings: d.settings ? JSON.stringify(d.settings) : "", enabled: d.enabled, version, updatedAt: new Date(), updatedBy: who.slice(0, 80) },
    });

    if (!hit.count) return { ok: false, errors: ["그 사이에 다른 곳에서 카드를 고쳤어요. 다시 불러온 뒤 고쳐 주세요."], status: 409 };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return { ok: false, errors: [`이 프로젝트에 '${d.name}' 카드가 이미 있어요.`], status: 409 };
    throw e;
  }
  await writeHistory(row.id, appSlug, version, d, source, who, note);
  const fresh = await prisma.factoryCard.findUniqueOrThrow({ where: { id: row.id } });

  return { ok: true, card: await viewOf(fresh, ctx.tools, ctx.registered), message: `카드 '${d.name}'을 저장했어요(판 ${version}, 바뀐 곳: ${changed.join("·")}). 새로 시작하는 일감부터 적용돼요.` };
}

/** 프로젝트 도구 설정을 저장했을 때 '기본 카드'의 설정 묶음도 같은 내용으로 맞춘다. 실패해도 도구 설정 저장은 그대로(던지지 않는다) */
export async function mirrorLegacySettings(appSlug: string, settings: ProjectToolSettings, source: CardSource, who: string): Promise<void> {
  try {
    if (!SLUG_RE.test(appSlug)) return;
    const row = await prisma.factoryCard.findUnique({ where: { appSlug_name: { appSlug, name: DEFAULT_CARD_NAME } } });

    if (!row) return void (await ensureDefaultCard(appSlug));
    const base = readCardData(row);
    const cleaned = cleanProjectSettings(settings); // 키 순서까지 같게 맞춰서 비교한다
    const next = cleaned.ok && Object.keys(cleaned.settings).some((k) => k !== "version") ? cleaned.settings : null;

    if (JSON.stringify(base.settings ?? null) === JSON.stringify(next)) return;
    const version = row.version + 1;
    const d: CardData = { ...base, settings: next };

    await prisma.factoryCard.update({ where: { id: row.id }, data: { settings: next ? JSON.stringify(next) : "", version, updatedAt: new Date(), updatedBy: who.slice(0, 80) } });
    await writeHistory(row.id, appSlug, version, d, source, who, "프로젝트 도구 설정을 고쳐서 맞춤");
  } catch (e) {
    console.error("[factory] 기본 카드 맞추기 실패:", e);
  }
}

// ───────── 일감·감독 프로그램 ─────────

export interface CardRun {
  id: string;
  name: string;
  version: number;
  tool: string;
  method: string;
  settings: ProjectToolSettings;
  rules: Pick<RefRules, "sameSubject" | "sameKind">;
  pinned: { url: string; subject: string; kind: string } | null; // 기본 그림 고정(1순위로 붙일 승인 그림)
}

async function runOf(row: Row): Promise<CardRun | null> {
  const data = readCardData(row);
  const compiled = compileCardSettings(data);

  if (!compiled.ok) return null;
  let pinned: CardRun["pinned"] = null;

  if (data.refRules.pinDefault && data.refRules.defaultArtId) {
    const art = await prisma.factoryArt.findFirst({ where: { id: data.refRules.defaultArtId, appSlug: row.appSlug, status: "approved" } });

    if (art) pinned = { url: art.url, subject: art.subject, kind: art.kind };
  }

  return { id: row.id, name: row.name, version: row.version, tool: data.tool, method: data.method, settings: compiled.settings, rules: { sameSubject: data.refRules.sameSubject, sameKind: data.refRules.sameKind }, pinned };
}

/** 일감이 시작할 때 쓰는 카드(만든 설정·참고 규칙·고정 그림). 없거나 꺼졌거나 설정을 못 만들면 null */
export async function cardRunForJobs(cardIds: readonly string[]): Promise<Map<string, CardRun>> {
  const out = new Map<string, CardRun>();
  const ids = [...new Set(cardIds.filter((i) => CARD_ID_RE.test(i)))];

  if (!ids.length) return out;
  for (const row of await prisma.factoryCard.findMany({ where: { id: { in: ids } } })) {
    const run = row.enabled ? await runOf(row) : null;

    if (run) out.set(row.id, run);
  }

  return out;
}

/** 감독 프로그램이 받는 프로젝트의 카드 목록(켜진 카드만, 만든 설정 포함). `card` 인자로 부를 때 쓴다 */
export async function cardRunsForApp(appSlug: string): Promise<CardRun[]> {
  if (!SLUG_RE.test(appSlug)) return [];
  const rows = await prisma.factoryCard.findMany({ where: { appSlug, enabled: true }, orderBy: { createdAt: "asc" } });
  const runs = await Promise.all(rows.map(runOf));

  return runs.filter((r): r is CardRun => !!r);
}

/** 일감 등록 때 카드 이름·id → 카드 한 장(켜진 것만) + 그 방법에 필요한 키 이름 */
export async function resolveCardForEnqueue(appSlug: string, ref: unknown): Promise<{ ok: true; id: string; name: string; secrets: string[] } | { ok: false; message: string }> {
  const row = await findCardRow(appSlug, ref);

  if (!row) {
    const names = (await prisma.factoryCard.findMany({ where: { appSlug }, select: { name: true }, take: 30 })).map((c) => c.name);

    return { ok: false, message: `${appSlug} 에 '${cardRef(ref) || "(이름 없음)"}' 카드가 없어요. 있는 카드: ${names.length ? names.join(", ") : "없음"}` };
  }
  if (!row.enabled) return { ok: false, message: `'${row.name}' 카드는 꺼져 있어요(통제실에서 켜야 써요).` };
  if (!(await runOf(row))) return { ok: false, message: `'${row.name}' 카드의 설정을 만들지 못했어요. 카드를 다시 저장해 보세요.` };
  const tools = await readManifestTools();
  const manifest = tools[row.tool];

  return { ok: true, id: row.id, name: row.name, secrets: manifest && row.method ? methodSecrets(manifest, row.method) : [] };
}
