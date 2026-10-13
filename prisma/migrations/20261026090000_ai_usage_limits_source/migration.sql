-- AI 한도: 값 출처·자동 수집 실패 사유·모델별 주간 한도. 열 추가만(기존 데이터 유지)
ALTER TABLE "ai_usage_limits" ADD COLUMN "failReason" TEXT;
ALTER TABLE "ai_usage_limits" ADD COLUMN "source" TEXT;
ALTER TABLE "ai_usage_limits" ADD COLUMN "extraWindows" JSONB;
