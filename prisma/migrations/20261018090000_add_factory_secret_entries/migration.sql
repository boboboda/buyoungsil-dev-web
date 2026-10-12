-- 통제실에서 입력하는 외부 서비스 키(환경변수). 새 표만 추가한다(기존 표·데이터는 건드리지 않음).
-- 값은 PC 가 가져갈 때까지만 암호문(sealed)으로 있고, PC 가 저장했다고 확인하면 지운다.

-- CreateTable
CREATE TABLE "factory_secret_entries" (
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sealed" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "storedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_secret_entries_pkey" PRIMARY KEY ("name")
);
