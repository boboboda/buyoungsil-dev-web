-- 결과물 카드(2-2). 새 테이블·새 칸만 추가하고 기존 데이터는 지우지 않는다.
CREATE TABLE "factory_cards" (
    "id" TEXT NOT NULL,
    "appSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tool" TEXT NOT NULL DEFAULT 'pixel-art',
    "method" TEXT NOT NULL DEFAULT '',
    "options" JSONB NOT NULL DEFAULT '{}',
    "refRules" JSONB NOT NULL DEFAULT '{}',
    "settings" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "factory_cards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "factory_cards_appSlug_name_key" ON "factory_cards"("appSlug", "name");
CREATE INDEX "factory_cards_appSlug_idx" ON "factory_cards"("appSlug");

CREATE TABLE "factory_card_history" (
    "id" SERIAL NOT NULL,
    "cardId" TEXT NOT NULL,
    "appSlug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT '통제실',
    "who" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_card_history_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "factory_card_history_cardId_version_idx" ON "factory_card_history"("cardId", "version");

ALTER TABLE "factory_arts" ADD COLUMN "cardId" TEXT, ADD COLUMN "cardVersion" INTEGER;
CREATE INDEX "factory_arts_cardId_idx" ON "factory_arts"("cardId");
ALTER TABLE "factory_jobs" ADD COLUMN "cardId" TEXT;
ALTER TABLE "factory_app_connections" ADD COLUMN "exportKind" TEXT, ADD COLUMN "exportPath" TEXT, ADD COLUMN "studioBatch" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "studioService" BOOLEAN NOT NULL DEFAULT false;

-- 기존 프로젝트 도구 설정 → 각 프로젝트의 '기본 카드'(같은 설정 그대로, 판 1). 카드 없이 시작하는 일감은 예전처럼 프로젝트 도구 설정을 쓰므로 지금 동작은 그대로다.
-- 도구 설정을 통제실·감독 프로그램에서 고치면 기본 카드의 설정도 같이 갱신된다(lib/factory/cardsDb.ts mirrorLegacySettings).
INSERT INTO "factory_cards" ("id", "appSlug", "name", "description", "tool", "method", "options", "refRules", "settings", "version", "updatedBy")
SELECT 'card_' || md5(s."appSlug" || ':기본 카드'), s."appSlug", '기본 카드', '프로젝트 도구 설정을 옮긴 카드. 설정 묶음은 프로젝트 도구 설정에서 고쳐요.', 'pixel-art', '', '{}'::jsonb, '{}'::jsonb, s."settings", 1, '정비(2-2 옮김)'
FROM "factory_project_tool_settings" s
ON CONFLICT DO NOTHING;

-- 시험용 초기 카드(한 컷). 기본 그림은 통제실에서 고른다(defaultArtId 비어 있음). 설정 묶음은 한 컷의 현재 도구 설정을 바탕으로 한다.
INSERT INTO "factory_cards" ("id", "appSlug", "name", "description", "tool", "method", "options", "refRules", "settings", "version", "updatedBy")
VALUES (
  'card_' || md5('one-tiny-frame:싹이 단독 짤'), 'one-tiny-frame', '싹이 단독 짤', '싹이 혼자 나오는 짤. PixelLab, 배경 투명, 기본 그림을 1순위로 고정.', 'pixel-art', 'pixellab',
  '{"kind":"image-prop","background":"transparent"}'::jsonb,
  '{"pinDefault":true,"defaultArtId":null,"sameSubject":true,"sameKind":false,"maxRefs":3}'::jsonb,
  COALESCE((SELECT "settings" FROM "factory_project_tool_settings" WHERE "appSlug" = 'one-tiny-frame'), ''), 1, '정비(2-2 초기 카드)'
) ON CONFLICT DO NOTHING;
INSERT INTO "factory_cards" ("id", "appSlug", "name", "description", "tool", "method", "options", "refRules", "settings", "version", "updatedBy")
VALUES (
  'card_' || md5('one-tiny-frame:여러 환경 짤 128'), 'one-tiny-frame', '여러 환경 짤 128', '싹이를 여러 환경에 놓은 짤. PixelLab, 128px, 배경 있음.', 'pixel-art', 'pixellab',
  '{"kind":"image-prop","size":128,"background":"scene"}'::jsonb,
  '{"pinDefault":false,"defaultArtId":null,"sameSubject":true,"sameKind":true,"maxRefs":3}'::jsonb,
  COALESCE((SELECT "settings" FROM "factory_project_tool_settings" WHERE "appSlug" = 'one-tiny-frame'), ''), 1, '정비(2-2 초기 카드)'
) ON CONFLICT DO NOTHING;

-- 변경 이력 1번(옮김·초기 카드)
INSERT INTO "factory_card_history" ("cardId", "appSlug", "version", "source", "who", "note", "snapshot")
SELECT c."id", c."appSlug", 1, '정비', c."updatedBy", CASE WHEN c."name" = '기본 카드' THEN '프로젝트 도구 설정에서 옮김' ELSE '시험용 초기 카드' END,
  jsonb_build_object('name', c."name", 'description', c."description", 'tool', c."tool", 'method', c."method", 'options', c."options", 'refRules', c."refRules", 'settings', c."settings", 'enabled', c."enabled")
FROM "factory_cards" c
WHERE NOT EXISTS (SELECT 1 FROM "factory_card_history" h WHERE h."cardId" = c."id");
