// components/admin/factory/ReleasePanel.tsx
// 통제실 "출시 패키지": 앱별 배포 계정·출시 상태·패키지 이름, 출시 준비 일감 보내기, 만들어진 패키지(스토어 문구·데이터 보안·
// 콘텐츠 등급·체크리스트·방침 초안)와 AAB 정보(파일은 PC 에만), 비공개 테스트 일정.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader, Chip } from "@heroui/react";

import { fmtDate, fmtSize, postRelease, type ReleaseApp, type ReleaseOverview } from "./releaseTypes";

const input = "w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm";
const LIMITS: Record<string, number> = { title: 30, shortDescription: 80, fullDescription: 4000 };

function Listing({ lang, v }: { lang: string; v: Record<string, unknown> }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-default-500">{lang === "ko" ? "한국어" : lang === "en" ? "영어" : lang}</div>
      {Object.entries(v).map(([k, val]) => {
        const s = typeof val === "string" ? val : JSON.stringify(val);
        const over = LIMITS[k] && s.length > LIMITS[k];

        return (
          <div key={k} className="text-sm">
            <span className="text-default-500">
              {k} ({s.length}
              {LIMITS[k] ? `/${LIMITS[k]}` : ""}자{over ? " ⚠️ 초과" : ""}):{" "}
            </span>
            <span className="whitespace-pre-wrap">{s}</span>
          </div>
        );
      })}
    </div>
  );
}

