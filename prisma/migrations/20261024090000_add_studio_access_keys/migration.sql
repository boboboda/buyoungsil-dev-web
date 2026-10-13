-- Studio 접근 키(앱 이름별, 해시만 저장). 표 추가만
CREATE TABLE "studio_access_keys" (
    "id" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "studio_access_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "studio_access_keys_keyHash_key" ON "studio_access_keys"("keyHash");

CREATE INDEX "studio_access_keys_app_revokedAt_idx" ON "studio_access_keys"("app", "revokedAt");
