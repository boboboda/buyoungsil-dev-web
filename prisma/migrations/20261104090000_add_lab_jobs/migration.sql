-- 실험(lab) 일감: 결과 요약 열 두 개와 결과 파일(이미지·mp4·report.md) 저장 표.
-- 새 열·새 표만 추가한다. 기존 데이터는 건드리지 않는다.

-- AlterTable
ALTER TABLE "factory_jobs" ADD COLUMN     "labCleanupAt" TIMESTAMP(3),
ADD COLUMN     "labResult" JSONB;

-- CreateTable
CREATE TABLE "factory_lab_files" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_lab_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_lab_file_chunks" (
    "fileId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "factory_lab_file_chunks_pkey" PRIMARY KEY ("fileId","idx")
);

-- CreateIndex
CREATE UNIQUE INDEX "factory_lab_files_jobId_name_key" ON "factory_lab_files"("jobId", "name");

-- AddForeignKey
ALTER TABLE "factory_lab_files" ADD CONSTRAINT "factory_lab_files_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "factory_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factory_lab_file_chunks" ADD CONSTRAINT "factory_lab_file_chunks_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "factory_lab_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
