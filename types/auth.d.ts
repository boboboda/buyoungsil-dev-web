// types/next-auth.d.ts
import { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface User {
    id: string;
    role?: string;
    isNewSignUp?: boolean;
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      role?: string;
    };
    provider?: string;
    isFirstLogin?: boolean;
    isNewSignUp?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id?: string;
    email?: string;
    role?: string;
    provider?: string;
    isFirstLogin?: boolean;
    isNewSignUp?: boolean;
    sv?: number; // 로그인 시점의 세션 버전
    revoked?: boolean; // "모든 기기에서 로그아웃"으로 무효화됨
  }
}
