-- 병렬화 단계 C-2: 지휘자(같은 앱 대기 일감이 겹치는지 판단해 자동으로 '같이 돌리기'로 묶음). 추가만, 기존 데이터는 그대로.
-- parallelSource: 그룹 출처. manual = 사람이 묶거나 푼 일감(지휘자는 바꾸지 않음), conductor = 지휘자가 묶음. NULL = 예전 일감.
-- conductorInfo: 지휘자 판단 기록(결정·이유·예상 파일·영역·확신도·판단 키). 비밀값 없음.
ALTER TABLE "factory_jobs" ADD COLUMN "parallelSource" TEXT;
ALTER TABLE "factory_jobs" ADD COLUMN "conductorInfo" JSONB;
