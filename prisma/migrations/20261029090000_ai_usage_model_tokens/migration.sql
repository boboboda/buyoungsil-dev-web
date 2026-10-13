-- 오늘 모델별 토큰 수(작업 PC 의 Claude Code 기록에서 셈). 열만 추가, 기존 값은 그대로
ALTER TABLE "ai_usage_limits" ADD COLUMN "modelTokens" JSONB;
