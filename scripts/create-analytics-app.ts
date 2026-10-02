// scripts/create-analytics-app.ts
// 사용법: npx tsx scripts/create-analytics-app.ts <appId> <표시 이름>
// 예시:   npx tsx scripts/create-analytics-app.ts exchange-rate 환율 기록 어플
import { randomBytes } from "node:crypto";

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: ".env.local" });

const prisma = new PrismaClient();

async function main() {
  const [appId, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();

  if (!appId || !/^[a-z0-9][a-z0-9-]{1,30}$/.test(appId)) {
    console.error(
      "사용법: npx tsx scripts/create-analytics-app.ts <appId> <표시 이름>\n" +
        "appId는 영문 소문자, 숫자, - 만 쓸 수 있습니다 (2~31자).",
    );
    process.exitCode = 1;

    return;
  }

  const existing = await prisma.analyticsApp.findUnique({ where: { appId } });

  if (existing) {
    console.log("이미 등록된 앱입니다.");
    console.log(`appId     : ${existing.appId}`);
    console.log(`이름      : ${existing.name}`);
    console.log(`수집 키   : ${existing.ingestKey}`);

    return;
  }

  const ingestKey = `ak_${randomBytes(24).toString("base64url")}`;
  const created = await prisma.analyticsApp.create({
    data: { appId, name: name || appId, ingestKey },
  });

  console.log("앱을 등록했습니다.");
  console.log(`appId     : ${created.appId}`);
  console.log(`이름      : ${created.name}`);
  console.log(`수집 키   : ${created.ingestKey}`);
}

main()
  .catch((error) => {
    console.error("등록 실패:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });