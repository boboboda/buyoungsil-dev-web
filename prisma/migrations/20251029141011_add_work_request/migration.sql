-- CreateTable
CREATE TABLE "work_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "projectType" TEXT NOT NULL,
    "budget" TEXT NOT NULL,
    "timeline" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_requests_status_idx" ON "work_requests"("status");

-- CreateIndex
CREATE INDEX "work_requests_createdAt_idx" ON "work_requests"("createdAt");
