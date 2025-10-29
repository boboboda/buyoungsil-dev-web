# FROM node:18-alpine

# RUN apk add --no-cache tzdata
# ENV TZ=Asia/Seoul
# WORKDIR /app

# # 빌드 인자
# ARG ENV_FILE

# # 기본 설정
# COPY package.json package-lock.json ./
# COPY prisma ./prisma/
# RUN npm install
# RUN npx prisma generate

# # 앱 복사
# COPY . .

# # 환경파일 주입 (빌드할 때만)
# COPY ${ENV_FILE} .env

# RUN npm run build

# EXPOSE 5000

# CMD ["sh", "-c", "npm run start"]


FROM node:18-alpine AS base

# Dependencies
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma 파일 복사 (중요!)
COPY prisma ./prisma

# Prisma Client 생성
RUN npx prisma generate

# Next.js 빌드
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Prisma 마이그레이션 파일 복사 (중요!)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 5000

ENV PORT=5000
ENV HOSTNAME="0.0.0.0"

# 시작 스크립트 사용
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]