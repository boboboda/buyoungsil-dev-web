-- 공장 정비(대화형 스레드). 새 테이블만 추가, 기존 데이터는 건드리지 않는다.

-- CreateTable
CREATE TABLE "factory_maintenance" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "sessionId" TEXT,
    "pushedCommit" TEXT,
    "needsDeploy" BOOLEAN NOT NULL DEFAULT false,
    "deployCommit" TEXT,
    "deployRequestedAt" TIMESTAMP(3),
    "deployStartedAt" TIMESTAMP(3),
    "deployedAt" TIMESTAMP(3),
    "deployResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factory_maintenance_messages" (
    "id" TEXT NOT NULL,
    "maintenanceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),

    CONSTRAINT "factory_maintenance_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "factory_maintenance_updatedAt_idx" ON "factory_maintenance"("updatedAt");

-- CreateIndex
CREATE INDEX "factory_maintenance_messages_maintenanceId_createdAt_idx" ON "factory_maintenance_messages"("maintenanceId", "createdAt");

-- CreateIndex
CREATE INDEX "factory_maintenance_messages_status_idx" ON "factory_maintenance_messages"("status");

-- AddForeignKey
ALTER TABLE "factory_maintenance_messages" ADD CONSTRAINT "factory_maintenance_messages_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "factory_maintenance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

