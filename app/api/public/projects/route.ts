// app/api/public/projects/route.ts
// 회사 사이트 등 외부에서 읽어 가는 "출시된 프로젝트" 공개 목록 (읽기 전용, 인증 없음).
//
// 응답: { "projects": [{ name, title, description, coverImage, appLink, platform, techStack, updatedAt, detailUrl }], "generatedAt": "<ISO>" }
// - status === "released" 인 Project 만, createdAt 내림차순, 최대 50개.
// - 공개해도 되는 필드만 허용 목록으로 골라 만든다. 새 필드를 공개하려면 PUBLIC_PROJECT_SELECT 와 toPublicProject 를 함께 고친다.
// - CORS 는 열지 않는다(회사 사이트가 서버에서 읽는다).
import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { siteConfig } from "@/config/site";

export const runtime = "nodejs";

const MAX_PROJECTS = 50;
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=600";
const SITE_URL = (siteConfig.url || "https://buyoungsilcoding.com").replace(
  /\/+$/,
  "",
);

// DB 에서도 이 필드만 읽는다(status 는 이중 확인용, 응답에는 넣지 않음).
const PUBLIC_PROJECT_SELECT = {
  name: true,
  title: true,
  description: true,
  coverImage: true,
  appLink: true,
  platform: true,
  techStack: true,
  updatedAt: true,
  status: true,
} as const;

type PublicProjectRow = {
  name: string;
  title: string;
  description: string;
  coverImage: string | null;
  appLink: string | null;
  platform: string;
  techStack: string[];
  updatedAt: Date;
  status: string;
};

export type PublicProject = {
  name: string;
  title: string | null;
  description: string | null;
  coverImage: string | null;
  appLink: string | null;
  platform: string | null;
  techStack: string[];
  updatedAt: string | null;
  detailUrl: string;
};

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();

  return trimmed ? trimmed : null;
}

function toPublicProject(row: PublicProjectRow): PublicProject {
  const updatedAt =
    row.updatedAt instanceof Date && !isNaN(row.updatedAt.getTime())
      ? row.updatedAt.toISOString()
      : null;

  return {
    name: row.name,
    title: textOrNull(row.title),
    description: textOrNull(row.description),
    coverImage: textOrNull(row.coverImage),
    appLink: textOrNull(row.appLink),
    platform: textOrNull(row.platform),
    techStack: Array.isArray(row.techStack)
      ? row.techStack.filter((t) => typeof t === "string" && t.trim())
      : [],
    updatedAt,
    detailUrl: `${SITE_URL}/project/${encodeURIComponent(row.name)}`,
  };
}

export async function GET() {
  try {
    const rows = (await prisma.project.findMany({
      where: { status: "released" },
      select: PUBLIC_PROJECT_SELECT,
      orderBy: { createdAt: "desc" },
      take: MAX_PROJECTS,
    })) as PublicProjectRow[];

    const projects = rows
      .filter(
        (row) =>
          row &&
          row.status === "released" &&
          typeof row.name === "string" &&
          row.name,
      )
      .slice(0, MAX_PROJECTS)
      .map(toPublicProject);

    return NextResponse.json(
      { projects, generatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    // 상세 오류는 서버 로그에만. 메시지만 남겨 연결 문자열 등이 섞이지 않게 한다.
    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "알 수 없는 오류";

    console.error(
      "[public/projects] 목록 조회 실패:",
      message.replace(/\w+:\/\/[^\s]+/g, "[주소 생략]"),
    );

    return NextResponse.json(
      { error: "처리에 실패했습니다." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function methodNotAllowed() {
  return NextResponse.json(
    { error: "허용되지 않는 메서드입니다." },
    { status: 405, headers: { Allow: "GET" } },
  );
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
