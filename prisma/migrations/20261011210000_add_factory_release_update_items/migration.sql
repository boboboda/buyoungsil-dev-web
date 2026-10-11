-- 앱 공장 출시: '스토어 자료 수정'·'프로젝트 업데이트' 일감에서 사람이 고른 갱신 항목.
-- 새 열만 추가한다. 기존 일감은 빈 배열(= 예전 동작 그대로)이다.
ALTER TABLE "factory_jobs" ADD COLUMN "updateItems" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
