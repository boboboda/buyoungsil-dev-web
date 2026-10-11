-- CreateTable
CREATE TABLE "factory_apps" (
    "appSlug" TEXT NOT NULL,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_apps_pkey" PRIMARY KEY ("appSlug")
);

-- CreateIndex
CREATE UNIQUE INDEX "factory_apps_projectId_key" ON "factory_apps"("projectId");
