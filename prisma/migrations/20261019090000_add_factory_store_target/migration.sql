-- 앱 공장 출시 패키지: 출시 대상(스토어에 실제로 올릴 앱) 표시. 열을 추가하고, 이미 출시 작업이 진행된 앱만 한 번 대상으로 표시한다.
-- 데이터를 지우지 않는다. 조건은 lib/factory/storeTarget.ts 의 shouldBackfillStoreTarget 과 같다.
ALTER TABLE "factory_apps" ADD COLUMN "storeTarget" BOOLEAN NOT NULL DEFAULT false;

UPDATE "factory_apps" AS a
SET "storeTarget" = true
WHERE (
    a."releaseAccountId" IS NOT NULL
    OR a."packageName" IS NOT NULL
    OR a."firstUploadDone" = true
    OR a."releaseStatus" <> 'preparing'
    OR EXISTS (SELECT 1 FROM "factory_jobs" j WHERE j."appSlug" = a."appSlug" AND j."kind" = 'release')
  )
  -- 마지막 일감의 종류가 웹사이트·서버면 제외(일감이 없는 앱도 제외)
  AND (
    SELECT j."stack" FROM "factory_jobs" j WHERE j."appSlug" = a."appSlug" ORDER BY j."createdAt" DESC LIMIT 1
  ) NOT IN ('nextjs', 'nestjs')
  -- 예전 [삭제]로 숨긴 앱(지운 뒤 새 일감 없음)은 제외
  AND (
    a."releaseRemovedAt" IS NULL
    OR EXISTS (SELECT 1 FROM "factory_jobs" j WHERE j."appSlug" = a."appSlug" AND j."createdAt" > a."releaseRemovedAt")
  );
