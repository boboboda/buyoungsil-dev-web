// 앱 공장 통제실: 작업 PC 접속 토큰 발급·목록·삭제. 관리자만.
// 토큰 원문은 발급 응답에서 딱 한 번만 돌려주고, DB 에는 해시만 둔다.
import { randomBytes } from "crypto";

import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/factory/admin";
import { hashWorkerToken } from "@/lib/factory/auth";
import { ID_RE, WORKER_RE } from "@/lib/factory/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_TOKENS = 10;

export async function GET() {
  const denied = await requireAdmin();

  if (denied) return denied;

  const tokens = await prisma.factoryWorkerToken.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return NextResponse.json({ tokens });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!WORKER_RE.test(name)) {
    return NextResponse.json(
      { message: "기기 이름은 영문, 숫자, . _ - 로 1~60자예요. 예: mainpc" },
      { status: 400 },
    );
  }
  if ((await prisma.factoryWorkerToken.count()) >= MAX_TOKENS) {
    return NextResponse.json(
      { message: `토큰은 ${MAX_TOKENS}개까지예요. 안 쓰는 것을 지우세요.` },
      { status: 400 },
    );
  }

  const token = `fw_${randomBytes(32).toString("hex")}`;
  const saved = await prisma.factoryWorkerToken.create({
    data: {
      name,
      tokenHash: hashWorkerToken(token),
      prefix: token.slice(0, 8),
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return NextResponse.json({ success: true, token, item: saved });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin();

  if (denied) return denied;

  const id = req.nextUrl.searchParams.get("id") ?? "";

  if (!ID_RE.test(id))
    return NextResponse.json(
      { message: "id 가 올바르지 않아요." },
      { status: 400 },
    );

  const res = await prisma.factoryWorkerToken.deleteMany({ where: { id } });

  if (res.count === 0)
    return NextResponse.json({ message: "없는 토큰이에요." }, { status: 404 });

  return NextResponse.json({ success: true });
}
