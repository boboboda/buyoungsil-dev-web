-- 계획 먼저 승인 + 변경 내용(diff) 보기(5-1): 칸만 추가하고 기존 데이터는 지우지 않는다.
ALTER TABLE "factory_jobs" ADD COLUMN "planFirst" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "factory_jobs" ADD COLUMN "planStatus" TEXT;
ALTER TABLE "factory_jobs" ADD COLUMN "planText" TEXT;
ALTER TABLE "factory_jobs" ADD COLUMN "planNote" TEXT;
ALTER TABLE "factory_jobs" ADD COLUMN "planInfo" JSONB;
ALTER TABLE "factory_jobs" ADD COLUMN "diffInfo" JSONB;