function PackageView({ pkg }: { pkg: Record<string, unknown> }) {
  const listing = (pkg.storeListing ?? {}) as Record<string, Record<string, unknown>>;
  const checklist = Array.isArray(pkg.checklist) ? (pkg.checklist as { item?: string; done?: boolean; note?: string }[]) : [];
  const block = (title: string, v: unknown) =>
    v === undefined || v === null ? null : (
      <details className="rounded-lg border border-default-200 p-2">
        <summary className="cursor-pointer text-sm font-medium">{title}</summary>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs">{typeof v === "string" ? v : JSON.stringify(v, null, 2)}</pre>
      </details>
    );

  return (
    <div className="space-y-2">
      {Object.keys(listing).length > 0 && (
        <details className="rounded-lg border border-default-200 p-2" open>
          <summary className="cursor-pointer text-sm font-medium">스토어 문구</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {Object.entries(listing).map(([lang, v]) => (
              <Listing key={lang} lang={lang} v={v ?? {}} />
            ))}
          </div>
        </details>
      )}
      {checklist.length > 0 && (
        <details className="rounded-lg border border-default-200 p-2" open>
          <summary className="cursor-pointer text-sm font-medium">체크리스트 ({checklist.filter((c) => c.done).length}/{checklist.length})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {checklist.map((c, i) => (
              <li key={i}>
                {c.done ? "✅" : "⬜"} {c.item}
                {c.note ? <span className="text-default-500"> — {c.note}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
      {block("데이터 보안 답안", pkg.dataSafety)}
      {block("콘텐츠 등급 답안", pkg.contentRating)}
      {block("개인정보처리방침 초안", pkg.privacyPolicyDraft)}
      {Array.isArray(pkg.sdks) && pkg.sdks.length > 0 && <p className="text-sm">찾은 SDK: {(pkg.sdks as string[]).join(", ")}</p>}
      {typeof pkg.notes === "string" && pkg.notes && <p className="whitespace-pre-wrap text-sm text-default-600">메모: {pkg.notes}</p>}
    </div>
  );
}

function AppRow({ app, data, onSaved }: { app: ReleaseApp; data: ReleaseOverview; onSaved: (d: Partial<ReleaseOverview>) => void }) {
  const [acc, setAcc] = useState(app.releaseAccountId ?? "");
  const [status, setStatus] = useState(app.releaseStatus);
  const [pkgName, setPkgName] = useState(app.packageName ?? "");
  const [first, setFirst] = useState(app.firstUploadDone);
  const [runNow, setRunNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const label = data.statuses.find((s) => s.value === app.releaseStatus)?.label ?? app.releaseStatus;
  const account = data.accounts.find((a) => a.id === app.releaseAccountId);
  const dDay = app.testingDueAt ? Math.ceil((new Date(app.testingDueAt).getTime() - Date.now()) / 86400000) : null;

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNotice(null);
    const { ok, data: d } = await postRelease(body);

    if (ok) onSaved(d);
    setNotice(d.message ?? (ok ? "처리했어요." : "처리하지 못했어요."));
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{app.title}</div>
          <div className="text-xs text-default-500">
            {app.appSlug} · {app.stack}
            {account ? ` · 계정 ${account.label}(${account.name})` : " · 계정 미정"}
          </div>
        </div>
        <Chip color={app.releaseStatus === "released" ? "success" : app.releaseStatus === "testing" ? "warning" : "default"} size="sm" variant="flat">
          {label}
        </Chip>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select className={input} value={acc} onChange={(e) => setAcc(e.target.value)}>
            <option value="">배포 계정 고르기…</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                계정 {a.label} · {a.name}
              </option>
            ))}
          </select>
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
            {data.statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <input className={input} placeholder="패키지 이름 (com.factory.my_app)" value={pkgName} onChange={(e) => setPkgName(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input checked={first} type="checkbox" onChange={(e) => setFirst(e.target.checked)} />
          최초 AAB 를 Play Console 에 직접 올렸어요(이후 출시 준비 일감이 비공개 테스트 트랙에 자동 업로드)
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            className="min-h-11 sm:min-h-0"
            isDisabled={busy}
            size="sm"
            variant="flat"
            onPress={() => call({ action: "updateApp", appSlug: app.appSlug, releaseAccountId: acc || null, releaseStatus: status, packageName: pkgName, firstUploadDone: first })}
          >
            저장
          </Button>
          <Button
            className="min-h-11 sm:min-h-0"
            color="primary"
            isDisabled={busy || !app.releaseAccountId || !app.done || app.active}
            size="sm"
            onPress={() => call({ action: "enqueueRelease", appSlug: app.appSlug, runNow })}
          >
            📦 출시 준비 일감 보내기
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input checked={runNow} type="checkbox" onChange={(e) => setRunNow(e.target.checked)} />
            바로 승인
          </label>
          {!app.releaseAccountId && <span className="text-xs text-default-500">계정을 골라 저장하면 보낼 수 있어요</span>}
          {app.active && <span className="text-xs text-default-500">이 앱에 진행 중인 일감이 있어요</span>}
        </div>
        {notice && <p className="text-sm text-default-600">{notice}</p>}

        {app.testingStartedAt && (
          <p className="text-sm">
            🧪 비공개 테스트 {fmtDate(app.testingStartedAt)} 시작 → {fmtDate(app.testingDueAt)} 완료 예정
            {dDay !== null ? (dDay > 0 ? ` (D-${dDay})` : " (기간 지남: 프로덕션 신청 가능)") : ""}
          </p>
        )}
        {app.aab && (
          <p className="text-sm">
            📱 AAB (PC 에만 보관): <code className="break-all text-xs">{app.aab.path}</code> · {fmtSize(app.aab.size)} · 버전{" "}
            {app.aab.versionName ?? "?"} ({app.aab.versionCode ?? "?"}) · 빌드 {app.aab.builtAt ? new Date(app.aab.builtAt).toLocaleString("ko-KR") : "-"}
          </p>
        )}
        {app.lastReleaseJob && (
          <p className="text-xs text-default-500">
            최근 출시 준비 일감: {app.lastReleaseJob.status}
            {app.lastReleaseJob.finishedAt ? ` · ${new Date(app.lastReleaseJob.finishedAt).toLocaleString("ko-KR")}` : ""}
          </p>
        )}
        {app.releasePackage ? (
          <div className="space-y-1">
            <div className="text-xs text-default-500">패키지 생성: {app.releasePackageAt ? new Date(app.releasePackageAt).toLocaleString("ko-KR") : "-"}</div>
            <PackageView pkg={app.releasePackage} />
          </div>
        ) : (
          <p className="text-sm text-default-500">아직 출시 패키지가 없어요. 출시 준비 일감을 보내면 만들어져요.</p>
        )}
      </CardBody>
    </Card>
  );
}

export default function ReleasePanel() {
  const [data, setData] = useState<ReleaseOverview | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/release", { cache: "no-store" });

      if (res.ok) setData((await res.json()) as ReleaseOverview);
    } catch {
      /* 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <p className="text-sm text-default-500">읽는 중…</p>;

  const apps = data.apps.filter((a) => a.done);

  return (
    <div className="space-y-4">
      {data.accounts.length === 0 && (
        <Card>
          <CardBody className="text-sm">
            먼저 <a className="underline" href="/admin/factory/settings">설정</a>에서 배포 계정 A/B 를 만들어 주세요.
          </CardBody>
        </Card>
      )}
      {apps.length === 0 ? (
        <p className="text-sm text-default-500">완성된 앱이 없어요.</p>
      ) : (
        apps.map((a) => (
          <AppRow
            key={a.appSlug}
            app={a}
            data={data}
            onSaved={(d) => {
              if (d.apps && d.accounts) setData(d as ReleaseOverview);
              else load();
            }}
          />
        ))
      )}
    </div>
  );
}
