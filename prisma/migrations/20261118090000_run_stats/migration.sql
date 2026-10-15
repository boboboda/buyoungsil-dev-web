-- 블록별 비용·시간 통계(4-4): 새 표만 추가하고 기존 데이터는 지우지 않는다.
CREATE TABLE "factory_run_stats" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "appSlug" TEXT,
    "cardId" TEXT,
    "tool" TEXT,
    "method" TEXT,
    "result" TEXT NOT NULL,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "cacheCreate" BIGINT NOT NULL DEFAULT 0,
    "cacheRead" BIGINT NOT NULL DEFAULT 0,
    "waitMs" INTEGER NOT NULL DEFAULT 0,
    "runMs" INTEGER NOT NULL DEFAULT 0,
    "pausedMs" INTEGER NOT NULL DEFAULT 0,
    "redoCount" INTEGER NOT NULL DEFAULT 0,
    "externalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "externalLabel" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_run_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "factory_run_stats_kind_refId_key" ON "factory_run_stats"("kind", "refId");
CREATE INDEX "factory_run_stats_at_idx" ON "factory_run_stats"("at");
CREATE INDEX "factory_run_stats_agent_at_idx" ON "factory_run_stats"("agent", "at");
CREATE INDEX "factory_run_stats_appSlug_at_idx" ON "factory_run_stats"("appSlug", "at");
