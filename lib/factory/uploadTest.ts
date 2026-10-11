// lib/factory/uploadTest.ts
// 통제실 '업로드 시험': 사람이 버튼을 누르면 작업 PC 감독 프로그램이 /next 의 uploadTest 를 받아, 운영과 같은 경로
// (PC → 홈페이지 /api/factory/upload-test → 업로드 서버 /upload/single, store-video·store-image 와 같은 전달 코드)로 시험 파일을 올린다.
// 결과는 앱 데이터가 아니라 FactorySetting 한 줄(JSON)에 종류별 마지막 시험만 남긴다(마이그레이션 없음).
// 업로드 서버에는 삭제 API 가 없어 시험 파일은 남는다(주소를 아는 사람만 볼 수 있음).
import { randomBytes } from "node:crypto";

import prisma from "@/lib/prisma";
import { maskSecrets } from "@/lib/factory/mask";

export const UPLOAD_TEST_KINDS = ["video", "image", "big"] as const;
export type UploadTestKind = (typeof UPLOAD_TEST_KINDS)[number];
export const isUploadTestKind = (v: unknown): v is UploadTestKind => typeof v === "string" && (UPLOAD_TEST_KINDS as readonly string[]).includes(v);

const KEY = "uploadTest";
const STALE_MS = 3 * 60 * 1000; // 이 안에 결과가 없으면 '응답 없음'(큰 파일 시험은 받은 뒤 15분까지 기다림)
const BIG_STALE_MS = 20 * 60 * 1000;

export interface UploadTestStep {
  label: string; // 예: "시험 영상 2초", "50MB"
  bytes: number;
  ms: number | null;
  status: number; // PC 가 받은 HTTP 상태(0 = 연결 실패)
  ok: boolean;
  url: string | null; // 업로드 서버의 공개 주소
  message: string | null;
  stage: "pc" | "receive" | "upstream" | null; // 실패 구간: pc(PC→홈페이지, nginx 포함) / receive(홈페이지가 끝까지 못 받음) / upstream(홈페이지→업로드 서버)
  upstreamStatus: number | null;
}

export interface UploadTestReport {
  id: string;
  kind: UploadTestKind;
  at: string;
  synthetic: boolean; // 합성 파일(재생 안 됨)
  note: string | null;
  steps: UploadTestStep[];
}

interface State {
  current: { id: string; kind: UploadTestKind; requestedAt: string; takenAt: string | null } | null;
  last: Partial<Record<UploadTestKind, UploadTestReport>>;
}

async function read(): Promise<State> {
  const row = await prisma.factorySetting.findUnique({ where: { key: KEY } });

  try {
    const v = row ? (JSON.parse(row.value) as State) : null;

    return { current: v?.current ?? null, last: v?.last ?? {} };
  } catch {
    return { current: null, last: {} };
  }
}

async function write(s: State) {
  const value = JSON.stringify(s);

  await prisma.factorySetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}

const stale = (c: NonNullable<State["current"]>) => Date.now() - Date.parse(c.takenAt ?? c.requestedAt) > (c.kind === "big" && c.takenAt ? BIG_STALE_MS : STALE_MS);

/** 화면용 */
export async function uploadTestState() {
  const s = await read();

  return { current: s.current ? { ...s.current, stale: stale(s.current) } : null, last: s.last };
}

/** [시험 올리기]: 진행 중인 시험이 있으면(응답 없음이 아니면) 거절 */
export async function requestUploadTest(kind: unknown): Promise<{ ok: boolean; status: number; message: string }> {
  if (!isUploadTestKind(kind)) return { ok: false, status: 400, message: "시험 종류는 video, image, big 중 하나예요." };
  const s = await read();

  if (s.current && !stale(s.current)) return { ok: false, status: 409, message: "다른 업로드 시험이 진행 중이에요. 끝난 뒤 다시 누르세요." };
  s.current = { id: randomBytes(8).toString("hex"), kind, requestedAt: new Date().toISOString(), takenAt: null };
  await write(s);

  return { ok: true, status: 200, message: "업로드 시험을 요청했어요. 작업 PC 가 15초 안에 가져가 실제 경로로 올려요." };
}

/** /next 에서: 아직 안 가져간 시험이면 가져감 표시하고 돌려준다. 던지지 않는다 */
export async function consumeUploadTest(): Promise<{ id: string; kind: UploadTestKind } | null> {
  try {
    const s = await read();

    if (!s.current || s.current.takenAt || stale(s.current)) return null;
    s.current.takenAt = new Date().toISOString();
    await write(s);

    return { id: s.current.id, kind: s.current.kind };
  } catch {
    return null;
  }
}

/** upload-test 라우트: 지금 진행 중인 시험인지(id·종류) */
export async function uploadTestActive(id: unknown, kind: UploadTestKind | "video-file" | "image-file"): Promise<boolean> {
  const s = await read();
  const want = kind === "video-file" ? ["video", "big"] : kind === "image-file" ? ["image"] : [kind];

  return !!s.current && s.current.id === id && !!s.current.takenAt && want.includes(s.current.kind);
}

const str = (v: unknown, max: number) => (typeof v === "string" ? maskSecrets(v.replace(/[\u0000-\u001f\u007f]/g, " ")).slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/** 감독 프로그램이 보낸 시험 결과(지금 진행 중인 시험만) */
export async function receiveUploadTestReport(body: unknown): Promise<{ ok: boolean; status: number; message: string }> {
  const r = (body ?? {}) as Record<string, unknown>;
  const s = await read();

  if (!s.current || s.current.id !== r.id) return { ok: false, status: 409, message: "진행 중인 업로드 시험이 아니에요." };
  const kind = s.current.kind;
  const steps: UploadTestStep[] = (Array.isArray(r.steps) ? r.steps : []).slice(0, 10).map((x: Record<string, unknown>) => ({
    label: str(x?.label, 60) ?? "",
    bytes: num(x?.bytes) ?? 0,
    ms: num(x?.ms),
    status: num(x?.status) ?? 0,
    ok: x?.ok === true,
    url: typeof x?.url === "string" && /^https?:\/\//.test(x.url) ? x.url.slice(0, 500) : null,
    message: str(x?.message, 400),
    stage: x?.stage === "pc" || x?.stage === "receive" || x?.stage === "upstream" ? x.stage : null,
    upstreamStatus: num(x?.upstreamStatus),
  }));

  s.last[kind] = { id: s.current.id, kind, at: new Date().toISOString(), synthetic: r.synthetic === true, note: str(r.note, 500), steps };
  s.current = null;
  await write(s);

  return { ok: true, status: 200, message: "업로드 시험 결과를 저장했어요." };
}
