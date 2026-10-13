-- CreateTable
CREATE TABLE "novel_works" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "genre" TEXT,
    "logline" TEXT,
    "setupSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'setup',
    "setupApprovedAt" TIMESTAMP(3),
    "approvalMode" TEXT NOT NULL DEFAULT 'every',
    "publishPerDay" INTEGER NOT NULL DEFAULT 1,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "novel_works_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "novel_episodes" (
    "id" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "checkResult" JSONB,
    "tokens" JSONB,
    "revisionNote" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "novel_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "novel_logs" (
    "id" SERIAL NOT NULL,
    "workId" TEXT NOT NULL,
    "episodeNumber" INTEGER,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "novel_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "novel_works_slug_key" ON "novel_works"("slug");

-- CreateIndex
CREATE INDEX "novel_episodes_workId_status_idx" ON "novel_episodes"("workId", "status");

-- CreateIndex
CREATE INDEX "novel_episodes_workId_publishAt_idx" ON "novel_episodes"("workId", "publishAt");

-- CreateIndex
CREATE UNIQUE INDEX "novel_episodes_workId_number_key" ON "novel_episodes"("workId", "number");

-- CreateIndex
CREATE INDEX "novel_logs_workId_at_idx" ON "novel_logs"("workId", "at");

-- AddForeignKey
ALTER TABLE "novel_episodes" ADD CONSTRAINT "novel_episodes_workId_fkey" FOREIGN KEY ("workId") REFERENCES "novel_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novel_logs" ADD CONSTRAINT "novel_logs_workId_fkey" FOREIGN KEY ("workId") REFERENCES "novel_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

