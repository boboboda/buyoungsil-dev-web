-- 통제실 '장비 상태': 장비별 최신 값 + 5분 간격 24시간 이력. 표 추가만(기존 데이터 유지)
CREATE TABLE "device_stats" (
    "device" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_stats_pkey" PRIMARY KEY ("device")
);

CREATE TABLE "device_stat_samples" (
    "id" SERIAL NOT NULL,
    "device" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "cpuPct" DOUBLE PRECISION,
    "ramPct" DOUBLE PRECISION,
    "gpuPct" DOUBLE PRECISION,
    "diskPct" DOUBLE PRECISION,

    CONSTRAINT "device_stat_samples_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_stat_samples_device_at_idx" ON "device_stat_samples"("device", "at");
