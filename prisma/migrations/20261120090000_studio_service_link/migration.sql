-- 스튜디오 ↔ 서비스 연결: 서비스 동작 기록 표. 표만 추가하고 기존 데이터는 지우지 않는다.

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
