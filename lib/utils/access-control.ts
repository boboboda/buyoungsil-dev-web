import { ACCESS_MATRIX, ContentLevel, UserRole } from "@/types/access-control";

// 세션의 role 값을 접근 규칙용 역할로 바꾼다.
// 로그인했으면 admin 말고는 모두 일반 회원으로 본다(예전 값이 DB 에 남아 있어도 오류 없이 회원 취급).
export function resolveUserRole(
  isAuthenticated: boolean,
  role: string | null | undefined,
): UserRole {
  if (!isAuthenticated) {
    return "guest";
  }

  return role === "admin" ? "admin" : "user";
}

export function canAccessContent(
  userRole: UserRole,
  contentLevel: ContentLevel,
): boolean {
  const allowedLevels = ACCESS_MATRIX[userRole] ?? ACCESS_MATRIX.guest;

  return allowedLevels.includes(contentLevel);
}

export function getAccessMessage(
  userRole: UserRole,
  contentLevel: ContentLevel,
): string {
  if (canAccessContent(userRole, contentLevel)) {
    return "";
  }

  switch (contentLevel) {
    case "INTERMEDIATE":
      return "중급 콘텐츠는 회원가입이 필요합니다.";
    case "ADVANCED":
      return "고급 콘텐츠는 회원가입이 필요합니다.";
    default:
      return "접근 권한이 없습니다.";
  }
}

export function getRequiredRole(contentLevel: ContentLevel): UserRole {
  switch (contentLevel) {
    case "BEGINNER":
      return "guest";
    case "INTERMEDIATE":
    case "ADVANCED":
      return "user";
    default:
      return "guest";
  }
}
