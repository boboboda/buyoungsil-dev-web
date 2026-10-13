-- Studio 요청 입구 감사 기록(표만 추가, 기존 데이터는 건드리지 않음)
CREATE TABLE "studio_request_logs" (
    "id" TEXT NOT NULL,
    "keyId" TEXT,
    "kind" TEXT NOT NULL,
    "appSlug" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_request_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "studio_request_logs_keyId_createdAt_idx" ON "studio_request_logs"("keyId", "createdAt");
