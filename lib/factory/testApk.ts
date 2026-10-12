// lib/factory/testApk.ts
// 출시 패키지 '시험용 APK'(출시 일감 종류 apk): 서명된 release APK 를 실기기 시험용으로 통제실에서 내려받는다.
// - 감독 프로그램이 앱 폴더에서 만든 APK 를 검사(apksigner verify, 등록된 키와 서명 인증서 비교)한 뒤 조각(TEST_APK_CHUNK, 기본 512KB)으로 올린다(워커 토큰).
// - 공개 업로드 서버(주소만 알면 누구나 받음, 삭제 API 없음)가 아니라 DB 에 둔다: 관리자만 내려받고, 앱당 다 받은 것 최근 5개만 남긴다.
// - 서명 키 파일·비밀번호는 여기 오지 않는다(서명 인증서 지문만, 공개 정보).
import { createHash } from "node:crypto";

import prisma from "@/lib/prisma";

export const TEST_APK_MAX = 200 * 1024 * 1024;
// 조각 크기는 이 상수 하나로 정한다(시작 응답 chunkSize 로 감독 프로그램에 알려 주고, APK 마다 저장해 받을 때 그 값으로 검사).
// nginx 의 `location /` 기본 본문 한도(client_max_body_size 1m)를 넘지 않게 512KB. 키우려면 nginx 에 이 주소 한도를 먼저 올린다.
export const TEST_APK_CHUNK = 512 * 1024;
// 조각 하나로 받을 수 있는 최대(예전 8MB 조각으로 시작한 것도 받게). 실제 크기 검사는 APK 마다 저장한 chunkSize 로 한다.
export const TEST_APK_CHUNK_MAX = 8 * 1024 * 1024;
export const TEST_APK_KEEP = 5;
// 받다가 끊긴(다 못 받은) APK 는 이 시간이 지나면 지운다
const STALE_MS = 6 * 60 * 60 * 1000;
// 시험용 APK 를 만들 수 있는 앱 종류(지금은 Flutter 만)
export const APK_STACKS = ["flutter"];

type Res = { ok: boolean; status: number; message: string };
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export const apkStackSupported = (stack: string | null | undefined) => APK_STACKS.includes(stack ?? "");

// ───────── 준비 조건 (출시 카드의 시험용 APK 영역, 일감 등록 때 서버도 다시 확인) ─────────

export interface ApkReadyItem {
  label: string;
  ok: boolean | null; // true ✅ / false ⬜(부족: 요청 막음) / null ⏳(확인 전: 막지 않음)
  note?: string | null;
}

/**
 * 시험용 APK 를 요청하려면: 배포 계정, 패키지 이름, 쓸 서명 키(앱 자체 key.properties 또는 보관함 키)와 비밀번호·키 파일, 지원하는 앱 종류.
 * 첫 출시·스토어 수정·앱 업데이트의 조건(서비스 계정·최초 업로드)과는 따로다.
 */
export function apkReadiness(r: {
  stack: string | null;
  accountLabel: string | null;
  packageName: string | null;
  key: { name: string | null; path: string; source: string } | null;
  keyPassword: string; // none | waiting | delivered
  keyFileExists: boolean | null;
  ownKeyProperties: boolean;
}): ApkReadyItem[] {
  const items: ApkReadyItem[] = [
    {
      label: "앱 종류",
      ok: apkStackSupported(r.stack),
      note: apkStackSupported(r.stack) ? "Flutter" : `${r.stack ?? "?"} 앱은 아직 미지원(지금은 Flutter 만)`,
    },
    { label: "배포 계정 선택", ok: !!r.accountLabel, note: r.accountLabel ? `계정 ${r.accountLabel}` : "카드에서 계정을 골라 [저장]" },
    { label: "패키지 이름", ok: !!r.packageName, note: r.packageName ?? "카드에서 패키지 이름을 넣고 [저장]" },
  ];

  if (r.ownKeyProperties) {
    items.push({ label: "서명 키", ok: true, note: "앱 자체 key.properties 의 키를 그대로 써요" });

    return items;
  }
  items.push({
    label: "서명 키",
    ok: !!r.key,
    note: r.key ? `${r.key.name ?? r.key.path}${r.key.source === "custom" ? "(이 앱에 고른 키)" : "(계정 기본 키)"}` : "키 없음: 설정 → 키 보관함에서 키를 만들거나 등록하고, 계정 기본 키나 이 앱의 키로 고르세요",
  });
  if (r.key) {
    items.push(
      r.keyPassword !== "none"
        ? { label: "키 비밀번호", ok: true, note: r.keyPassword === "delivered" ? "작업 PC 에 저장됨" : "작업 PC 가 가져가기 대기" }
        : { label: "키 비밀번호", ok: false, note: "설정 → 키 보관함에서 이 키의 비밀번호를 등록하세요" },
      {
        label: "키 파일 있음",
        ok: r.keyFileExists,
        note: r.keyFileExists === null ? "아직 조회하지 않았어요([🔍 조회])" : r.keyFileExists ? null : `파일이 없어요: ${r.key.path}`,
      },
    );
  }

  return items;
}

