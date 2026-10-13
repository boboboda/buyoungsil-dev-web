-- 인계 기록(읽기 전용 표시용): 열만 추가한다. 기존 데이터는 그대로 두고 NULL 로 시작한다.
ALTER TABLE "factory_jobs" ADD COLUMN IF NOT EXISTS "handoff" JSONB;
ALTER TABLE "factory_maintenance_messages" ADD COLUMN IF NOT EXISTS "handoff" JSONB;
