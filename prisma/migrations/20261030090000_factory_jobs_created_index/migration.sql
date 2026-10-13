-- 통제실 이력 [앱 일감] 쪽 나누기용 인덱스(요청 시각 최신순). 인덱스만 추가, 데이터는 그대로
CREATE INDEX IF NOT EXISTS "factory_jobs_createdAt_id_idx" ON "factory_jobs"("createdAt", "id");
