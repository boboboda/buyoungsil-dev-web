-- 시험용 APK 조각 크기를 APK 마다 저장한다(조각 크기를 바꿔도 받던 것을 그 크기로 검사). 기존 행은 8MB 로 시작한 것.
-- 열만 추가한다. 기존 데이터는 건드리지 않는다.

-- AlterTable
ALTER TABLE "factory_test_apks" ADD COLUMN "chunkSize" INTEGER NOT NULL DEFAULT 8388608;
