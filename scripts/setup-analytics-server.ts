// scripts/setup-analytics-server.ts
// 서버 DB에 분석 테이블을 만들고, 앱을 등록해서 수집 키를 발급한다.
// 사용법: npx tsx scripts/setup-analytics-server.ts
//   (다른 DB 를 쓰려면 인자로 주소를 넘기거나 .env.local 에 SERVER_DATABASE_URL 을 넣는다)
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: ".env.local" });

// 서버 DB 주소 (PC 의 localhost 가 아니라 서버 주소)
const DEFAULT_SERVER_DATABASE_URL =
  "***REMOVED***?schema=public&sslmode=no-verify";

const APP_ID = "exchange-rate";
const APP_NAME = "환율 기록 어플";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

function parseTarget(raw: string) {
  try {
    const u = new URL(raw);

    return {
      host: u.hostname,
      port: u.port || "5432",
      db: u.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

async function main() {
  const url =
    process.argv[2] || process.env.SERVER_DATABASE_URL || DEFAULT_SERVER_DATABASE_URL;

  const target = parseTarget(url);

  if (!target) {
    console.error("DATABASE_URL 형식이 올바르지 않습니다. (비밀번호에 특수문자가 있으면 URL 인코딩이 필요합니다)");
    process.exitCode = 1;

    return;
  }

  // 이 PC 의 DB 에 잘못 만드는 실수를 막는다
  if (LOCAL_HOSTS.includes(target.host)) {
    console.error(
      `대상이 ${target.host} 입니다. 이 PC 의 DB 를 가리킵니다.\n` +
        "서버 주소(buyoungsil.ddns.net)로 바꿔서 다시 실행해 주세요.",
    );
    process.exitCode = 1;

    return;
  }

  console.log(`대상 DB: ${target.host}:${target.port} / ${target.db}`);

  // 1) 테이블 생성
  const run = spawnSync(
    "npx",
    ["prisma", "db", "execute", "--file", "prisma/manual/analytics.sql", "--url", url],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

  if (run.status !== 0) {
    if (/already exists/i.test(output)) {
      console.log("테이블이 이미 있어 생성은 건너뜁니다.");
    } else {
      console.error("테이블 생성 실패:\n" + output);
      process.exitCode = 1;

      return;
    }
  } else {
    console.log("테이블 4개를 만들었습니다.");
  }

  // 2) 앱 등록 + 수집 키 발급
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const existing = await prisma.analyticsApp.findUnique({ where: { appId: APP_ID } });
    const app =
      existing ??
      (await prisma.analyticsApp.create({
        data: {
          appId: APP_ID,
          name: APP_NAME,
          ingestKey: `ak_${randomBytes(24).toString("base64url")}`,
        },
      }));

    console.log(existing ? "이미 등록된 앱입니다." : "앱을 등록했습니다.");
    console.log(`appId     : ${app.appId}`);
    console.log(`이름      : ${app.name}`);
    console.log(`수집 키   : ${app.ingestKey}`);
    console.log("\n이 수집 키를 local.properties 의 analytics_key 에 넣고 앱을 다시 빌드하세요.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("실패:", error);
  process.exitCode = 1;
});