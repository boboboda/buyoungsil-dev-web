// app/api/studio-requests/route.ts
// Studio(게임 소품 도구)가 보내는 요청으로 '승인 대기' 앱 일감을 만든다. docs/studio-access.md
// - 인증: Authorization: Basic 의 비밀번호 칸 = Studio 접근 키(앱 이름 studio). 검증·실패 제한은 /api/studio-auth/verify 와 같은 규칙.
// - 브라우저가 아니라 app-kit 서버가 호출한다(사용자의 Authorization 헤더를 그대로 전달). CORS 는 열지 않는다(OPTIONS 도 없음).
// - 자동 승인 없음: 일감은 늘 '승인 대기'. 키·헤더·본문 값은 로그·응답·감사 기록에 남기지 않는다.
import { NextRequest, NextResponse } from "next/server";

import {
  basicPassword,
  createFailLimiter,
  studioClientIp,
  verifyStudioKeyId,
} from "@/lib/studio/access";
import {
  MAX_BODY_BYTES,
  STUDIO_REQUEST_APP,
  auditStudioRequest,
  createStudioRequestJob,
  parseStudioRequest,
  rateLimited,
} from "@/lib/studio/requests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = createFailLimiter();
const NO_STORE = { "Cache-Control": "no-store" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const reply = (
  status: number,
  error: string,
  extra: Record<string, string> = {},
) =>
  NextResponse.json(
    { ok: false, error },
    { status, headers: { ...NO_STORE, ...extra } },
  );

export async function POST(req: NextRequest) {
  const get = (n: string) => req.headers.get(n);
  const ip = studioClientIp(get);
  const blocked = limiter.blockedFor(ip);

  if (blocked > 0)
    return reply(429, "잠시 막혔어요. 나중에 다시 시도하세요.", {
      "Retry-After": String(Math.ceil(blocked / 1000)),
    });

  // 인증 실패는 이유를 구별하지 않는다(WWW-Authenticate 없음)
  const header = get("authorization");
  const key = basicPassword(header);
  let keyId: string | null = null;

  try {
    keyId =
      key !== null ? await verifyStudioKeyId(STUDIO_REQUEST_APP, key) : null;
  } catch {
    console.error("[studio] 요청 키 확인 중 오류"); // 오류 객체에 값이 섞일 수 있어 남기지 않는다
    return reply(503, "지금은 처리할 수 없어요.");
  }
  if (!keyId) {
    const slow = header === null ? 0 : limiter.fail(ip, STUDIO_REQUEST_APP);

    if (slow) await sleep(slow);

    return reply(401, "인증에 실패했어요.");
  }

  const audit = (
    kind: string,
    appSlug: string,
    result: string,
    jobId?: string,
  ) =>
    auditStudioRequest({
      keyId: keyId as string,
      kind,
      appSlug,
      result,
      jobId,
    });

  try {
    if (await rateLimited(keyId)) {
      await audit("?", "?", "rate_limited");

      return reply(429, "요청이 너무 많아요. 1분 뒤에 다시 보내세요.", {
        "Retry-After": "60",
      });
    }
    const length = Number(get("content-length") ?? "0");

    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      await audit("?", "?", "invalid");

      return reply(413, "요청이 너무 커요(64KB 이하).");
    }
    const text = await req.text();

    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      await audit("?", "?", "invalid");

      return reply(413, "요청이 너무 커요(64KB 이하).");
    }
    let raw: unknown;

    try {
      raw = JSON.parse(text);
    } catch {
      await audit("?", "?", "invalid");

      return reply(400, "요청 본문이 JSON 이 아니에요.");
    }
    const parsed = parseStudioRequest(raw);

    if ("error" in parsed) {
      const o = (raw ?? {}) as Record<string, unknown>;
      const kind =
        o.kind === "regen" || o.kind === "layout" || o.kind === "split"
          ? o.kind
          : "?";
      const slug =
        typeof o.appSlug === "string" && /^[a-z0-9-]{3,40}$/.test(o.appSlug)
          ? o.appSlug
          : "?";

      await audit(kind, slug, "invalid");

      return reply(400, parsed.error);
    }
    const r = await createStudioRequestJob(parsed.value);

    await audit(
      parsed.value.kind,
      parsed.value.appSlug,
      r.result,
      r.status === 201 ? r.jobId : undefined,
    );

    return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
  } catch {
    console.error("[studio] 요청 처리 중 오류"); // 오류 객체에 값이 섞일 수 있어 남기지 않는다
    await audit("?", "?", "error");

    return reply(500, "요청을 처리하지 못했어요. 잠시 뒤 다시 시도하세요.");
  }
}
