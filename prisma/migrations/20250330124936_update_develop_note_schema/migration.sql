/*
  Warnings:

  - You are about to drop the column `author` on the `developNote` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `developNote` table. All the data in the column will be lost.
  - You are about to drop the column `tags` on the `developNote` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "developNote" DROP COLUMN "author",
DROP COLUMN "description",
DROP COLUMN "tags",
ADD COLUMN     "mainCategory" TEXT,
ADD COLUMN     "subCategory" TEXT;
