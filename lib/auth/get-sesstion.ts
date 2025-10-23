// lib/auth/get-session.ts
import { getServerSession } from "next-auth/next";
import { Session } from "next-auth";

import authOptions from "@/lib/auth/auth";

export async function auth(): Promise<Session | null> {
  // 🔥 리턴 타입 명시
  return await getServerSession(authOptions);
}
