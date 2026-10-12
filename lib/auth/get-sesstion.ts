// lib/auth/get-session.ts
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth/auth"; // 🔥 named import로 변경

export async function auth(): Promise<Session | null> {
  return getServerSession(authOptions);
}