-- CreateTable
CREATE TABLE "claude_sessions" (
    "id" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "lastEvent" TEXT NOT NULL,
    "lastTool" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "cacheCreateTokens" BIGINT NOT NULL DEFAULT 0,
    "cacheReadTokens" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "claude_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claude_events" (
    "id" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "inputDelta" INTEGER NOT NULL DEFAULT 0,
    "outputDelta" INTEGER NOT NULL DEFAULT 0,
    "cacheCreateDelta" INTEGER NOT NULL DEFAULT 0,
    "cacheReadDelta" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "claude_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claude_daily_usage" (
    "date" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "cacheCreateTokens" BIGINT NOT NULL DEFAULT 0,
    "cacheReadTokens" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "claude_daily_usage_pkey" PRIMARY KEY ("date","device","project")
);

-- CreateIndex
CREATE INDEX "claude_sessions_lastEventAt_idx" ON "claude_sessions"("lastEventAt");

-- CreateIndex
CREATE INDEX "claude_events_sessionId_at_idx" ON "claude_events"("sessionId", "at");

-- CreateIndex
CREATE INDEX "claude_events_at_idx" ON "claude_events"("at");

-- CreateIndex
CREATE INDEX "claude_daily_usage_date_idx" ON "claude_daily_usage"("date");

-- AddForeignKey
ALTER TABLE "claude_events" ADD CONSTRAINT "claude_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "claude_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
