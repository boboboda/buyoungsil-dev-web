-- 병렬화 단계 C-1: 같은 앱 일감 병행 실행(git worktree). 추가만, 기존 데이터는 그대로.
-- parallelGroup: 같은 앱·같은 그룹의 승인된 수정 일감은 동시에 실행할 수 있다(NULL = 지금처럼 앱당 1개).
-- parallelInfo: 감독 프로그램이 보고하는 병행 상태(worktree 실행·잠금 대기·합치는 중·다시 맞추기 횟수·합친 시각·검사 결과).
ALTER TABLE "factory_jobs" ADD COLUMN "parallelGroup" TEXT;
ALTER TABLE "factory_jobs" ADD COLUMN "parallelInfo" JSONB;
CREATE INDEX "factory_jobs_appSlug_parallelGroup_idx" ON "factory_jobs"("appSlug", "parallelGroup");
