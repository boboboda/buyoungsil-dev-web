// components/studio/ServiceStatus.tsx
// 서비스 연결 상태 표시(스튜디오 [구성] 대시보드 · [운영] 서비스 운영 · 통제실 스튜디오 탭이 같이 쓴다).
// 도메인 응답·응답 시간 · HTTPS 인증서 만료일(14일 이하 경고, 만료는 빨강) · 키 등록 여부 · health API 결과 · 마지막 확인 시각.
// [지금 확인]은 /api/studio/service 로 새로 확인한다(관리자만). 서버는 10분 캐시를 쓰고, 키 값은 이 화면에 오지 않는다(이름과 등록 여부만).
"use client";

import { useState } from "react";

import type { ServiceHealth } from "@/lib/studio/serviceHealth";

const CERT_CLASS = { ok: "fx-st fx-st-ok", warn: "fx-st fx-st-warn", expired: "fx-st fx-st-fail", unknown: "fx-st fx-st-info" } as const;
const DOMAIN_CLASS = { ok: "fx-st fx-st-ok", slow: "fx-st fx-st-warn", error: "fx-st fx-st-fail", down: "fx-st fx-st-fail", blocked: "fx-st fx-st-warn", "no-base": "fx-st fx-st-warn" } as const;
const API_CLASS = { ok: "fx-st fx-st-ok", "no-api": "fx-st fx-st-warn", "need-key": "fx-st fx-st-warn", blocked: "fx-st fx-st-warn", error: "fx-st fx-st-fail", skipped: "fx-st fx-st-info" } as const;

/** 한국 시간 "10-15 14:03" */
export const kstStamp = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);

  return Number.isNaN(d.getTime()) ? "-" : d.toISOString().slice(5, 16).replace("T", " ");
};

export function ServiceStatusRows({ health }: { health: ServiceHealth | null }) {
  if (!health) return <p className="text-sm fx-muted" data-service-health-empty>아직 확인하지 않았어요. [지금 확인]을 눌러 주세요.</p>;
  const apiInfo = Object.entries(health.api.info)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" · ");

  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]" data-service-health={health.appSlug}>
      <dt>도메인 응답</dt>
      <dd data-health-domain={health.domain.state}>
        <span className={DOMAIN_CLASS[health.domain.state]}>{health.domain.state === "ok" || health.domain.state === "slow" ? "응답함" : health.domain.state === "no-base" ? "주소 없음" : health.domain.state === "blocked" ? "확인 안 함" : "응답 없음"}</span>{" "}
        <span className="text-xs fx-muted">
          {health.base ? `${health.base} · ` : ""}
          {health.domain.text}
        </span>
      </dd>
      <dt>HTTPS 인증서</dt>
      <dd data-health-cert={health.cert.state}>
        <span className={CERT_CLASS[health.cert.state]}>{health.cert.state === "expired" ? "만료됨" : health.cert.state === "warn" ? `만료 임박 ${health.cert.daysLeft}일` : health.cert.state === "ok" ? `정상 · 남은 ${health.cert.daysLeft}일` : "확인 못 함"}</span>{" "}
        <span className="text-xs fx-muted">{health.cert.text}</span>
      </dd>
      <dt>키 등록</dt>
      <dd className="space-x-1" data-health-keys>
        {([health.keys.review, health.keys.admin] as const).map((k) => (
          <span key={k.name} className="inline-block" data-health-key={k.name}>
            <span className={k.ready ? "fx-st fx-st-ok" : "fx-st fx-st-warn"}>{k.ready ? "등록됨" : "키 등록 필요"}</span> <span className="font-mono text-xs fx-muted">{k.name}</span>
          </span>
        ))}
      </dd>
      <dt>서비스 API</dt>
      <dd data-health-api={health.api.state}>
        <span className={API_CLASS[health.api.state]}>{health.api.state === "ok" ? "정상" : health.api.state === "no-api" ? "서비스 API 없음" : health.api.state === "need-key" ? "키 필요" : health.api.state === "skipped" ? "건너뜀" : "오류"}</span>{" "}
        <span className="text-xs fx-muted">
          GET /api/admin/health — {health.api.text}
          {apiInfo ? ` · ${apiInfo}` : ""}
        </span>
      </dd>
      <dt>마지막 확인</dt>
      <dd className="text-xs fx-muted" data-health-at>
        {kstStamp(health.checkedAt)} (한국 시간) · 10분 안에는 저장된 결과를 써요
      </dd>
    </dl>
  );
}

