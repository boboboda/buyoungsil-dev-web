-- 앱 공장 키 보관함: [커밋에서 빼기](앱 폴더 git 추적 해제) 요청·결과, 경로를 바꿔도 비밀번호가 이어지게 하는 구분값. 새 열만 추가한다.
ALTER TABLE "factory_keys" ADD COLUMN "untrackRequestedAt" TIMESTAMP(3),
ADD COLUMN "untrackTakenAt" TIMESTAMP(3),
ADD COLUMN "untrack" JSONB,
ADD COLUMN "passwordRef" TEXT;
