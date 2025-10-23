import { ACCESS_MATRIX, ContentLevel, UserRole } from "@/types/access-control";

export function canAccessContent(
  userRole: UserRole,
  contentLevel: ContentLevel,
): boolean {
  const allowedLevels = ACCESS_MATRIX[userRole];

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
      return "고급 콘텐츠는 후원자 전용입니다.";
    default:
      return "접근 권한이 없습니다.";
  }
}

export function getRequiredRole(contentLevel: ContentLevel): UserRole {
  switch (contentLevel) {
    case "BEGINNER":
      return "guest";
    case "INTERMEDIATE":
      return "user";
    case "ADVANCED":
      return "supporter";
    default:
      return "guest";
  }
}
