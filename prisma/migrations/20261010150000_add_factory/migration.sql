-- CreateTable
CREATE TABLE "factory_jobs" (
    "id" TEXT NOT NULL,
    "appSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'new',
    "parentJobId" TEXT,
    "planMarkdown" TEXT NOT NULL,
    "planHash" TEXT NOT NULL,
    "stack" TEXT NOT NULL DEFAULT 'flutter',
    "requiredSecrets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "phase" TEXT,
    "summary" TEXT,
    "failReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "workerId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_job_images" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_job_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_job_logs" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,

    CONSTRAINT "factory_job_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_secret_names" (
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_secret_names_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "factory_jobs_status_priority_createdAt_idx" ON "factory_jobs"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "factory_jobs_appSlug_idx" ON "factory_jobs"("appSlug");

-- CreateIndex
CREATE INDEX "factory_job_images_jobId_createdAt_idx" ON "factory_job_images"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "factory_job_logs_jobId_at_idx" ON "factory_job_logs"("jobId", "at");

-- AddForeignKey
ALTER TABLE "factory_job_images" ADD CONSTRAINT "factory_job_images_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "factory_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_job_logs" ADD CONSTRAINT "factory_job_logs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "factory_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
