-- 도트 그림 저장소: AI 가 만든 그림(후보)과 관리자가 승인·반려한 그림. 새 표만 추가한다. 기존 데이터는 건드리지 않는다.

-- CreateTable
CREATE TABLE "factory_arts" (
    "id" TEXT NOT NULL,
    "appSlug" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "jobId" TEXT,
    "srcKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "factory_arts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "factory_arts_srcKey_key" ON "factory_arts"("srcKey");

-- CreateIndex
CREATE INDEX "factory_arts_appSlug_status_idx" ON "factory_arts"("appSlug", "status");