// ───────── 받기 (감독 프로그램 → /api/factory/test-apk) ─────────

const safeName = (v: string) =>
  v
    .replace(/[^0-9A-Za-z._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/_+/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 60) || "x";

/** 내려받기 파일 이름: <앱>-<버전>-<빌드 시각>.apk (영문·숫자·._- 만) */
export function apkFileName(appSlug: string, versionName: string | null, builtAt: Date | null): string {
  const t = (builtAt ?? new Date()).toISOString().replace(/[-:]/g, "").slice(0, 13); // 20261013T0912
  const v = versionName ? safeName(versionName) : "test";

  return `${safeName(appSlug)}-${v}-${t}.apk`;
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : null);

/**
 * 올리기 시작: 실행 중인 시험용 APK 일감만. 크기·SHA-256·버전 등 정보를 먼저 받고 apkId 를 돌려준다(이 일감이 받다 만 것은 지움).
 * body: { jobId, size, sha256, versionName?, versionCode?, builtAt?, gitCommit?, signerSha256?, keyLabel? }
 */
export async function startTestApk(body: Record<string, unknown>): Promise<Res & { apkId?: string; chunkSize?: number; count?: number }> {
  const jobId = typeof body.jobId === "string" && ID_RE.test(body.jobId) ? body.jobId : null;

  if (!jobId) return { ok: false, status: 400, message: "jobId 가 올바르지 않아요." };
  const job = await prisma.factoryJob.findUnique({ where: { id: jobId }, select: { appSlug: true, kind: true, status: true, releaseKind: true } });

  if (!job || job.kind !== "release" || job.releaseKind !== "apk") return { ok: false, status: 404, message: "없는 시험용 APK 일감이에요." };
  if (job.status !== "running") return { ok: false, status: 409, message: `지시가 실행 중이 아닙니다(${job.status}).` };
  const size = body.size;

  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return { ok: false, status: 400, message: "size 가 올바르지 않아요." };
  if (size > TEST_APK_MAX) return { ok: false, status: 413, message: `APK 는 ${TEST_APK_MAX / 1024 / 1024}MB 이하여야 해요.` };
  const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";

  if (!HEX64.test(sha256)) return { ok: false, status: 400, message: "sha256 이 올바르지 않아요." };
  const signer = typeof body.signerSha256 === "string" ? body.signerSha256.toLowerCase().replace(/:/g, "") : null;
  const builtAtRaw = typeof body.builtAt === "string" ? new Date(body.builtAt) : null;
  const builtAt = builtAtRaw && !Number.isNaN(builtAtRaw.getTime()) ? builtAtRaw : null;
  const versionName = str(body.versionName, 40);
  const versionCode = typeof body.versionCode === "number" && Number.isInteger(body.versionCode) && body.versionCode >= 0 ? body.versionCode : null;
  const count = Math.ceil(size / TEST_APK_CHUNK);

  await prisma.factoryTestApk.deleteMany({ where: { jobId, complete: false } });
  const row = await prisma.factoryTestApk.create({
    data: {
      appSlug: job.appSlug,
      jobId,
      fileName: apkFileName(job.appSlug, versionName, builtAt),
      size,
      sha256,
      versionName,
      versionCode,
      builtAt,
      gitCommit: str(body.gitCommit, 60),
      signerSha256: signer && HEX64.test(signer) ? signer : null,
      keyLabel: str(body.keyLabel, 80),
      chunkCount: count,
      chunkSize: TEST_APK_CHUNK,
    },
    select: { id: true },
  });

  return { ok: true, status: 200, message: `APK 받기를 시작해요(${count}조각).`, apkId: row.id, chunkSize: TEST_APK_CHUNK, count };
}

/** 조각 하나 받기. 마지막 조각까지 받으면 SHA-256 을 다시 재서 맞을 때만 complete, 그 뒤 앱당 최근 5개만 남긴다 */
export async function receiveTestApkChunk(apkId: string, idx: number, data: Uint8Array): Promise<Res & { complete?: boolean }> {
  if (!ID_RE.test(apkId)) return { ok: false, status: 400, message: "apkId 가 올바르지 않아요." };
  const apk = await prisma.factoryTestApk.findUnique({ where: { id: apkId } });

  if (!apk) return { ok: false, status: 404, message: "시작하지 않은 APK 예요. 처음부터 다시 보내 주세요." };
  if (apk.complete) return { ok: false, status: 409, message: "이미 다 받은 APK 예요." };
  const job = await prisma.factoryJob.findUnique({ where: { id: apk.jobId }, select: { status: true } });

  if (job?.status !== "running") return { ok: false, status: 409, message: `지시가 실행 중이 아닙니다(${job?.status ?? "없음"}).` };
  if (!Number.isInteger(idx) || idx < 0 || idx >= apk.chunkCount) return { ok: false, status: 400, message: "조각 번호가 올바르지 않아요." };
  const expect = idx === apk.chunkCount - 1 ? apk.size - idx * apk.chunkSize : apk.chunkSize;

  if (data.length !== expect) return { ok: false, status: 400, message: `조각 크기가 맞지 않아요(${data.length}/${expect}).` };
  await prisma.factoryTestApkChunk.upsert({
    where: { apkId_idx: { apkId, idx } },
    create: { apkId, idx, data: new Uint8Array(data) },
    update: { data: new Uint8Array(data) },
  });
  const received = await prisma.factoryTestApkChunk.count({ where: { apkId } });

  if (received < apk.chunkCount) {
    await prisma.factoryTestApk.update({ where: { id: apkId }, data: { received } });

    return { ok: true, status: 200, message: `조각 ${idx + 1}/${apk.chunkCount} 받음`, complete: false };
  }
  // 다 받음: 조각을 차례로 읽어 SHA-256 확인(한 번에 한 조각만 메모리에)
  const hash = createHash("sha256");
  let total = 0;

  for (let i = 0; i < apk.chunkCount; i++) {
    const c = await prisma.factoryTestApkChunk.findUnique({ where: { apkId_idx: { apkId, idx: i } }, select: { data: true } });

    if (!c) return { ok: false, status: 409, message: `조각 ${i + 1} 이 없어요. 처음부터 다시 보내 주세요.` };
    hash.update(c.data);
    total += c.data.length;
  }
  const digest = hash.digest("hex");

  if (total !== apk.size || digest !== apk.sha256) {
    await prisma.factoryTestApk.delete({ where: { id: apkId } });

    return { ok: false, status: 422, message: "받은 APK 의 크기·SHA-256 이 맞지 않아 지웠어요. 처음부터 다시 보내 주세요." };
  }
  await prisma.factoryTestApk.update({ where: { id: apkId }, data: { received, complete: true } });
  const removed = await pruneTestApks(apk.appSlug);

  return { ok: true, status: 200, message: `APK 를 다 받았어요(SHA-256 확인)${removed ? `. 오래된 APK ${removed}개 정리` : ""}.`, complete: true };
}

/** 이 기능이 만든 것만 정리: 앱의 다 받은 APK 는 최근 5개만, 받다 만 것은 6시간 지나면. 지운 개수 */
export async function pruneTestApks(appSlug: string, keep = TEST_APK_KEEP): Promise<number> {
  const done = await prisma.factoryTestApk.findMany({ where: { appSlug, complete: true }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const old = done.slice(keep).map((r) => r.id);
  const a = old.length ? await prisma.factoryTestApk.deleteMany({ where: { id: { in: old } } }) : { count: 0 };
  const b = await prisma.factoryTestApk.deleteMany({ where: { appSlug, complete: false, createdAt: { lt: new Date(Date.now() - STALE_MS) } } });

  return a.count + b.count;
}

// ───────── 통제실 ─────────

export interface TestApkInfo {
  id: string;
  fileName: string;
  size: number;
  sha256: string;
  versionName: string | null;
  versionCode: number | null;
  builtAt: Date | null;
  gitCommit: string | null;
  signerSha256: string | null;
  keyLabel: string | null;
  createdAt: Date;
}

/** 앱별 다 받은 APK(최신순 최대 5개). 내용(조각)은 읽지 않는다 */
export async function listTestApks(appSlugs: string[]): Promise<Map<string, TestApkInfo[]>> {
  const out = new Map<string, TestApkInfo[]>();

  if (appSlugs.length === 0) return out;
  const rows = await prisma.factoryTestApk.findMany({
    where: { appSlug: { in: appSlugs }, complete: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      appSlug: true,
      fileName: true,
      size: true,
      sha256: true,
      versionName: true,
      versionCode: true,
      builtAt: true,
      gitCommit: true,
      signerSha256: true,
      keyLabel: true,
      createdAt: true,
    },
  });

  for (const { appSlug, ...r } of rows) {
    const list = out.get(appSlug) ?? [];

    if (list.length < TEST_APK_KEEP) list.push(r);
    out.set(appSlug, list);
  }

  return out;
}

/**
 * 관리자 내려받기: 다 받은 APK 를 조각 순서대로 흘려 보내는 스트림(한 번에 한 조각만 읽음). 없으면 null.
 * 호출하는 쪽(관리자 라우트)이 관리자 확인을 먼저 한다.
 */
export async function openTestApk(id: string): Promise<{ fileName: string; size: number; stream: ReadableStream<Uint8Array> } | null> {
  if (!ID_RE.test(id)) return null;
  const apk = await prisma.factoryTestApk.findUnique({ where: { id }, select: { id: true, fileName: true, size: true, chunkCount: true, complete: true } });

  if (!apk || !apk.complete) return null;
  let idx = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (idx >= apk.chunkCount) return controller.close();
      const c = await prisma.factoryTestApkChunk.findUnique({ where: { apkId_idx: { apkId: apk.id, idx } }, select: { data: true } });

      if (!c) return controller.error(new Error("APK 조각이 없어요."));
      idx += 1;
      controller.enqueue(new Uint8Array(c.data));
    },
  });

  return { fileName: apk.fileName.replace(/[^0-9A-Za-z._-]/g, "_"), size: apk.size, stream };
}
