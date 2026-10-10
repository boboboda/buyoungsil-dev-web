// 앱 공장 통제실: 키 이름 카탈로그. 이름과 설명만 다루고 값은 다루지 않는다. 관리자만.
import { NextRequest, NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { requireAdmin } from "@/lib/factory/admin";
import { SECRET_NAME_RE } from "@/lib/factory/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_DESCRIPTION = 200;
const MAX_NAMES = 100;

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const names = await prisma.factorySecretName.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ names });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, MAX_DESCRIPTION) : "";

  if (!SECRET_NAME_RE.test(name)) {
    return NextResponse.json({ message: "이름은 대문자, 숫자, _ 로 2~64자예요. 예: PIXELLAB_TOKEN" }, { status: 400 });
  }
  if (!description) return NextResponse.json({ message: "어디에 쓰는 키인지 설명이 필요해요." }, { status: 400 });

  const exists = await prisma.factorySecretName.findUnique({ where: { name }, select: { name: true } });
  if (!exists && (await prisma.factorySecretName.count()) >= MAX_NAMES) {
    return NextResponse.json({ message: `키 이름은 ${MAX_NAMES}개까지예요.` }, { status: 400 });
  }

  const saved = await prisma.factorySecretName.upsert({
    where: { name },
    create: { name, description },
    update: { description },
  });

  return NextResponse.json({ success: true, name: saved });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : (req.nextUrl.searchParams.get("name") ?? "");

  if (!SECRET_NAME_RE.test(name)) return NextResponse.json({ message: "이름이 올바르지 않아요." }, { status: 400 });

  const res = await prisma.factorySecretName.deleteMany({ where: { name } });
  if (res.count === 0) return NextResponse.json({ message: "없는 이름이에요." }, { status: 404 });

  return NextResponse.json({ success: true });
}
