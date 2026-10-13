-- 정비 진행 로그를 지시(turn) 단위로 묶는다: 열·색인만 추가한다. 기존 로그는 NULL 로 그대로 둔다.
ALTER TABLE "factory_maintenance_messages" ADD COLUMN IF NOT EXISTS "turnId" TEXT;
CREATE INDEX IF NOT EXISTS "factory_maintenance_messages_turnId_idx" ON "factory_maintenance_messages"("turnId");
