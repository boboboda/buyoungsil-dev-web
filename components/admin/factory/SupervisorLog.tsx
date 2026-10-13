// components/admin/factory/SupervisorLog.tsx
// [감독] 탭의 감독 로그: 업데이트 소식·재시작/일시 정지/재개·장비 보고 성공/실패·오류를 시간순(최신이 위)으로. 5초마다 갱신.
// 재료는 서버가 이미 가진 것(업데이트 이력 + 감독 로그 줄)이고, 새 주소 없이 /api/admin/factory/control?log=1 을 읽는다.
"use client";

import { useEffect, useState } from "react";
import { Card, CardBody } from "@heroui/react";

interface Line {
  at: string;
  kind: string;
  text: string;
  ok?: boolean;
}

const KIND_LABEL: Record<string, string> = {
  update: "업데이트",
  restart: "재시작",
  pause: "일감 받기",
  device: "장비 보고",
  error: "오류",
  setting: "설정",
};

export default function SupervisorLog() {
  const [lines, setLines] = useState<Line[] | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/admin/factory/control?log=1", { cache: "no-store" });
        const d = (await res.json().catch(() => ({}))) as { log?: Line[] };

        if (res.ok && d.log) setLines(d.log);
      } catch {
        /* 그대로 둔다 */
      }
    };

    load();
    const t = setInterval(load, 5000);

    return () => clearInterval(t);
  }, []);

  return (
    <Card data-title="supervisor-log · 감독 로그">
      <CardBody className="space-y-2">
        <div className="font-semibold">감독 로그</div>
        <p className="text-xs text-default-500">
          업데이트 소식, 재시작·일시 정지·재개, 장비 보고 성공/실패, 오류를 시간순으로 보여 줘요. (최근 100줄, 5초마다 갱신)
        </p>
        {!lines && <p className="text-sm text-default-500">읽는 중…</p>}
        {lines && lines.length === 0 && <p className="text-sm text-default-500">아직 기록이 없어요.</p>}
        {lines && lines.length > 0 && (
          <ul className="max-h-[32rem] space-y-1 overflow-y-auto rounded-lg border border-default-200 p-2 text-xs" data-supervisor-log>
            {lines.map((l, i) => (
              <li key={`${l.at}-${i}`} className={`break-words font-mono ${l.ok === false ? "text-danger" : ""}`} data-log-kind={l.kind}>
                <span className="text-default-500">{new Date(l.at).toLocaleString("ko-KR")}</span>{" "}
                <span className="font-semibold">[{KIND_LABEL[l.kind] ?? l.kind}]</span> {l.text}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
