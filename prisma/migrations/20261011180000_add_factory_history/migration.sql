-- 서버 배포 이력과 감독 프로그램 업데이트 이력. 새 표만 추가하고 기존 데이터는 지우지 않는다.

-- CreateTable
CREATE TABLE "factory_deploys" (
    "id" TEXT NOT NULL,
    "maintenanceId" TEXT NOT NULL,
    "commit" TEXT NOT NULL,
    "via" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "result" TEXT,

    CONSTRAINT "factory_deploys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_supervisor_events" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromCommit" TEXT,
    "commit" TEXT NOT NULL,
    "subject" TEXT,
    "note" TEXT,

    CONSTRAINT "factory_supervisor_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "factory_deploys_requestedAt_idx" ON "factory_deploys"("requestedAt");

-- CreateIndex
CREATE INDEX "factory_deploys_maintenanceId_requestedAt_idx" ON "factory_deploys"("maintenanceId", "requestedAt");

-- CreateIndex
CREATE INDEX "factory_supervisor_events_at_idx" ON "factory_supervisor_events"("at");

-- AddForeignKey
ALTER TABLE "factory_deploys" ADD CONSTRAINT "factory_deploys_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "factory_maintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 지금까지의 마지막 배포(정비마다 하나)를 이력 첫 줄로 옮겨 둔다
INSERT INTO "factory_deploys" ("id", "maintenanceId", "commit", "requestedAt", "startedAt", "finishedAt", "ok", "result")
SELECT 'mig_' || "id", "id", "deployCommit", "deployRequestedAt", "deployStartedAt",
       CASE WHEN "deployedAt" IS NOT NULL THEN "deployedAt" WHEN "deployResult" IS NOT NULL THEN "updatedAt" ELSE NULL END,
       CASE WHEN "deployedAt" IS NOT NULL THEN TRUE WHEN "deployResult" IS NOT NULL THEN FALSE ELSE NULL END,
       "deployResult"
FROM "factory_maintenance"
WHERE "deployRequestedAt" IS NOT NULL AND "deployCommit" IS NOT NULL;
