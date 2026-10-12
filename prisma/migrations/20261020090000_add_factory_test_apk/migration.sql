-- 앱 공장 출시 패키지 '시험용 APK': 서명된 release APK 를 관리자만 내려받게 DB 에 조각으로 둔다(앱당 최근 5개).
-- 새 표만 추가한다. 기존 데이터는 건드리지 않는다.

-- CreateTable
CREATE TABLE "factory_test_apks" (
    "id" TEXT NOT NULL,
    "appSlug" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "versionName" TEXT,
    "versionCode" INTEGER,
    "builtAt" TIMESTAMP(3),
    "gitCommit" TEXT,
    "signerSha256" TEXT,
    "keyLabel" TEXT,
    "chunkCount" INTEGER NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_test_apks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_test_apk_chunks" (
    "apkId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "factory_test_apk_chunks_pkey" PRIMARY KEY ("apkId","idx")
);

-- CreateIndex
CREATE INDEX "factory_test_apks_appSlug_createdAt_idx" ON "factory_test_apks"("appSlug", "createdAt");

-- AddForeignKey
ALTER TABLE "factory_test_apk_chunks" ADD CONSTRAINT "factory_test_apk_chunks_apkId_fkey" FOREIGN KEY ("apkId") REFERENCES "factory_test_apks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
