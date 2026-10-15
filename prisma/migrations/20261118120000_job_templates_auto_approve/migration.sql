-- 일감 템플릿 + 자동 승인 규칙(5-3): 표와 칸만 추가하고 기존 데이터는 지우지 않는다.
ALTER TABLE "factory_jobs" ADD COLUMN "templateId" TEXT;
ALTER TABLE "factory_jobs" ADD COLUMN "autoApprovedBy" TEXT;

CREATE TABLE "factory_job_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "requiredSecrets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvalMode" TEXT NOT NULL DEFAULT 'default',
    "cardName" TEXT,
    "toolCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_job_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "factory_job_templates_name_key" ON "factory_job_templates"("name");
