// lib/auth/get-session.ts
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth/auth"; // 🔥 named import로 변경

export async function auth(): Promise<Session | null> {
  const session = await getServerSession(authOptions);
  
  // 🔥 디버그 로그 추가
  console.log("🔍 [auth()] getServerSession 결과:", {
    hasSession: !!session,
    user: session?.user,
    fullSession: session
  });
  
  return session;
}