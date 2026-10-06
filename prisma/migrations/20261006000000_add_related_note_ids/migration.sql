-- AlterTable
ALTER TABLE "developNote" ADD COLUMN     "relatedNoteIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];