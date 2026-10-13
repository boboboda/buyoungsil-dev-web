-- 일감·정비 지시마다 고른 Claude Code 모델(--model 별칭). 열만 추가(NULL = 기본 설정), 기존 데이터는 그대로
ALTER TABLE "factory_jobs" ADD COLUMN "aiModel" TEXT;
ALTER TABLE "factory_maintenance_messages" ADD COLUMN "aiModel" TEXT;
