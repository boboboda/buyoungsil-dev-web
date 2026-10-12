import { auth } from "@/lib/auth/get-sesstion";

// 서버 액션용 관리자 관문. 관리자가 아니면 throw 한다(클라이언트에는 일반 오류로 보인다).
export async function assertAdmin(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    throw new Error("권한이 없습니다.");
  }
}

export async function isAdmin(): Promise<boolean> {
  const session = await auth().catch(() => null);
  return session?.user?.role === "admin";
}
