// lib/analytics/ingest.ts
// 앱에서 보낸 이벤트를 검증하고 저장한다.
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

export const ALLOWED_EVENTS = new Set([
  "session_start",
  "screen_view",
  "ad_load",
  "ad_load_failed",
  "ad_impression",
  "ad_click",
  "ad_paid",
  "ad_reward_earned",
  "feature_use",
]);

const MAX_EVENTS_PER_BATCH = 50;
const MAX_PARAM_KEYS = 10;
const MAX_PARAMS_BYTES = 2048;
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

type Primitive = string | number | boolean | null;
export type EventParams = Record<string, Primitive>;

export interface IngestEvent {
  id: string;
  name: string;
  ts: number | null;
  sessionId: string | null;
  params: EventParams | null;
}

export interface IngestPayload {
  installId: string;
  appVersion: string | null;
  platform: string | null;
  osVersion: string | null;
  events: IngestEvent[];
}

export type ValidateResult =
  | { ok: true; payload: IngestPayload; dropped: number }
  | { ok: false; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const cleanString = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

export const kstDate = (d: Date) =>
  new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);

function parseParams(value: unknown): EventParams | null {
  if (!isRecord(value)) return null;

  const keys = Object.keys(value);

  if (keys.length === 0 || keys.length > MAX_PARAM_KEYS) return null;

  const out: EventParams = {};

  for (const key of keys) {
    if (key.length > 40) return null;

    const v = value[key];

    if (typeof v === "string") {
      if (v.length > 200) return null;
      out[key] = v;
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) return null;
      out[key] = v;
    } else if (typeof v === "boolean") {
      out[key] = v;
    } else if (v === null) {
      out[key] = null;
    } else {
      return null;
    }
  }

  return JSON.stringify(out).length <= MAX_PARAMS_BYTES ? out : null;
}

function parseEvent(raw: unknown): IngestEvent | null {
  if (!isRecord(raw)) return null;

  const id = cleanString(raw.id, 64);
  const name = cleanString(raw.name, 40);

  if (!id || !name || !ALLOWED_EVENTS.has(name)) return null;

  const ts =
    typeof raw.ts === "number" && Number.isFinite(raw.ts) ? raw.ts : null;

  return {
    id,
    name,
    ts,
    sessionId: cleanString(raw.sessionId, 64),
    params: parseParams(raw.params),
  };
}

export function validatePayload(body: unknown): ValidateResult {
  if (!isRecord(body)) {
    return { ok: false, reason: "본문 형식이 올바르지 않습니다." };
  }

  const installId = cleanString(body.installId, 100);

  if (!installId) return { ok: false, reason: "installId가 필요합니다." };

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return { ok: false, reason: "events가 비어 있습니다." };
  }

  if (body.events.length > MAX_EVENTS_PER_BATCH) {
    return {
      ok: false,
      reason: `한 번에 최대 ${MAX_EVENTS_PER_BATCH}건까지 보낼 수 있습니다.`,
    };
  }

  const events: IngestEvent[] = [];
  let dropped = 0;

  for (const raw of body.events) {
    const event = parseEvent(raw);

    if (event) events.push(event);
    else dropped += 1;
  }

  if (events.length === 0) {
    return { ok: false, reason: "유효한 이벤트가 없습니다." };
  }

  return {
    ok: true,
    dropped,
    payload: {
      installId,
      appVersion: cleanString(body.appVersion, 40),
      platform: cleanString(body.platform, 20),
      osVersion: cleanString(body.osVersion, 40),
      events,
    },
  };
}

// 수집 키 확인. 맞는 키는 1분간 메모리에 보관해서 요청마다 DB를 조회하지 않는다.
const APP_CACHE_TTL_MS = 60_000;
const appCache = new Map<
  string,
  { at: number; app: { id: string; appId: string } }
>();

export async function findAppByKey(key: string) {
  if (key.length < 20 || key.length > 100) return null;

  const hit = appCache.get(key);

  if (hit && Date.now() - hit.at < APP_CACHE_TTL_MS) return hit.app;

  const app = await prisma.analyticsApp.findFirst({
    where: { ingestKey: key, isActive: true },
    select: { id: true, appId: true },
  });

  if (app) appCache.set(key, { at: Date.now(), app });

  return app;
}

export async function saveEvents(
  appDbId: string,
  payload: IngestPayload,
  now: Date = new Date(),
) {
  const nowMs = now.getTime();

  const rows = payload.events.map((e) => ({
    appId: appDbId,
    eventId: e.id,
    installId: payload.installId,
    sessionId: e.sessionId,
    name: e.name,
    params: e.params ?? undefined,
    appVersion: payload.appVersion,
    platform: payload.platform,
    osVersion: payload.osVersion,
    // 시각이 없거나 너무 오래됐거나 미래면 서버 수신 시각을 쓴다
    occurredAt:
      e.ts !== null && e.ts <= nowMs + MAX_FUTURE_MS && e.ts >= nowMs - MAX_PAST_MS
        ? new Date(e.ts)
        : now,
  }));

  const times = rows.map((r) => r.occurredAt.getTime());
  const minAt = new Date(Math.min(...times));
  const maxAt = new Date(Math.max(...times));

  const meta = {
    ...(payload.appVersion ? { appVersion: payload.appVersion } : {}),
    ...(payload.platform ? { platform: payload.platform } : {}),
    ...(payload.osVersion ? { osVersion: payload.osVersion } : {}),
  };

  // 앱을 연 날짜(session_start 기준)
  const activeDates = Array.from(
    new Set(
      rows.filter((r) => r.name === "session_start").map((r) => kstDate(r.occurredAt)),
    ),
  );

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.analyticsEvent.createMany({ data: rows, skipDuplicates: true }),
    prisma.analyticsInstall.upsert({
      where: { appId_installId: { appId: appDbId, installId: payload.installId } },
      create: {
        appId: appDbId,
        installId: payload.installId,
        firstSeenAt: minAt,
        lastSeenAt: maxAt,
        ...meta,
      },
      update: {},
    }),
    // 늦게 도착한 오래된 묶음이 기록을 되돌리지 않도록 조건부로 갱신
    prisma.analyticsInstall.updateMany({
      where: {
        appId: appDbId,
        installId: payload.installId,
        firstSeenAt: { gt: minAt },
      },
      data: { firstSeenAt: minAt },
    }),
    prisma.analyticsInstall.updateMany({
      where: {
        appId: appDbId,
        installId: payload.installId,
        lastSeenAt: { lt: maxAt },
      },
      data: { lastSeenAt: maxAt, ...meta },
    }),
  ];

  if (activeDates.length > 0) {
    ops.push(
      prisma.dailyActiveInstall.createMany({
        data: activeDates.map((date) => ({
          appId: appDbId,
          date,
          installId: payload.installId,
        })),
        skipDuplicates: true,
      }),
    );
  }

  const results = await prisma.$transaction(ops);

  return { saved: (results[0] as { count: number }).count };
}