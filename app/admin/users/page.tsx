// app/admin/users/page.tsx
// 관리자 '가입자 명단': 요약(전체·오늘/이번 주/이번 달 신규·가입 방식별·권한별) + 최신 가입순 목록(25개씩, 검색·필터). 읽기 전용.
// /admin 은 미들웨어가 막지만, 개인정보 화면이라 여기서도 관리자인지 한 번 더 본다(비로그인 → 로그인 화면, 일반 회원 → 홈).
import { Metadata } from "next";
import { redirect } from "next/navigation";

import MembersView from "@/components/admin/users/MembersView";
import { auth } from "@/lib/auth/get-sesstion";
import prisma from "@/lib/prisma";
import {
  EMPTY_MEMBER_QUERY,
  listMembers,
  memberSummary,
  parseMemberQuery,
  type MemberPage,
  type MemberSummary,
} from "@/lib/admin/members";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "가입자 명단 | 관리자",
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth().catch(() => null);

  if (!session?.user) redirect("/signin");
  if (session.user.role !== "admin") redirect("/");

  const sp = await searchParams;
  const parsed = parseMemberQuery((k) => {
    const v = sp[k];

    return typeof v === "string" ? v : null;
  });

  let summary: MemberSummary | null = null;
  let list: MemberPage | null = null;

  try {
    summary = await memberSummary(prisma);
  } catch (error) {
    console.error("가입자 요약 조회 실패:", error instanceof Error ? error.name : "unknown");
  }
  if (parsed.query) {
    try {
      list = await listMembers(prisma, parsed.query);
    } catch (error) {
      console.error("가입자 목록 조회 실패:", error instanceof Error ? error.name : "unknown");
    }
  }

  return <MembersView error={parsed.error ?? null} list={list} query={parsed.query ?? EMPTY_MEMBER_QUERY} summary={summary} />;
}
