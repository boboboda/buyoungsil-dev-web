// lib/studio/gate.ts
// 공용 스튜디오(/studio, /studio/<앱>) 첫 관문(middleware 에서 쓰는 순수 함수, DB 없음).
// 여기서는 "들여보낼 가능성이 있나"만 가른다. 키가 맞는지는 화면(lib/studio/pageAccess.ts)이 DB 로 다시 확인한다.
//   관리자 → 통과 / /studio 첫 화면은 관리자만(그 밖은 로그인 화면) / /studio/<앱> 은 키 헤더가 있으면 화면에서 확인, 없으면 401 + 키 입력 창.
export const isStudioPath = (pathname?: string | null): boolean => pathname === "/studio" || !!pathname?.startsWith("/studio/");

export type StudioGate = { action: "pass" } | { action: "signin" } | { action: "home" } | { action: "challenge" };

export function studioGate(pathname: string, who: { signedIn: boolean; isAdmin: boolean; hasAuthHeader: boolean }): StudioGate {
  if (who.isAdmin) return { action: "pass" };
  if (pathname === "/studio") return who.signedIn ? { action: "home" } : { action: "signin" };

  return who.hasAuthHeader ? { action: "pass" } : { action: "challenge" };
}
