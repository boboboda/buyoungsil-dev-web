-- Additive only. 도구 요청 중계 목록(도구 이름·상태·시간). 기존 일감은 NULL 그대로.
ALTER TABLE "factory_jobs" ADD COLUMN "toolRequests" JSONB;
