// types/access-control.ts
export type UserRole = "guest" | "user" | "admin";
export type ContentLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

export interface AccessConfig {
  userRole: UserRole;
  contentLevel: ContentLevel;
  canAccess: boolean;
}

// 권한 매트릭스
export const ACCESS_MATRIX: Record<UserRole, ContentLevel[]> = {
  guest: ["BEGINNER"], // 비회원: 초급만
  user: ["BEGINNER", "INTERMEDIATE", "ADVANCED"], // 가입자: 모든 레벨
  admin: ["BEGINNER", "INTERMEDIATE", "ADVANCED"], // 관리자: 모든 레벨
};
