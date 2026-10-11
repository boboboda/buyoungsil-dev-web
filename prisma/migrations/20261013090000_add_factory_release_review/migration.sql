-- 앱 공장 출시: '검토 대기'(status=review) 단계, 다시 만들기 메모, 앱 업데이트(기능 추가) 입력·빌드 결과, 검토용 홍보 영상 임시 저장.
-- 새 열·새 표만 추가한다. 예전 일감은 reviewRequired=false 라 예전 흐름 그대로 읽힌다.

-- AlterTable
ALTER TABLE "factory_jobs" ADD COLUMN     "buildResult" JSONB,
ADD COLUMN     "redoNote" TEXT,
ADD COLUMN     "releaseNotes" TEXT,
ADD COLUMN     "reviewApprovedAt" TIMESTAMP(3),
ADD COLUMN     "reviewAt" TIMESTAMP(3),
ADD COLUMN     "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "versionName" TEXT;

-- CreateTable
CREATE TABLE "factory_review_videos" (
    "jobId" TEXT NOT NULL,
    "appSlug" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_review_videos_pkey" PRIMARY KEY ("jobId")
);

-- CreateTable
CREATE TABLE "factory_review_video_chunks" (
    "jobId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "factory_review_video_chunks_pkey" PRIMARY KEY ("jobId","idx")
);

-- CreateIndex
CREATE INDEX "factory_review_videos_expiresAt_idx" ON "factory_review_videos"("expiresAt");

-- AddForeignKey
ALTER TABLE "factory_review_video_chunks" ADD CONSTRAINT "factory_review_video_chunks_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "factory_review_videos"("jobId") ON DELETE CASCADE ON UPDATE CASCADE;

