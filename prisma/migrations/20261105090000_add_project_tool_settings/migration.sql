-- 프로젝트별 도구 설정(pixel-art 의 settings 인자): 현재 값 표 + 변경 이력 표. 새 표만 추가한다. 기존 데이터는 건드리지 않는다.

-- CreateTable
CREATE TABLE "factory_project_tool_settings" (
    "appSlug" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "settings" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "factory_project_tool_settings_pkey" PRIMARY KEY ("appSlug")
);

-- CreateTable
CREATE TABLE "factory_project_tool_setting_history" (
    "id" SERIAL NOT NULL,
    "appSlug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "settings" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "factory_project_tool_setting_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "factory_project_tool_setting_history_appSlug_version_idx" ON "factory_project_tool_setting_history"("appSlug", "version");

-- 처음 값: one-tiny-frame(하찮은 한 컷)은 툴킷 예시 파일(project-settings.one-tiny-frame.json) 내용. 나머지 프로젝트는 비워 둔다(= 도구 기본값).
INSERT INTO "factory_project_tool_settings" ("appSlug", "version", "settings", "updatedBy") VALUES ('one-tiny-frame', 1, '{"version":1,"methods":{"image-prop":{"allowed":["codex","claude"],"default":"codex"},"image-scene":{"allowed":["codex"],"default":"codex"},"motion-game":{"allowed":["claude","codex"],"default":"claude"},"motion-clip":{"allowed":["manual","codex"],"default":"manual"}},"results":{"allowed_kinds":["image-prop","image-scene","motion-game","motion-clip"],"default_kind":"image-prop"},"spec":{"cell_size":32,"size_group":"small","canvas":1024},"style":{"outline_color":"#3a2820","max_colors":16,"preset":"ssagi","notes":"둥근 몸, 작은 발, 굵은 어두운 외곽선"},"motion":{"preset":"walk","frames":8,"fps":8,"loop":"pingpong","pixel_motion":{"stride":7,"lift":3,"bob":2,"sway":1,"facing":"right"}},"cost":{"pixellab_per_job":3,"pixellab_per_month":30},"references":{"auto_max":3,"approved":[{"path":"style-anchors/ssagi/side.png","subject":"싹이","kind":"motion-game","project":"one-tiny-frame"}]},"aliases":{"싹이":["감자","ssagi"]}}', '시스템(처음 값)') ON CONFLICT ("appSlug") DO NOTHING;
INSERT INTO "factory_project_tool_setting_history" ("appSlug", "version", "settings", "note", "createdBy") SELECT 'one-tiny-frame', 1, '{"version":1,"methods":{"image-prop":{"allowed":["codex","claude"],"default":"codex"},"image-scene":{"allowed":["codex"],"default":"codex"},"motion-game":{"allowed":["claude","codex"],"default":"claude"},"motion-clip":{"allowed":["manual","codex"],"default":"manual"}},"results":{"allowed_kinds":["image-prop","image-scene","motion-game","motion-clip"],"default_kind":"image-prop"},"spec":{"cell_size":32,"size_group":"small","canvas":1024},"style":{"outline_color":"#3a2820","max_colors":16,"preset":"ssagi","notes":"둥근 몸, 작은 발, 굵은 어두운 외곽선"},"motion":{"preset":"walk","frames":8,"fps":8,"loop":"pingpong","pixel_motion":{"stride":7,"lift":3,"bob":2,"sway":1,"facing":"right"}},"cost":{"pixellab_per_job":3,"pixellab_per_month":30},"references":{"auto_max":3,"approved":[{"path":"style-anchors/ssagi/side.png","subject":"싹이","kind":"motion-game","project":"one-tiny-frame"}]},"aliases":{"싹이":["감자","ssagi"]}}', '처음 값(툴킷 예시)', '시스템(처음 값)' WHERE NOT EXISTS (SELECT 1 FROM "factory_project_tool_setting_history" WHERE "appSlug" = 'one-tiny-frame');
