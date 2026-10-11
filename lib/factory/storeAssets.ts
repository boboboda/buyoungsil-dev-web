// lib/factory/storeAssets.ts
// 앱 공장 출시 2단계: 스토어 자료(앱 폴더 .factory/store/)와 홍보 영상 링크.
// - 기준 파일은 PC 에만 있다. 서버에는 감독 프로그램이 검사한 결과(단계별 상태·경로·크기·길이)와
//   고정된 이미지 칸(아이콘, 대표 이미지, 폰 스크린샷 png/jpg)만 올라온다. 영상 원본은 PC 에 두고, 검토용 사본(mp4)만
//   store-video 라우트가 이미지와 같은 업로드 서버에 올려 그 주소(reviewVideo)를 저장한다.
// - 홍보 영상은 사람이 YouTube 에 직접 올리고 링크만 저장한다(YouTube API 를 쓰지 않음).
import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { maskSecrets } from "@/lib/factory/mask";

// lib/factory/release.ts 의 releaseKindOf 와 같다(서로 가져오지 않게 따로 둔다)
const releaseKindOf = (v: string | null | undefined) => (v === "store" || v === "update" || v === "project" ? v : "first");

// 서버로 올릴 수 있는 이미지 칸. 이름·크기·형식이 고정돼 있다(감독 프로그램 store.mjs 의 STORE_SLOTS 와 같다)
export const STORE_IMAGE_SLOTS: Record<string, { maxBytes: number; label: string }> = {
  icon: { maxBytes: 1024 * 1024, label: "아이콘 512x512" },
  feature: { maxBytes: 10 * 1024 * 1024, label: "대표 이미지 1024x500" },
  ...Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`phone-0${i + 1}`, { maxBytes: 8 * 1024 * 1024, label: `폰 스크린샷 ${i + 1}` }]),
  ),
};
export const STORE_IMAGE_TYPES = ["image/png", "image/jpeg"];

// 스토어 자료 단계(.factory/phase.txt 와 실패 단계로도 쓴다)
export const STORE_STAGES = ["icon", "screenshots", "video", "listing", "upload", "homepage"] as const;
const STAGE_STATUSES = ["ok", "skipped", "failed"] as const;

// ───────── 홍보 영상 링크 ─────────

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** youtube.com/watch?v=ID, youtu.be/ID 만 받아 https://www.youtube.com/watch?v=ID 로 맞춘다. 아니면 null */
export function normalizeYoutubeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let u: URL;

  try {
    u = new URL(v.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  let id: string | null = null;

  if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host) && u.pathname === "/watch") id = u.searchParams.get("v");
  else if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] || null;

  return id && YT_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

export async function savePromoVideoUrl(appSlug: string, raw: unknown): Promise<{ ok: boolean; status: number; message: string }> {
  const hasJob = await prisma.factoryJob.findFirst({ where: { appSlug }, select: { id: true } });

  if (!hasJob) return { ok: false, status: 404, message: "그런 공장 앱이 없어요." };
  const empty = raw === null || (typeof raw === "string" && !raw.trim());
  const url = empty ? null : normalizeYoutubeUrl(raw);

  if (!empty && !url) {
    return { ok: false, status: 400, message: "YouTube 링크만 넣을 수 있어요(https://www.youtube.com/watch?v=… 또는 https://youtu.be/…)." };
  }
  await prisma.factoryApp.upsert({ where: { appSlug }, create: { appSlug, promoVideoUrl: url }, update: { promoVideoUrl: url } });

  return { ok: true, status: 200, message: url ? "홍보 영상 링크를 저장했어요. 다음 '스토어 자료 수정' 업로드 때 Play 등록정보에 들어가요." : "홍보 영상 링크를 지웠어요." };
}

// ───────── 저장 모양 ─────────

