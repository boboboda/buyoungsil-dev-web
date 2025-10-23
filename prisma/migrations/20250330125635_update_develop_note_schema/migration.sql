/*
  Warnings:

  - The `subCategory` column on the `developNote` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "developNote" ALTER COLUMN "title" DROP NOT NULL,
ALTER COLUMN "content" DROP NOT NULL,
DROP COLUMN "subCategory",
ADD COLUMN     "subCategory" JSONB;
