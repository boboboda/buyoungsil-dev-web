-- CreateTable
CREATE TABLE "daily_visitor_counts" (
    "id" TEXT NOT NULL,
    "visit_date" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_visitor_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "total_visitor_counts" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "total_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "total_visitor_counts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_visitor_counts_visit_date_key" ON "daily_visitor_counts"("visit_date");
