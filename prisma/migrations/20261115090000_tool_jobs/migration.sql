-- 도구 일감(2-3): AI 없이 카드로 바로 생성. 새 칸만 추가하고 기존 데이터는 지우지 않는다.
ALTER TABLE "factory_jobs" ADD COLUMN "toolInput" JSONB;
ALTER TABLE "factory_jobs" ADD COLUMN "toolResult" JSONB;
