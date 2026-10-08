// Claude 커스텀 커넥터용 MCP 엔드포인트 (Streamable HTTP, 무상태 JSON 응답)
// 인증: Authorization: Bearer <DRAFT_API_TOKEN> 또는 X-API-Key: <DRAFT_API_TOKEN> (커넥터의 "Request headers")
import { NextRequest, NextResponse } from "next/server";

import { isValidDraftToken } from "@/lib/drafts/auth";
import { handleRpc } from "@/lib/drafts/mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 300_000;

export async function POST(request: NextRequest) {
  // 인증: Authorization: Bearer <토큰> 또는 X-API-Key: <토큰> (둘 중 하나만 맞으면 통과)
  const authorization = request.headers.get("authorization");
  const apiKey = request.headers.get("x-api-key");
  const ok =
    isValidDraftToken(authorization) || (!!apiKey && isValidDraftToken(`Bearer ${apiKey.trim()}`));

  if (!ok) {
    // 연결 문제를 찾기 위한 진단 로그. 토큰 값은 남기지 않고, 헤더가 왔는지/모양/길이만 기록한다.
    const expectedLen = process.env.DRAFT_API_TOKEN?.length ?? 0;
    console.warn("[mcp] 인증 실패", {
      authorizationHeader: authorization === null ? "없음" : "있음",
      scheme: authorization ? authorization.split(" ")[0] : null,
      valueLength: authorization ? authorization.split(" ").slice(1).join(" ").length : null,
      xApiKeyHeader: apiKey === null ? "없음" : `있음(길이 ${apiKey.length})`,
      serverTokenLength: expectedLen,
      userAgent: request.headers.get("user-agent"),
    });
    return NextResponse.json({ message: "권한이 없습니다." }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json({ message: "요청이 너무 커요." }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  const { status, body } = await handleRpc(payload);
  if (body === undefined) return new NextResponse(null, { status });
  return NextResponse.json(body, { status });
}

// 서버가 먼저 보내는 스트림/세션 종료는 지원하지 않는다
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
