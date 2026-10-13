-- AI 구독 한도 사용률 최신 스냅샷(AI 하나에 1행). 표 추가만
CREATE TABLE "ai_usage_limits" (
    "provider" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "fiveHourPct" DOUBLE PRECISION,
    "fiveHourResetsAt" TIMESTAMP(3),
    "sevenDayPct" DOUBLE PRECISION,
    "sevenDayResetsAt" TIMESTAMP(3),
    "asOf" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_limits_pkey" PRIMARY KEY ("provider")
);
