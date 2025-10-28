-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "techStack" TEXT[] DEFAULT ARRAY[]::TEXT[];
