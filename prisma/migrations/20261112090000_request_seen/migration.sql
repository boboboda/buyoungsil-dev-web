-- 1-1 D-1: 배포 중 재전송 대기열의 중복 방지(요청 번호 기록). 새 테이블만 추가한다.
CREATE TABLE IF NOT EXISTS "factory_request_seen" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_request_seen_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "factory_request_seen_createdAt_idx" ON "factory_request_seen"("createdAt");
