// lib/auth/auth.ts
import NextAuth, { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import prisma from "@/lib/prisma";

const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production";
const cookieName = isProduction
  ? "__Secure-authjs.session-token"
  : "next-auth.session-token";

// 🔥 authOptions를 별도로 export
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        name: { label: "name", type: "text" },
        email: { label: "email", type: "email" },
        password: { label: "password", type: "password" },
        action: { label: "Action", type: "text" },
      },
      async authorize(credentials) {
        if (
          !credentials?.email ||
          !credentials.password ||
          !credentials.action
        ) {
          throw new Error("필수 입력 항목이 누락되었습니다.");
        }

        const { email, password, action, name } = credentials;

        // 'register' 액션
        if (action === "register") {
          if (!name) throw new Error("회원가입 시 이름이 필요합니다.");

          const existingUser = await prisma.user.findUnique({
            where: { email },
          });

          if (existingUser) throw new Error("이미 사용 중인 이메일입니다.");

          const hashedPassword = await bcrypt.hash(password, 10);
          const newUser = await prisma.user.create({
            data: { name, email, password: hashedPassword, role: "user" },
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              image: true,
              emailVerified: true,
            },
          });

          return {
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            role: newUser.role ?? "user",
            image: newUser.image,
            emailVerified: newUser.emailVerified,
          };
        }

        // 'login' 액션
        if (action === "login") {
          const user = await prisma.user.findUnique({ where: { email } });

          if (!user || !user.password)
            throw new Error("사용자를 찾을 수 없습니다.");

          const isValid = await bcrypt.compare(password, user.password);

          if (!isValid) throw new Error("비밀번호가 일치하지 않습니다.");

          const { password: _, ...userWithoutPassword } = user;

          return {
            ...userWithoutPassword,
            role: user.role ?? "user",
          };
        }

        throw new Error("잘못된 액션입니다.");
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/signin",
    signOut: "/",
    error: "/signin",
  },
  callbacks: {
    jwt: async ({ token, user, account, trigger, session }) => {
      console.log("\n=================== JWT 콜백 시작");
      console.log("🔥 JWT 콜백 - trigger:", trigger);
      console.log("🔥 JWT 콜백 - user:", user);
      console.log("🔥 JWT 콜백 - account:", account);
      console.log("🔥 JWT 콜백 - existing token:", token);

      if (user && account) {
        console.log("🆕 새로운 로그인 또는 회원가입");

        if (account.provider === "google" || account.provider === "github") {
          console.log("🔑 OAuth 로그인:", account.provider);

          const dbUser = await prisma.user.findUnique({
            where: { email: user.email! },
            select: { id: true, role: true, name: true, email: true },
          });

          console.log("DB 조회 결과:", dbUser);

          token.id = dbUser?.id || user.id;
          token.role = dbUser?.role || "user";

          console.log("OAuth 토큰 설정:", {
            id: token.id,
            role: token.role,
            fromDB: !!dbUser,
          });
        } else {
          console.log("🔑 Credentials 로그인");
          token.id = user.id;
          token.role = user.role || "user";

          console.log("Credentials 토큰 설정:", {
            id: token.id,
            role: token.role,
          });
        }

        token.name = user.name;
        token.email = user.email;
        token.picture = user.image;
        token.provider = account.provider;
        token.isFirstLogin = true;
        token.isNewSignUp = user.isNewSignUp || false;
      } else if (!token.provider && account) {
        token.provider = account.provider;
        console.log("🔄 Provider 정보만 추가:", account.provider);
      } else if (trigger === "update") {
        console.log("🔄 세션 업데이트 트리거");
        token = { ...token, ...session };
      } else {
        console.log("♻️ 기존 토큰 재사용:", {
          id: token.id,
          role: token.role,
          provider: token.provider,
        });
      }

      if (!token.provider) {
        token.provider = "credentials";
      }

      return token;
    },

    session: async ({ session, token }) => {
      if (token) {
        const newUserObject = {
          id: token.id || token.sub || "",
          name: token.name || session.user?.name || "",
          email: token.email || session.user?.email || "",
          role: token.role || "user",
        };

        session.user = newUserObject;
        session.provider = token.provider;
        session.isFirstLogin = token.isFirstLogin;
        session.isNewSignUp = token.isNewSignUp;
      } else {
        console.log("❌ 토큰이 없어서 세션 매핑 실패");
      }

      console.log("🔥 SESSION 콜백 종료 - 최종 세션:", session);
      console.log("=================== SESSION 콜백 끝\n");

      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  cookies: {
    sessionToken: {
      name: cookieName,
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: isProduction,
        ...(isProduction ? { domain: ".buyoungsilcoding.com" } : {}),
      },
    },
  },
};

// 🔥 default export는 NextAuth handler
export default NextAuth(authOptions);