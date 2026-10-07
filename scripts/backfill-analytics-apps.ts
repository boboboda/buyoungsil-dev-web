// scripts/backfill-analytics-apps.ts
// 이미 등록돼 있는 프로젝트(모바일·웹)마다 분석 앱을 만든다. 이미 있으면 건너뛴다.
// 사용법: npx tsx scripts/backfill-analytics-apps.ts
import { randomBytes } from "node:crypto";

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: ".env.local" });

const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({
    where: { platform: { in: ["mobile", "web"] } },
    select: { name: true, title: true, platform: true },
    orderBy: { createdAt: "asc" },
  });

  let created = 0;

  for (const p of projects) {
    const exists = await prisma.analyticsApp.findUnique({ where: { appId: p.name } });

    if (exists) continue;

    await prisma.analyticsApp.create({
      data: {
        appId: p.name,
        name: p.title,
        ingestKey: `ak_${randomBytes(24).toString("base64url")}`,
      },
    });
    created += 1;
    console.log(`+ ${p.title} (${p.name})`);
  }

  console.log(`완료: 프로젝트 ${projects.length}개 중 ${created}개 새로 연결했습니다.`);
}

main()
  .catch((error) => {
    console.error("실패:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
