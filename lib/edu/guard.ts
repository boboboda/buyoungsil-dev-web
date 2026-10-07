// lib/edu/guard.ts
// edu(특수교육 도구함) 사이트 서버 전용 API 공통 도구.
// - x-edu-key 헤더 확인 (환경변수 EDU_API_KEY)
// - 비밀번호 해시 / 확인 (Node 기본 crypto 의 scrypt)
// - 메모리 기반 요청 횟수 제한
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "crypto";

import { NextRequest, NextResponse } from "next/server";

const scrypt = (
  password: string,
  salt: Uint8Array,
  keylen: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });

export const EDU_BOARDS = ["request", "contact"] as const;
export type EduBoard = (typeof EDU_BOARDS)[number];

export const isEduBoard = (value: unknown): value is EduBoard =>
  typeof value === "string" &&
  (EDU_BOARDS as readonly string[]).includes(value);

export const fail = (status: number, message: string) =>
  NextResponse.json({ message }, { status });

// 길이 정보가 새지 않도록 SHA-256 으로 맞춘 뒤 비교
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();

  return timingSafeEqual(new Uint8Array(ha), new Uint8Array(hb));
}

// 통과하면 null, 막아야 하면 응답을 돌려준다.
export function checkEduKey(req: NextRequest): NextResponse | null {
  const key = process.env.EDU_API_KEY;

  if (!key || key.length < 24) {
    console.error("[edu-api] EDU_API_KEY 가 설정되지 않았거나 너무 짧습니다.");

    return fail(503, "서비스를 사용할 수 없습니다.");
  }

  const provided = req.headers.get("x-edu-key") ?? "";

  if (!safeEqual(provided, key)) return fail(401, "권한이 없습니다.");

  return null;
}

// edu 서버가 방문자 IP 를 x-edu-client-ip 로 넘겨준다 (키 검사를 통과한 요청만 신뢰).
export function getEduClientIp(req: NextRequest): string {
  const ip = req.headers.get("x-edu-client-ip")?.trim();

  return ip ? ip.slice(0, 64) : "unknown";
}

// ---------------------------------------------------------------------------
// 비밀번호
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, new Uint8Array(salt), 32);

  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");

  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(
    password,
    new Uint8Array(Buffer.from(saltHex, "hex")),
    expected.length,
  );

  return (
    actual.length === expected.length &&
    timingSafeEqual(new Uint8Array(actual), new Uint8Array(expected))
  );
}

// ---------------------------------------------------------------------------
// 요청 횟수 제한 (서버 메모리, 재시작하면 초기화됨)
// ---------------------------------------------------------------------------

const counters = new Map<string, { start: number; count: number }>();

export function isRateLimited(
  id: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();

  if (counters.size > 5000) {
    for (const [k, v] of counters) {
      if (now - v.start > windowMs) counters.delete(k);
    }
  }

  const entry = counters.get(id);

  if (!entry || now - entry.start > windowMs) {
    counters.set(id, { start: now, count: 1 });

    return false;
  }

  entry.count += 1;

  return entry.count > limit;
}

// ---------------------------------------------------------------------------
// 입력 정리
// ---------------------------------------------------------------------------

// 문자열이 아니면 null. 앞뒤 공백 제거, 줄바꿈 통일, 제어문자 제거.
export function cleanText(value: unknown, multiline = false): string | null {
  if (typeof value !== "string") return null;

  let text = value.replace(/\r\n?/g, "\n");

  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

  if (!multiline) text = text.replace(/\n/g, " ");

  return text.trim();
}

// ---------------------------------------------------------------------------
// 응답 모양 (passwordHash 는 절대 내보내지 않는다)
// ---------------------------------------------------------------------------

type PostRow = {
  id: string;
  board: string;
  nickname: string;
  title: string;
  content: string;
  isSecret: boolean;
  status: string;
  createdAt: Date;
  replies: { id: string; content: string; createdAt: Date }[];
};

export function toFullPost(post: PostRow) {
  return {
    id: post.id,
    board: post.board,
    nickname: post.nickname,
    title: post.title,
    content: post.content,
    isSecret: post.isSecret,
    status: post.status,
    createdAt: post.createdAt.toISOString(),
    locked: false,
    replies: post.replies.map((r) => ({
      id: r.id,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export function toLockedPost(post: PostRow) {
  return {
    id: post.id,
    board: post.board,
    nickname: post.nickname,
    title: post.title,
    isSecret: post.isSecret,
    status: post.status,
    createdAt: post.createdAt.toISOString(),
    locked: true,
  };
}
