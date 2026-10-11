-- 앱 공장 출시 자동화 1단계: 배포 계정 정보 보강, 앱별 다른 키, 키 비밀번호 임시 보관, 출시 일감 종류·실패 단계·재시도 단계.
-- 새 열·새 표만 추가한다. 기존 데이터는 지우거나 바꾸지 않는다(새 열은 모두 비어 있거나 NULL).

-- AlterTable: 배포 계정 (Play Console 개발자 계정 ID, 계정 유형, 로그인 구글 이메일)
ALTER TABLE "factory_release_accounts" ADD COLUMN "developerAccountId" TEXT,
ADD COLUMN "accountType" TEXT,
ADD COLUMN "loginEmail" TEXT;

-- AlterTable: 앱별 '다른 키 사용' (공용 키 대신)
ALTER TABLE "factory_apps" ADD COLUMN "customKeystorePath" TEXT,
ADD COLUMN "customKeyAlias" TEXT;

-- AlterTable: 출시 일감 종류(first | store | project, NULL = 예전 일감 = first), 실패 단계, 재시도 시작 단계
ALTER TABLE "factory_jobs" ADD COLUMN "releaseKind" TEXT,
ADD COLUMN "failStage" TEXT,
ADD COLUMN "resumeFrom" TEXT,
ADD COLUMN "resumeNote" TEXT;

-- CreateTable: 키 비밀번호 임시 보관(암호화). PC 감독 프로그램이 가져가면 sealed 를 비운다(등록 기록만 남음)
CREATE TABLE "factory_key_passwords" (
    "keyRef" TEXT NOT NULL,
    "keystorePath" TEXT NOT NULL,
    "keyAlias" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "keyName" TEXT NOT NULL,
    "sealed" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "factory_key_passwords_pkey" PRIMARY KEY ("keyRef")
);
