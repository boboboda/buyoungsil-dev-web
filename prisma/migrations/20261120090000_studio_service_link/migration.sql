-- 스튜디오 ↔ 서비스 연결: 그림 자체 보관(원래 주소·복사 실패 이유)과 서비스 동작 기록. 칸·표만 추가하고 기존 데이터는 지우지 않는다.
ALTER TABLE "factory_arts" ADD COLUMN "sourceUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "factory_arts" ADD COLUMN "copyError" TEXT NOT NULL DEFAULT '';

CREATE TABLE "factory_service_actions" (
    "id" TEXT NOT NULL,
    "appSlug" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL DEFAULT '',
    "who" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_service_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "factory_service_actions_appSlug_createdAt_idx" ON "factory_service_actions"("appSlug", "createdAt");
