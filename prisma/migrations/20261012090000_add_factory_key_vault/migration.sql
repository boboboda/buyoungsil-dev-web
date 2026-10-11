-- 앱 공장 키 보관함: 업로드(서명) 키 항목(경로·별칭만, 비밀번호·파일 내용 없음)과 계정 기본 키·앱별 키 선택.
-- 새 표와 새 열만 추가한다. 기존 계정의 서명 키 경로·별칭, 앱별 '다른 키' 값은 지우지 않는다(서버가 첫 로드 때 보관함 항목으로 가져온다).

-- CreateTable
CREATE TABLE "factory_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'shared',
    "keystorePath" TEXT NOT NULL,
    "keyAlias" TEXT NOT NULL DEFAULT 'upload',
    "description" TEXT,
    "production" BOOLEAN NOT NULL DEFAULT false,
    "dname" TEXT,
    "createState" TEXT,
    "createTakenAt" TIMESTAMP(3),
    "checkRequestedAt" TIMESTAMP(3),
    "checkTakenAt" TIMESTAMP(3),
    "check" JSONB,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "factory_keys_name_key" ON "factory_keys"("name");

-- AlterTable
ALTER TABLE "factory_apps" ADD COLUMN "keyId" TEXT;
ALTER TABLE "factory_release_accounts" ADD COLUMN "defaultKeyId" TEXT;

-- AddForeignKey
ALTER TABLE "factory_apps" ADD CONSTRAINT "factory_apps_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "factory_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "factory_release_accounts" ADD CONSTRAINT "factory_release_accounts_defaultKeyId_fkey" FOREIGN KEY ("defaultKeyId") REFERENCES "factory_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
