-- 앱 공장 출시(반자동): 배포 계정 프로필과 앱별 출시 상태. 기존 데이터는 건드리지 않는다(열 추가만).

-- CreateTable
CREATE TABLE "factory_release_accounts" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requiresTesting" BOOLEAN NOT NULL DEFAULT false,
    "developerName" TEXT,
    "contactEmail" TEXT,
    "keystorePath" TEXT,
    "keyAlias" TEXT,
    "serviceAccountKeyPath" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_release_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "factory_release_accounts_label_key" ON "factory_release_accounts"("label");

-- AlterTable
ALTER TABLE "factory_apps" ADD COLUMN "releaseAccountId" TEXT,
ADD COLUMN "releaseStatus" TEXT NOT NULL DEFAULT 'preparing',
ADD COLUMN "packageName" TEXT,
ADD COLUMN "firstUploadDone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "testingStartedAt" TIMESTAMP(3),
ADD COLUMN "testingDueAt" TIMESTAMP(3),
ADD COLUMN "testingNotifiedAt" TIMESTAMP(3),
ADD COLUMN "releasePackage" JSONB,
ADD COLUMN "releasePackageAt" TIMESTAMP(3),
ADD COLUMN "releasePackageJob" TEXT,
ADD COLUMN "aab" JSONB;

-- AddForeignKey
ALTER TABLE "factory_apps" ADD CONSTRAINT "factory_apps_releaseAccountId_fkey" FOREIGN KEY ("releaseAccountId") REFERENCES "factory_release_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
