/*
  Warnings:

  - You are about to drop the column `password` on the `comments` table. All the data in the column will be lost.
  - You are about to drop the column `password` on the `posts` table. All the data in the column will be lost.
  - You are about to drop the column `password` on the `replies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "comments" DROP COLUMN "password";

-- AlterTable
ALTER TABLE "posts" DROP COLUMN "password";

-- AlterTable
ALTER TABLE "replies" DROP COLUMN "password";
