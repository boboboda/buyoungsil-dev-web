-- CreateTable
CREATE TABLE "edu_posts" (
    "id" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edu_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edu_replies" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edu_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "edu_posts_board_created_at_idx" ON "edu_posts"("board", "created_at");

-- CreateIndex
CREATE INDEX "edu_replies_post_id_idx" ON "edu_replies"("post_id");

-- AddForeignKey
ALTER TABLE "edu_replies" ADD CONSTRAINT "edu_replies_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "edu_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
