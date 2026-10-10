-- CreateTable
CREATE TABLE "factory_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factory_settings_pkey" PRIMARY KEY ("key")
);