/** 상태 + [지금 확인]. canCheck 가 아니면(접근 키 사용자) 단추 없이 보여 주기만 한다 */
export default function ServiceStatusCard({ appSlug, health, canCheck, title = "서비스 연결 상태", onChecked }: { appSlug: string; health: ServiceHealth | null; canCheck: boolean; title?: string; onChecked?: (h: ServiceHealth | null) => void }) {
  const [now, setNow] = useState<ServiceHealth | null>(health);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const check = async () => {
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch(`/api/studio/service?appSlug=${encodeURIComponent(appSlug)}&what=health&refresh=1`, { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { health?: ServiceHealth | null; message?: string };

      if (r.ok && d.health) {
        setNow(d.health);
        onChecked?.(d.health);
        setNotice("방금 확인했어요.");
      } else setNotice(d.message ?? "확인하지 못했어요.");
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="fx-panel min-w-0 space-y-2 p-3" data-service-status={appSlug}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold">{title}</h3>
        {canCheck ? (
          <button className="fx-btn fx-btn-sm" data-health-check disabled={busy} type="button" onClick={check}>
            {busy ? "확인 중…" : "지금 확인"}
          </button>
        ) : null}
        {notice ? (
          <span className="text-xs fx-muted" role="status">
            {notice}
          </span>
        ) : null}
      </div>
      <ServiceStatusRows health={now} />
    </section>
  );
}

/** 통제실 표 칸: 한 줄 요약(도메인·인증서·API) + [지금 확인] */
export function ServiceStatusCell({ appSlug, health }: { appSlug: string; health: ServiceHealth | null }) {
  const [now, setNow] = useState<ServiceHealth | null>(health);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/studio/service?appSlug=${encodeURIComponent(appSlug)}&what=health&refresh=1`, { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { health?: ServiceHealth | null };

      if (r.ok && d.health) setNow(d.health);
    } catch {
      /* 그대로 둔다 */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-0.5 text-xs" data-studio-service-cell={appSlug}>
      {now ? (
        <>
          <p className="space-x-1">
            <span className={DOMAIN_CLASS[now.domain.state]}>{now.domain.state === "ok" || now.domain.state === "slow" ? `응답 ${now.domain.ms ?? "-"}ms` : "응답 없음"}</span>
            <span className={CERT_CLASS[now.cert.state]}>{now.cert.daysLeft === null ? "인증서 ?" : now.cert.daysLeft < 0 ? "인증서 만료" : `인증서 ${now.cert.daysLeft}일`}</span>
          </p>
          <p className="space-x-1">
            <span className={API_CLASS[now.api.state]}>{now.api.state === "ok" ? "API 정상" : now.api.state === "no-api" ? "서비스 API 없음" : now.api.state === "need-key" ? "키 필요" : "API 확인 못 함"}</span>
            <span className={now.keys.admin.ready && now.keys.review.ready ? "fx-st fx-st-ok" : "fx-st fx-st-warn"}>{now.keys.admin.ready && now.keys.review.ready ? "키 모두 등록" : "키 등록 필요"}</span>
          </p>
          <p className="fx-muted">확인 {kstStamp(now.checkedAt)}</p>
        </>
      ) : (
        <p className="fx-muted">아직 확인 안 함</p>
      )}
      <button className="underline" data-health-check disabled={busy} type="button" onClick={check}>
        {busy ? "확인 중…" : "지금 확인"}
      </button>
    </div>
  );
}