export interface StoreStage {
  status: (typeof STAGE_STATUSES)[number];
  note: string | null;
}
export interface StoreImage {
  width: number | null;
  height: number | null;
  size: number | null;
  url: string | null; // 홈페이지 업로드 서버 주소(올린 것만)
}
export interface StoreAssets {
  at: string;
  jobId: string;
  dir: string | null; // PC 의 .factory/store 경로(표시용)
  stages: Partial<Record<(typeof STORE_STAGES)[number], StoreStage>>;
  images: Record<string, StoreImage>; // icon, feature, phone-01..08
  video: { path: string; size: number | null; durationSec: number | null } | null;
  // 검토용 홍보 영상 사본의 업로드 서버 주소(store-video 가 저장. 업로드 서버에 삭제 API 가 없어 지우지 않는다)
  reviewVideo?: { url: string; size: number; at: string } | null;
  listing: Record<string, { title: string; shortDescription: string; fullDescription: string }> | null;
  tools: string | null; // HyperFrames·에뮬레이터 확인 결과(짧은 글)
  upload: { at: string; ok: boolean; note: string; editId?: string | null; changesNotSentForReview?: boolean } | null;
  aabUpload: { at: string; ok: boolean; note: string; track: string | null; versionCode: number | null } | null;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? maskSecrets(v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")).slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export function readStoreAssets(v: unknown): StoreAssets | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as StoreAssets) : null;
}

type FoundJob =
  | { error: { status: number; message: string }; job?: undefined }
  | { error?: undefined; job: { id: string; appSlug: string; releaseKind: "first" | "store" | "update" | "project"; images: boolean; review: boolean } };
const refuse = (status: number, message: string): FoundJob => ({ error: { status, message } });

// 감독 프로그램이 보낼 수 있는 일감인지: 실행 중인 출시 일감이어야 하고, 이미지·자료는 '스토어 자료 수정' 일감만
async function runningReleaseJob(jobId: unknown): Promise<FoundJob> {
  if (typeof jobId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(jobId)) return refuse(400, "jobId 가 올바르지 않아요.");
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { id: true, appSlug: true, kind: true, status: true, releaseKind: true, updateItems: true, reviewRequired: true } });

  if (!job) return refuse(404, "없는 지시입니다.");
  if (job.kind !== "release") return refuse(400, "출시 일감만 보낼 수 있어요.");
  if (job.status !== "running") return refuse(409, `지시가 실행 중이 아닙니다(${job.status}).`);

  // images: '이미지'를 고른 일감인지(갱신 항목이 없는 예전 일감은 true)
  const images = job.updateItems.length === 0 || job.updateItems.includes("images");

  return { job: { id: job.id, appSlug: job.appSlug, releaseKind: releaseKindOf(job.releaseKind), images, review: job.reviewRequired } };
}

// 같은 일감이면 이어서 합치고, 새 일감이면 새로 시작한다(이전 일감의 올린 이미지 URL 은 남긴다: 홈페이지 cover 로 쓰고 있을 수 있음)
function baseFor(cur: StoreAssets | null, jobId: string): StoreAssets {
  if (cur && cur.jobId === jobId) return cur;

  return {
    at: new Date().toISOString(),
    jobId,
    dir: null,
    stages: {},
    images: cur?.images ?? {},
    video: null,
    reviewVideo: null,
    listing: cur?.listing ?? null,
    tools: null,
    upload: null,
    aabUpload: cur?.aabUpload ?? null,
  };
}

async function saveAssets(appSlug: string, next: StoreAssets) {
  const value = { ...next, at: new Date().toISOString() } as unknown as Prisma.InputJsonObject;

  await prisma.factoryApp.upsert({ where: { appSlug }, create: { appSlug, storeAssets: value }, update: { storeAssets: value } });
}

const LANG_RE = /^[a-z]{2,3}(-[A-Z]{2,3})?$/;

