-- 앱 공장 출시 자동화 2단계: 스토어 자료·홍보 영상 링크·Play 업로드 결과, 출시 일감의 '홈페이지 프로젝트 덮어쓰기' 선택.
-- 새 열만 추가한다. 기존 데이터는 지우거나 바꾸지 않는다(새 열은 NULL 이거나 false).

-- AlterTable: 앱별 홍보 영상 링크(YouTube), 스토어 자료 결과
ALTER TABLE "factory_apps" ADD COLUMN "promoVideoUrl" TEXT,
ADD COLUMN "storeAssets" JSONB;

-- AlterTable: 출시 일감(store/project)의 홈페이지 프로젝트 덮어쓰기 여부(기본 꺼짐)
ALTER TABLE "factory_jobs" ADD COLUMN "overwriteProject" BOOLEAN NOT NULL DEFAULT false;
