// scripts/send-test-event.ts
// 사용법: npx tsx scripts/send-test-event.ts <서버 주소> <수집 키>
// 예시:   npx tsx scripts/send-test-event.ts http://localhost:5000 ak_xxxxx

async function main() {
  const [baseUrl, key] = process.argv.slice(2);

  if (!baseUrl || !key) {
    console.error("사용법: npx tsx scripts/send-test-event.ts <서버 주소> <수집 키>");
    process.exitCode = 1;

    return;
  }

  const now = Date.now();
  const body = {
    installId: "test-install-1",
    appVersion: "0.0.0-test",
    platform: "android",
    osVersion: "test",
    events: [
      { id: `t-${now}-1`, name: "session_start", ts: now },
      { id: `t-${now}-2`, name: "ad_impression", ts: now, params: { format: "banner" } },
      {
        id: `t-${now}-3`,
        name: "ad_paid",
        ts: now,
        params: { format: "banner", valueMicros: 1500, currency: "USD" },
      },
    ],
  };

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/analytics/collect`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-analytics-key": key },
    body: JSON.stringify(body),
  });

  console.log(res.status, await res.text());
}

main().catch((error) => {
  console.error("전송 실패:", error);
  process.exitCode = 1;
});