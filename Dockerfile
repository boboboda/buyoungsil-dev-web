# syntax=docker/dockerfile:1
FROM node:18-alpine

RUN apk add --no-cache tzdata
ENV TZ=Asia/Seoul
WORKDIR /app

ARG ENV_FILE

COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN --mount=type=cache,target=/root/.npm npm ci
RUN --mount=type=cache,target=/root/.npm npm install --no-save --cpu=arm64 --os=linux --libc=musl sharp
RUN npx prisma generate

COPY . .
COPY ${ENV_FILE} .env

RUN --mount=type=cache,target=/app/.next/cache npm run build

EXPOSE 5000
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]