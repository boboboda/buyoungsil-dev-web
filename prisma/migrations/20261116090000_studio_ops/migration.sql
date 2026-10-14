-- 스튜디오 운영 구역(3-3): 그림 내보낸 기록, 카드별 자동 생성 일정. 새 표만 추가하고 기존 데이터는 지우지 않는다.
CREATE TABLE "factory_art_exports" (
  "id" TEXT NOT NULL,
  "artId" TEXT NOT NULL,
  "appSlug" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "jobId" TEXT,
  "dest" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "who" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "factory_art_exports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "factory_art_exports_artId_idx" ON "factory_art_exports"("artId");
CREATE INDEX "factory_art_exports_appSlug_createdAt_idx" ON "factory_art_exports"("appSlug", "createdAt");

CREATE TABLE "factory_gen_schedules" (
  "id" TEXT NOT NULL,
  "appSlug" TEXT NOT NULL,
  "cardId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "hour" INTEGER NOT NULL DEFAULT 9,
  "count" INTEGER NOT NULL DEFAULT 1,
  "subjects" TEXT NOT NULL DEFAULT '',
  "extra" TEXT NOT NULL DEFAULT '',
  "lastRunKey" TEXT NOT NULL DEFAULT '',
  "lastRunAt" TIMESTAMP(3),
  "lastJobId" TEXT,
  "lastMessage" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "factory_gen_schedules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "factory_gen_schedules_appSlug_cardId_key" ON "factory_gen_schedules"("appSlug", "cardId");
