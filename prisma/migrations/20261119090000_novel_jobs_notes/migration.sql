-- AlterTable: cycle.sh 원고·검수 사본(공개 본문과 따로)
ALTER TABLE "novel_episodes" ADD COLUMN "draftBody" TEXT,
ADD COLUMN "draftReview" TEXT,
ADD COLUMN "draftVerdict" TEXT,
ADD COLUMN "draftMust" INTEGER,
ADD COLUMN "draftRec" INTEGER,
ADD COLUMN "draftChars" INTEGER,
ADD COLUMN "draftSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "novel_jobs" (
    "id" TEXT NOT NULL,
    "workSlug" TEXT NOT NULL,
    "episode" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'cycle',
    "params" JSONB NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'check',
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "requestedBy" TEXT NOT NULL DEFAULT 'web',
    "overrideCap" BOOLEAN NOT NULL DEFAULT false,
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "verdict" TEXT,
    "mustCount" INTEGER,
    "recCount" INTEGER,
    "charCount" INTEGER,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "summary" TEXT,
    "logTail" TEXT,

    CONSTRAINT "novel_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "novel_notes" (
    "id" TEXT NOT NULL,
    "workSlug" TEXT NOT NULL,
    "episode" INTEGER NOT NULL,
    "line" INTEGER,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "novel_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "novel_jobs_status_createdAt_idx" ON "novel_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "novel_jobs_workSlug_episode_createdAt_idx" ON "novel_jobs"("workSlug", "episode", "createdAt");

-- CreateIndex
CREATE INDEX "novel_notes_workSlug_episode_status_idx" ON "novel_notes"("workSlug", "episode", "status");
