-- CreateTable
CREATE TABLE "note_sub_categories" (
    "id" TEXT NOT NULL,
    "mainCategory" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_sub_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_sub_categories_mainCategory_idx" ON "note_sub_categories"("mainCategory");

-- CreateIndex
CREATE UNIQUE INDEX "note_sub_categories_mainCategory_name_key" ON "note_sub_categories"("mainCategory", "name");

-- 기존 글(developNote)에 들어 있던 서브 카테고리를 (메인 카테고리, 이름) 단위로 이관
INSERT INTO "note_sub_categories" ("id", "mainCategory", "name", "order", "updatedAt")
SELECT
    md5(s."mainCategory" || '/' || s.sub_name),
    s."mainCategory",
    s.sub_name,
    (ROW_NUMBER() OVER (PARTITION BY s."mainCategory" ORDER BY s.sub_name) - 1)::INTEGER,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT
        "mainCategory",
        btrim("subCategory" ->> 'name') AS sub_name
    FROM "developNote"
    WHERE "mainCategory" IS NOT NULL
      AND "subCategory" IS NOT NULL
      AND jsonb_typeof("subCategory") = 'object'
      AND btrim(COALESCE("subCategory" ->> 'name', '')) <> ''
) AS s
ON CONFLICT DO NOTHING;