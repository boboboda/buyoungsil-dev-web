// lib/studio/pageAccess.ts
// 공용 스튜디오(/studio, /studio/<앱>) 화면 접근 판단.
// - 관리자 로그인: 모든 화면을 보고 고칠 수 있다.
// - Studio 접근 키(docs/studio-access.md, Authorization: Basic 의 비밀번호 칸): 그 키가 발급된 앱의 /studio/<앱> 만 볼 수 있다. 읽기 전용(고치는 API 는 관리자만).
// - 그 밖에는 모두 거부(null). 키 원문은 저장·출력하지 않는다.
import { auth } from "@/lib/auth/get-sesstion";
import { basicPassword, STUDIO_APP_RE, verifyStudioKey } from "@/lib/studio/access";

export type Viewer = { kind: "admin"; name: string } | { kind: "key"; app: string };

export interface ViewerInput {
  isAdmin: boolean;
  name: string;
  authorization: string | null;
  app?: string; // /studio/<앱> 일 때의 앱 이름. /studio 첫 화면이면 없음
  verify: (app: string, key: string) => Promise<boolean>;
}

export async function decideViewer(input: ViewerInput): Promise<Viewer | null> {
  if (input.isAdmin) return { kind: "admin", name: input.name };
  if (!input.app || !STUDIO_APP_RE.test(input.app)) return null;
  const key = basicPassword(input.authorization);

  if (key === null) return null;

  return (await input.verify(input.app, key).catch(() => false)) ? { kind: "key", app: input.app } : null;
}

/** 서버 컴포넌트에서: 지금 요청이 누구인지(거부면 null) */
export async function resolveViewer(app?: string): Promise<Viewer | null> {
  const { headers } = await import("next/headers");
  const [session, h] = await Promise.all([auth().catch(() => null), headers()]);

  return decideViewer({
    isAdmin: session?.user?.role === "admin",
    name: session?.user?.name || session?.user?.email || "관리자",
    authorization: h.get("authorization"),
    app,
    verify: verifyStudioKey,
  });
}
