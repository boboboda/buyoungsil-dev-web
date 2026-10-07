// Claude 커스텀 커넥터용 MCP 엔드포인트 (Streamable HTTP, 무상태 JSON 응답)
// 인증: Authorization: Bearer <DRAFT_API_TOKEN>  (커넥터의 "Request headers" 에 넣는다)
import { NextRequest, NextResponse } from "next/server";

import { isValidDraftToken } from "@/lib/drafts/auth";
import { handleRpc } from "@/lib/drafts/mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 300_000;

export async function POST(request: NextRequest) {
  if (!isValidDraftToken(request.headers.get("authorization"))) {
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
