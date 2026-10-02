// components/admin/analytics/ServerStatsView.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Chip } from "@heroui/react";

import type { ServerStats } from "@/lib/analytics/serverStats";
import { refreshServerStats } from "@/serverActions/analyticsStats";

const numberFormat = new Intl.NumberFormat("ko-KR");

const fmtNum = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "-"
    : numberFormat.format(Math.round(n));

const fmtBytes = (b: number | null | undefined) => {
  if (b === null || b === undefined || !Number.isFinite(b)) return "-";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = b;
  let i = 0;

  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }

  return `${n.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
};

const fmtKst = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-";

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="text-xs text-default-500">{label}</span>
      <span className="text-lg font-semibold tabular-nums break-words">{value}</span>
      {sub ? <span className="text-xs text-default-400">{sub}</span> : null}
    </div>
  );
}

function Missing({ name }: { name: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-sm text-default-500">
          {name}을 찾지 못했습니다. 아래 컬렉션별 용량에서 실제 이름을 확인하세요.
        </p>
      </CardBody>
    </Card>
  );
}

export default function ServerStatsView({
  stats,
  error,
}: {
  stats: ServerStats | null;
  error: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleRefresh = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const res = await refreshServerStats();

      if (!res.ok) setMessage(res.message ?? "새로고침에 실패했습니다.");
      router.refresh();
    } catch {
      setMessage("새로고침에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const rate = stats?.rate;
  const users = stats?.users;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">서버 현황</h2>
          <p className="text-xs text-default-500">
            조회 시각 {fmtKst(stats?.fetchedAt ?? null)} (5분마다 갱신)
          </p>
        </div>
        <Button
          color="primary"
          isLoading={loading}
          size="sm"
          variant="flat"
          onPress={handleRefresh}
        >
          새로고침
        </Button>
      </div>

      {error ? (
        <Card>
          <CardBody>
            <p className="text-sm text-danger">{error}</p>
          </CardBody>
        </Card>
      ) : null}
      {message ? <p className="text-sm text-danger">{message}</p> : null}

      {stats ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {rate ? (
              <Card>
                <CardHeader className="font-semibold">환율 데이터</CardHeader>
                <CardBody>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                    <Stat label="문서 수" value={fmtNum(rate.count)} />
                    <Stat
                      label="데이터 크기"
                      sub={`평균 ${fmtBytes(rate.avgObjSize)}/건`}
                      value={fmtBytes(rate.dataSize)}
                    />
                    <Stat label="저장 시작" value={rate.firstAt ?? "-"} />
                    <Stat label="최신 기록" value={rate.lastAt ?? "-"} />
                    <Stat
                      label="디스크 사용"
                      sub={`인덱스 ${fmtBytes(rate.indexSize)}`}
                      value={fmtBytes(rate.storageSize)}
                    />
                    <Stat
                      label="기간"
                      value={rate.days ? `${fmtNum(rate.days)}일` : "-"}
                    />
                    <Stat
                      label="하루 평균"
                      sub={fmtBytes(rate.perDayBytes)}
                      value={`${fmtNum(rate.perDayCount)}건`}
                    />
                    <Stat label="30일 증가 예상" value={fmtBytes(rate.monthlyBytes)} />
                  </div>
                </CardBody>
              </Card>
            ) : (
              <Missing name="환율 컬렉션" />
            )}

            {users ? (
              <Card>
                <CardHeader className="font-semibold">앱 사용자</CardHeader>
                <CardBody className="flex flex-col gap-5">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                    <Stat
                      label="소셜 계정 (중복 제거)"
                      sub="Google + Kakao"
                      value={fmtNum(users.socialAccounts)}
                    />
                    <Stat
                      label="전체 문서 수 (기기 기준)"
                      value={fmtNum(users.totalDocs)}
                    />
                    <Stat label="소셜 연동 문서 수" value={fmtNum(users.socialDocs)} />
                    <Stat
                      label="2개 이상 기기에 연결된 계정"
                      value={fmtNum(users.multiDeviceAccounts)}
                    />
                    <Stat
                      label="첫 기기 문서 생성일"
                      value={fmtKst(users.firstCreatedAt)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {users.perProvider.map((p) => (
                      <Chip key={p.provider} color="primary" size="sm" variant="flat">
                        {p.provider} {fmtNum(p.count)}
                      </Chip>
                    ))}
                    {users.byType
                      .filter((t) => t.socialType === "NONE")
                      .map((t) => (
                        <Chip key={t.socialType} size="sm" variant="flat">
                          소셜 미연동 문서 {fmtNum(t.count)}
                        </Chip>
                      ))}
                  </div>
                </CardBody>
              </Card>
            ) : (
              <Missing name="users 컬렉션" />
            )}
          </div>

          {users && users.monthly.length > 0 ? (
            <Card>
              <CardHeader className="font-semibold">월별 신규 기기 문서</CardHeader>
              <CardBody>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-default-500 border-b border-divider">
                        <th className="py-2 pr-4 font-medium">월</th>
                        <th className="py-2 pr-4 font-medium text-right">신규 기기</th>
                        <th className="py-2 font-medium text-right">현재 소셜 연동</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.monthly.map((m) => (
                        <tr key={m.month} className="border-b border-divider/50">
                          <td className="py-2 pr-4 tabular-nums">{m.month}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {fmtNum(m.devices)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {fmtNum(m.social)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-default-400 mt-3">
                  앱을 재설치하면 새 기기 문서가 생기므로 실제 가입자 수보다 많을 수
                  있습니다. 소셜 연동 시각은 저장되지 않아 가입 추이는 기기 문서
                  생성일 기준입니다.
                </p>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="font-semibold">컬렉션별 용량</CardHeader>
            <CardBody>
              <p className="text-sm text-default-500 mb-3">
                DB 전체: 데이터 {fmtBytes(stats.db.dataSize)} · 디스크{" "}
                {fmtBytes(stats.db.storageSize)} · 인덱스 {fmtBytes(stats.db.indexSize)}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-default-500 border-b border-divider">
                      <th className="py-2 pr-4 font-medium">컬렉션</th>
                      <th className="py-2 pr-4 font-medium text-right">문서 수</th>
                      <th className="py-2 pr-4 font-medium text-right">데이터</th>
                      <th className="py-2 pr-4 font-medium text-right">디스크</th>
                      <th className="py-2 font-medium text-right">인덱스</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.collections.map((c) => (
                      <tr key={c.name} className="border-b border-divider/50">
                        <td className="py-2 pr-4 font-mono">{c.name}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {fmtNum(c.count)}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {fmtBytes(c.dataSize)}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {fmtBytes(c.storageSize)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {fmtBytes(c.indexSize)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}