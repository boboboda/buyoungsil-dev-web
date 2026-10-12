-- Additive only. Existing jobs, turns and Claude session IDs retain their meaning.
ALTER TABLE "factory_jobs" ADD COLUMN "aiEngine" TEXT NOT NULL DEFAULT 'claude';
ALTER TABLE "factory_maintenance" ADD COLUMN "codexSessionId" TEXT;
ALTER TABLE "factory_maintenance_messages" ADD COLUMN "aiEngine" TEXT NOT NULL DEFAULT 'claude';
ALTER TABLE "factory_jobs" ADD CONSTRAINT "factory_jobs_ai_engine_check" CHECK ("aiEngine" IN ('claude', 'codex'));
ALTER TABLE "factory_maintenance_messages" ADD CONSTRAINT "factory_maintenance_ai_engine_check" CHECK ("aiEngine" IN ('claude', 'codex'));
