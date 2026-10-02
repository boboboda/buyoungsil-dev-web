-- prisma/manual/analytics.sql
-- 이벤트 분석용 새 테이블 4개를 만든다. 기존 테이블은 건드리지 않는다.
BEGIN;

CREATE TABLE "analytics_apps" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ingestKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_apps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_events" (
    "id" SERIAL NOT NULL,
    "appId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "sessionId" TEXT,
    "name" TEXT NOT NULL,
    "params" JSONB,
    "appVersion" TEXT,
    "platform" TEXT,
    "osVersion" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_installs" (
    "appId" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "appVersion" TEXT,
    "platform" TEXT,
    "osVersion" TEXT,

    CONSTRAINT "analytics_installs_pkey" PRIMARY KEY ("appId","installId")
);

CREATE TABLE "daily_active_installs" (
    "appId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "installId" TEXT NOT NULL,

    CONSTRAINT "daily_active_installs_pkey" PRIMARY KEY ("appId","date","installId")
);

CREATE UNIQUE INDEX "analytics_apps_appId_key" ON "analytics_apps"("appId");
CREATE UNIQUE INDEX "analytics_apps_ingestKey_key" ON "analytics_apps"("ingestKey");

CREATE UNIQUE INDEX "analytics_events_appId_eventId_key" ON "analytics_events"("appId", "eventId");
CREATE INDEX "analytics_events_appId_occurredAt_idx" ON "analytics_events"("appId", "occurredAt");
CREATE INDEX "analytics_events_appId_name_occurredAt_idx" ON "analytics_events"("appId", "name", "occurredAt");
CREATE INDEX "analytics_events_appId_installId_occurredAt_idx" ON "analytics_events"("appId", "installId", "occurredAt");

CREATE INDEX "analytics_installs_appId_lastSeenAt_idx" ON "analytics_installs"("appId", "lastSeenAt");
CREATE INDEX "analytics_installs_appId_firstSeenAt_idx" ON "analytics_installs"("appId", "firstSeenAt");

CREATE INDEX "daily_active_installs_appId_date_idx" ON "daily_active_installs"("appId", "date");

ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_appId_fkey" FOREIGN KEY ("appId") REFERENCES "analytics_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_installs" ADD CONSTRAINT "analytics_installs_appId_fkey" FOREIGN KEY ("appId") REFERENCES "analytics_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_active_installs" ADD CONSTRAINT "daily_active_installs_appId_fkey" FOREIGN KEY ("appId") REFERENCES "analytics_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;