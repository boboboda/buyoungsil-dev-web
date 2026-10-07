"use client";

// 프로젝트 수정 화면의 "앱 분석 연동" 카드. 수집 키와 연결 방법을 보여 준다.
import { useState } from "react";
import { Button, Card, CardBody } from "@heroui/react";

import {
  AnalyticsConnectInfo,
  getAnalyticsConnectInfo,
} from "@/serverActions/analyticsApp";

export default function AnalyticsConnectCard({
  projectId,
  platform,
}: {
  projectId: string;
  platform: string;
}) {
  const [info, setInfo] = useState<AnalyticsConnectInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const endpoint =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/analytics/collect`
      : "/api/analytics/collect";

  const load = async () => {
    setLoading(true);
    setError(null);

    const res = await getAnalyticsConnectInfo(projectId);

    if (res.ok && res.info) setInfo(res.info);
    else setError(res.message ?? "수집 키를 불러오지 못했습니다.");

    setLoading(false);
  };

  const copy = (text: string) => navigator.clipboard?.writeText(text);

  if (platform === "backend") return null;

  return (
    <Card>
      <CardBody className="gap-3">
        <div>
          <p className="text-sm font-medium">📈 앱 분석 연동</p>
          <p className="text-xs text-gray-500 mt-1">
            프로젝트를 등록하면 분석 앱이 같이 만들어지고 /admin/analytics 앱 목록에 나타납니다.
            앱이나 웹사이트에 <code>templates/analytics</code> 의 SDK를 넣고 아래 주소와 키만 설정하세요.
          </p>
        </div>

        {!info && (
          <Button
            className="self-start"
            color="primary"
            isLoading={loading}
            size="sm"
            variant="flat"
            onClick={load}
          >
            수집 키 보기
          </Button>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}

        {info && (
          <div className="flex flex-col gap-2 text-xs font-mono">
            <Row label="appId" value={info.appId} onCopy={copy} />
            <Row label="주소" value={endpoint} onCopy={copy} />
            <Row label="수집 키" value={info.ingestKey} onCopy={copy} />
            {!info.isActive && (
              <p className="text-danger">이 앱은 비활성 상태라 이벤트를 받지 않습니다.</p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Row({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-gray-500">{label}</span>
      <code className="flex-1 break-all rounded bg-gray-100 px-2 py-1 dark:bg-gray-800">
        {value}
      </code>
      <Button size="sm" variant="light" onClick={() => onCopy(value)}>
        복사
      </Button>
    </div>
  );
}
