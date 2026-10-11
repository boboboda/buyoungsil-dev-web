-- 출시 패키지 목록에서 지운 시각. 열만 추가, 기존 데이터는 건드리지 않는다.

-- AlterTable
ALTER TABLE "factory_apps" ADD COLUMN "releaseRemovedAt" TIMESTAMP(3);
