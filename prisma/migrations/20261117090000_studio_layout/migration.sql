-- 스튜디오 배치 편집기(3-4): 프로젝트 연결 설정에 배치 설정 칸, 배치 판 이력 표. 칸·표만 추가하고 기존 데이터는 지우지 않는다.
ALTER TABLE "factory_app_connections" ADD COLUMN "layoutConfig" JSONB;

CREATE TABLE "factory_layout_boards" (
  "id" TEXT NOT NULL,
  "appSlug" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "board" TEXT NOT NULL,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'editor',
  "note" TEXT NOT NULL DEFAULT '',
  "who" TEXT NOT NULL DEFAULT '',
  "exportStatus" TEXT NOT NULL DEFAULT '',
  "exportJobId" TEXT,
  "exportDest" TEXT NOT NULL DEFAULT '',
  "exportNote" TEXT NOT NULL DEFAULT '',
  "exportedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "factory_layout_boards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "factory_layout_boards_appSlug_version_key" ON "factory_layout_boards"("appSlug", "version");
