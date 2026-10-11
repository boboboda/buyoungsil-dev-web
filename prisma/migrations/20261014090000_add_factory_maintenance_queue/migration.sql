-- 공장 정비 대기열·배포 묶기. 열만 추가하고 기존 데이터는 건드리지 않는다.
-- 지시(user 메시지)마다 올린 커밋·배포 필요 여부·배포된 시각, 배포 이력마다 포함된 지시 목록(JSON).

-- AlterTable
ALTER TABLE "factory_maintenance_messages" ADD COLUMN "pushedCommit" TEXT;
ALTER TABLE "factory_maintenance_messages" ADD COLUMN "needsDeploy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "factory_maintenance_messages" ADD COLUMN "deployedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "factory_deploys" ADD COLUMN "items" TEXT;
