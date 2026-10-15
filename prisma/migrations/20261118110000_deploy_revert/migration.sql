-- 실패 단계부터 다시 + 배포 되돌리기(5-2): 칸만 추가하고 기존 데이터는 지우지 않는다.
ALTER TABLE "factory_maintenance" ADD COLUMN "deployRevertTo" TEXT;
ALTER TABLE "factory_deploys" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'deploy';
ALTER TABLE "factory_deploys" ADD COLUMN "revertTo" TEXT;
ALTER TABLE "factory_deploys" ADD COLUMN "migrations" BOOLEAN;
