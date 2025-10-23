/*
  Warnings:

  - Added the required column `email` to the `comments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `email` to the `posts` table without a default value. This is not possible if the table is not empty.
  - Added the required column `email` to the `replies` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "email" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "email" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "replies" ADD COLUMN     "email" TEXT NOT NULL;
