FROM node:18-alpine

RUN apk add --no-cache tzdata
ENV TZ=Asia/Seoul
WORKDIR /app

# 빌드 인자
ARG ENV_FILE

# 기본 설정
COPY package.json package-lock.json ./
COPY prisma ./prisma/
RUN npm install
RUN npx prisma generate

# 앱 복사
COPY . .

# 환경파일 주입 (빌드할 때만)
COPY ${ENV_FILE} .env

RUN npm run build

EXPOSE 5000
CMD ["sh", "-c", "npm run start"]
