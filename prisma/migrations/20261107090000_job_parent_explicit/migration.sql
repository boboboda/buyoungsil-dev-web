-- 같은 앱 일감 쌓기(병렬화 단계 B): 등록 때 parentJobId 를 직접 적은 일감은 실행 시작 때 부모를 다시 정하지 않는다. 추가만, 기존 데이터는 그대로.
ALTER TABLE "factory_jobs" ADD COLUMN "parentExplicit" BOOLEAN NOT NULL DEFAULT false;