/**
 * 감독 프로그램 → POST /api/factory/store-assets
 * { jobId, dir?, stages?: {icon: {status, note}}, images?: {icon: {width, height, size}}, video?: {path, size, durationSec}|null,
 *   listing?: {"ko-KR": {title, shortDescription, fullDescription}}, tools?, upload?: {ok, note, editId?, changesNotSentForReview?},
 *   aabUpload?: {ok, note, track, versionCode} }
 * 첫 출시 일감은 aabUpload 만, 스토어 자료 수정 일감은 aabUpload 를 뺀 나머지를 보낼 수 있다. 이미지 URL 은 여기로 못 바꾼다(store-image 만).
 */
export async function receiveStoreReport(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; message: string }> {
  const found = await runningReleaseJob(body.jobId);

  if (found.error) return { ok: false, ...found.error };
  const { job } = found;
  const cur = readStoreAssets((await prisma.factoryApp.findUnique({ where: { appSlug: job.appSlug }, select: { storeAssets: true } }))?.storeAssets);
  const next = baseFor(cur, job.id);

  // 검토 단계가 있는 첫 출시 일감은 스토어 자료(검토용)를 보낼 수 있다. 그 밖의 첫 출시·앱 업데이트는 AAB 업로드 결과만
  if ((job.releaseKind === "first" && !(job.review && body.aabUpload === undefined)) || job.releaseKind === "update") {
    const a = body.aabUpload as Record<string, unknown> | undefined;

    if (!a || typeof a !== "object") return { ok: false, status: 400, message: "이 일감은 aabUpload 만 보낼 수 있어요." };
    next.aabUpload = {
      at: new Date().toISOString(),
      ok: a.ok === true,
      note: text(a.note, 1000) ?? "",
      track: text(a.track, 20),
      versionCode: num(a.versionCode),
    };
    // 첫 출시 일감은 스토어 자료를 새로 시작하지 않는다(이전 결과 유지)
    const keep = cur ? { ...cur, aabUpload: next.aabUpload } : next;

    await saveAssets(job.appSlug, keep);

    return { ok: true, status: 200, message: "AAB 업로드 결과를 저장했어요." };
  }
  if (job.releaseKind !== "store" && !(job.releaseKind === "first" && job.review)) return { ok: false, status: 400, message: "스토어 수정·첫 출시 일감만 스토어 자료를 보낼 수 있어요." };

  if (body.dir !== undefined) next.dir = text(body.dir, 300);
  if (body.tools !== undefined) next.tools = text(body.tools, 1500);
  if (body.stages && typeof body.stages === "object") {
    for (const [k, v] of Object.entries(body.stages as Record<string, unknown>)) {
      const s = v as Record<string, unknown> | null;

      if (!(STORE_STAGES as readonly string[]).includes(k) || !s || !(STAGE_STATUSES as readonly unknown[]).includes(s.status)) continue;
      next.stages[k as (typeof STORE_STAGES)[number]] = { status: s.status as StoreStage["status"], note: text(s.note, 1000) };
    }
  }
  if (body.images && typeof body.images === "object" && job.images) {
    // 이번 일감에서 확인한 이미지 칸만 남긴다(사라진 스크린샷 칸은 지움). URL 은 이미 올린 것을 유지
    const images: Record<string, StoreImage> = {};

    for (const [k, v] of Object.entries(body.images as Record<string, unknown>)) {
      if (!STORE_IMAGE_SLOTS[k] || !v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;

      images[k] = { width: num(r.width), height: num(r.height), size: num(r.size), url: next.images[k]?.url ?? null };
    }
    next.images = images;
  }
  if (body.video !== undefined) {
    const v = body.video as Record<string, unknown> | null;

    next.video = v && typeof v === "object" && typeof v.path === "string" ? { path: text(v.path, 300) ?? "", size: num(v.size), durationSec: num(v.durationSec) } : null;
  }
  if (body.listing && typeof body.listing === "object") {
    const listing: NonNullable<StoreAssets["listing"]> = {};

    for (const [lang, v] of Object.entries(body.listing as Record<string, unknown>).slice(0, 20)) {
      const r = v as Record<string, unknown> | null;

      if (!LANG_RE.test(lang) || !r || typeof r !== "object") continue;
      listing[lang] = { title: text(r.title, 60) ?? "", shortDescription: text(r.shortDescription, 160) ?? "", fullDescription: text(r.fullDescription, 8000) ?? "" };
    }
    next.listing = Object.keys(listing).length ? listing : null;
  }
  if (body.upload !== undefined) {
    const u = body.upload as Record<string, unknown> | null;

    next.upload =
      u && typeof u === "object"
        ? {
            at: new Date().toISOString(),
            ok: u.ok === true,
            note: text(u.note, 1500) ?? "",
            editId: text(u.editId, 100),
            changesNotSentForReview: u.changesNotSentForReview === true,
          }
        : null;
  }
  await saveAssets(job.appSlug, next);

  return { ok: true, status: 200, message: "스토어 자료 결과를 저장했어요." };
}

/** store-image 라우트가 업로드 서버에 올린 뒤 부른다 */
export async function saveStoreImageUrl(appSlug: string, jobId: string, slot: string, url: string) {
  const cur = readStoreAssets((await prisma.factoryApp.findUnique({ where: { appSlug }, select: { storeAssets: true } }))?.storeAssets);
  const next = baseFor(cur, jobId);
  const prev = next.images[slot];

  next.images[slot] = { width: prev?.width ?? null, height: prev?.height ?? null, size: prev?.size ?? null, url };
  await saveAssets(appSlug, next);
}

/** store-video 라우트가 업로드 서버에 올린 뒤 부른다 */
export async function saveStoreReviewVideoUrl(appSlug: string, jobId: string, url: string, size: number) {
  const cur = readStoreAssets((await prisma.factoryApp.findUnique({ where: { appSlug }, select: { storeAssets: true } }))?.storeAssets);
  const next = baseFor(cur, jobId);

  next.reviewVideo = { url, size, at: new Date().toISOString() };
  await saveAssets(appSlug, next);
}

/** store-video 라우트 앞부분: 검토 단계가 있는 출시 일감(첫 출시·스토어 수정)이 실행 중인지 */
export async function storeVideoJob(jobId: unknown): Promise<FoundJob> {
  const found = await runningReleaseJob(jobId);

  if (found.error) return found;
  if (!found.job.review) return refuse(400, "검토 단계가 있는 일감만 검토 영상을 올릴 수 있어요.");

  return found;
}

/** store-image 라우트 앞부분: 스토어 자료 수정 일감이 실행 중인지 */
export async function storeImageJob(jobId: unknown): Promise<FoundJob> {
  const found = await runningReleaseJob(jobId);

  if (found.error) return found;
  if (found.job.releaseKind !== "store" && !(found.job.releaseKind === "first" && found.job.review)) return refuse(400, "스토어 수정·첫 출시 일감만 스토어 이미지를 올릴 수 있어요.");
  if (!found.job.images) return refuse(400, "이 일감은 '이미지' 갱신을 고르지 않아서 스토어 이미지를 올릴 수 없어요.");

  return found;
}

/**
 * 홈페이지 프로젝트에 넣을 서버 쪽 값: 대표 이미지(올린 feature) → coverImage, 출시된 앱이면 Play 주소 → appLink.
 * Project 에는 영상·스크린샷 갤러리 칸이 없어서 영상 링크와 스크린샷은 넣지 않는다.
 */
export async function storeProjectValues(appSlug: string): Promise<{ coverImage?: string; appLink?: string }> {
  const app = await prisma.factoryApp.findUnique({ where: { appSlug }, select: { storeAssets: true, packageName: true, releaseStatus: true } });
  const assets = readStoreAssets(app?.storeAssets);
  const out: { coverImage?: string; appLink?: string } = {};
  const cover = assets?.images?.feature?.url;

  if (cover) out.coverImage = cover;
  if (app?.packageName && app.releaseStatus === "released") out.appLink = `https://play.google.com/store/apps/details?id=${app.packageName}`;

  return out;
}
