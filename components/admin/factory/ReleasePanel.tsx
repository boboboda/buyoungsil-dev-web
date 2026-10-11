// components/admin/factory/ReleasePanel.tsx
// 통제실 "출시 패키지": 앱별 배포 계정·출시 상태·패키지 이름, 출시 준비 일감 보내기, 만들어진 패키지(스토어 문구·데이터 보안·
// 콘텐츠 등급·체크리스트·방침 초안)와 AAB 정보(파일은 PC 에만), 비공개 테스트 일정.
// [승인]: 종류(첫 출시 / 스토어 자료 수정 / 프로젝트 업데이트)를 고르면 일감을 만들고 바로 승인한다.
// 출시 일감 진행 단계, 실패 단계·이유·최근 로그(서버가 비밀번호를 가림), 실패한 단계부터 [재시도].
// 2단계: 홍보 영상 링크(YouTube, 앱별), 스토어 자료·Play 업로드 결과, Play 업로드에 모자란 것,
// 스토어 자료 수정·프로젝트 업데이트 승인 때 '홈페이지 프로젝트도 덮어쓰기'(기본 꺼짐, 개인정보처리방침 제외).
// 스토어 자료 수정·프로젝트 업데이트는 승인 전에 갱신할 항목을 고른다(1개 이상. 고른 것만 만들고·올리고·반영).
// '이 앱이 쓸 키'는 키 보관함에서 고른다(기본: 계정 기본 키). 고른 키를 [조회]하면 작업 PC 가 그 파일을 직접 확인한다.
// 보조: '이 앱 폴더에서 키 파일 후보 찾기'(확장자 없는 JKS 도 찾음) → 보관함 [기존 키 등록]으로 넘긴다.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader, Chip } from "@heroui/react";

import Field from "./Field";
import AppKeyLookup from "./AppKeyLookup";
import { KeyCheckView, KeyError, UntrackView } from "./KeyVault";
import StoreAssetsView from "./StoreAssetsView";
import { KEY_PASSWORD_TEXT, fmtDate, fmtSize, postRelease, type ReleaseApp, type ReleaseJobInfo, type ReleaseOverview } from "./releaseTypes";

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

const REMOVE_CONFIRM = "출시 패키지 목록에서 지울까요? 앱 소스와 PC 의 파일은 지워지지 않아요";

const KIND_HELP: Record<string, string> = {
  first: "키 준비 → AAB 빌드·서명 → 스토어 문구·체크리스트 → 홈페이지 프로젝트 빈 칸 채우기",
  store:
    "고른 항목만: 이미지(아이콘·대표 이미지·스크린샷) / 문구 / 홍보 영상 / 개인정보처리방침 → (조건이 맞으면) Play 등록정보·이미지 업로드 → 홈페이지 반영",
  project: "홈페이지 프로젝트 정보 중 고른 항목만 갱신해요. AAB·Play 업로드는 하지 않아요",
};

const JOB_STATUS: Record<string, string> = {
  pending: "승인 대기",
  approved: "대기열(작업 PC 가 곧 시작)",
  running: "진행 중",
  done: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

/** 마지막 출시 일감: 진행 중 단계, 실패 단계·이유·최근 로그, 재시도 */
function JobStatus({ job, kinds, busy, onRetry }: { job: ReleaseJobInfo; kinds: { value: string; label: string }[]; busy: boolean; onRetry: () => void }) {
  const kind = kinds.find((k) => k.value === job.releaseKind)?.label ?? job.releaseKind;
  const failed = job.status === "failed";

  return (
    <div className={`space-y-1 rounded-lg border p-2 text-sm ${failed ? "border-danger-200 bg-danger-50 dark:bg-danger-50/10" : "border-default-200"}`}>
      <div>
        최근 출시 일감({kind}
        {job.updateItemsText ? ` · 갱신: ${job.updateItemsText}` : ""}
        {job.overwriteProject ? " · 홈페이지 덮어쓰기" : ""}): <b>{JOB_STATUS[job.status] ?? job.status}</b>
        {job.status === "running" && job.phase ? ` · 현재 단계: ${job.phaseLabel}` : ""}
        {job.finishedAt ? ` · ${new Date(job.finishedAt).toLocaleString("ko-KR")}` : ""}
      </div>
      {failed && (
        <>
          <div>
            ❌ 실패한 단계: <b>{job.failStageLabel ?? "알 수 없음"}</b>
          </div>
          {job.failReason && <div className="whitespace-pre-wrap break-words text-default-700">이유: {job.failReason}</div>}
          <Button className="min-h-11 sm:min-h-0" color="warning" isDisabled={busy} size="sm" variant="flat" onPress={onRetry}>
            🔁 재시도 ({job.failStageLabel ?? "처음"}부터)
          </Button>
        </>
      )}
      {job.logs.length > 0 && (
        <details open={failed}>
          <summary className="cursor-pointer text-xs text-default-500">마지막 로그 {job.logs.length}줄 (비밀번호·키 값은 가려져요)</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
            {job.logs.map((l) => `${l.level === "info" ? "" : `[${l.level}] `}${l.message}`).join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}

function AppRow({
  app,
  data,
  selected,
  onSelect,
  onSaved,
}: {
  app: ReleaseApp;
  data: ReleaseOverview;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onSaved: (d: Partial<ReleaseOverview>) => void;
}) {
  const [acc, setAcc] = useState(app.releaseAccountId ?? "");
  const [status, setStatus] = useState(app.releaseStatus);
  const [pkgName, setPkgName] = useState(app.packageName ?? "");
  const [first, setFirst] = useState(app.firstUploadDone);
  // 이 앱이 쓸 키(보관함 항목 id). 빈 값이면 배포 계정 기본 키
  const [keyId, setKeyId] = useState(app.keyId ?? "");
  // 패키지가 이미 있으면 보통 고치는 일이라 스토어 자료 수정을 먼저 보여 준다
  const [kind, setKind] = useState(app.releasePackage ? "store" : "first");
  const [overwrite, setOverwrite] = useState(false);
  // 갱신 항목(스토어 자료 수정·프로젝트 업데이트). 종류를 바꾸면 비운다
  const [items, setItems] = useState<string[]>([]);
  const kindItems = data.kinds.find((k) => k.value === kind)?.items ?? [];
  const needItems = kindItems.length > 0 && items.length === 0;
  const [video, setVideo] = useState(app.promoVideoUrl ?? "");
  const canOverwrite = data.kinds.find((k) => k.value === kind)?.canOverwrite ?? false;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const label = data.statuses.find((s) => s.value === app.releaseStatus)?.label ?? app.releaseStatus;
  const account = data.accounts.find((a) => a.id === app.releaseAccountId);
  const accDefault = data.keys.find((k) => k.id === data.accounts.find((a) => a.id === acc)?.defaultKeyId) ?? null;
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
        <div className="flex min-w-0 items-center gap-2">
          <input
            aria-label={`${app.appSlug} 선택`}
            checked={selected}
            disabled={app.active}
            type="checkbox"
            onChange={(e) => onSelect(e.target.checked)}
          />
          <div className="min-w-0">
            <div className="truncate font-semibold">{app.title}</div>
            <div className="text-xs text-default-500">
              {app.appSlug} · {app.stack}
              {account ? ` · 계정 ${account.label}(${account.name})` : " · 계정 미정"}
            </div>
          </div>
        </div>
        <Chip color={app.releaseStatus === "released" ? "success" : app.releaseStatus === "testing" ? "warning" : "default"} size="sm" variant="flat">
          {label}
        </Chip>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field help="설정 → 배포 계정에서 만든 계정 중 하나." label="배포 계정">
            <select className={input} value={acc} onChange={(e) => setAcc(e.target.value)}>
              <option value="">고르기…</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  계정 {a.label} · {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field help="지금 출시가 어디까지 왔는지." label="출시 상태">
            <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
              {data.statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field help="Play 에 올라가는 앱 고유 이름. 한 번 올리면 못 바꿔요." label="패키지 이름">
            <input className={input} placeholder="예: com.factory.my_app" value={pkgName} onChange={(e) => setPkgName(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input checked={first} type="checkbox" onChange={(e) => setFirst(e.target.checked)} />
          최초 AAB 를 Play Console 에 직접 올렸어요(이후 첫 출시 일감이 비공개 테스트 트랙에 자동 업로드)
        </label>
        <div className="space-y-2 rounded-lg border border-default-200 p-2 text-sm">
          <Field
            help="키 보관함(설정)에서 만들거나 등록한 키 중에서 골라요. 바꾼 뒤 [저장]. 앱 폴더에 key.properties 가 이미 있으면 그 키를 그대로 써요(건드리지 않음)."
            label="🔑 이 앱이 쓸 키"
          >
            <select className={input} value={keyId} onChange={(e) => setKeyId(e.target.value)}>
              <option value="">계정 기본 키{accDefault ? ` (${accDefault.name})` : acc ? " (계정에 기본 키 없음)" : ""}</option>
              {data.keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name} · {k.kindLabel}
                  {k.production ? " · 운영 키" : ""} ({k.keystorePath})
                </option>
              ))}
            </select>
          </Field>
          {app.key ? (
            <div className="space-y-1">
              <div className="text-xs">
                지금 쓰는 키: <b>{app.key.name ?? app.key.path}</b> ({app.key.source === "custom" ? "이 앱에 고른 키" : "계정 기본 키"}
                {app.key.production ? " · 🛡 운영 키" : ""}) · <code className="break-all">{app.key.path}</code> · 별칭 {app.key.alias} · 비밀번호{" "}
                {KEY_PASSWORD_TEXT[app.key.password]}
              </div>
              <KeyError text={app.key.lastError} />
              <KeyCheckView alias={app.key.alias} check={app.key.check} />
              {app.key.keyId && (
                <UntrackView
                  busy={busy}
                  check={app.key.check}
                  keyPath={app.key.path}
                  untrack={app.key.untrack}
                  untracking={app.key.untracking}
                  onUntrack={() => {
                    if (
                      app.key?.keyId &&
                      window.confirm(
                        "이 키 파일을 앱 폴더 git 추적에서 뺄까요?\n\n먼저 기록을 조사하고, git rm --cached(파일은 그대로) → .gitignore 보강 → 로컬 커밋 1개를 만들어요. push·기록 삭제·파일 이동은 하지 않아요.",
                      )
                    )
                      call({ action: "vaultUntrack", keyId: app.key.keyId });
                  }}
                />
              )}
              {app.key.keyId && (
                <Button
                  className="min-h-11 sm:min-h-0"
                  isDisabled={busy || !!app.key.checking}
                  size="sm"
                  variant="flat"
                  onPress={() => app.key?.keyId && call({ action: "vaultCheck", keyId: app.key.keyId })}
                >
                  {app.key.checking ? "조회 중…" : "🔍 조회"}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-warning-600">
              쓸 키가 없어요. 설정 → 키 보관함에서 만들거나 등록한 뒤, 계정 기본 키로 고르거나 여기서 고르세요(첫 출시는 키 파일이 없으면 만들지 않고 멈춰요).
            </p>
          )}
          <AppKeyLookup
            appSlug={app.appSlug}
            busy={busy}
            request={app.keyScanRequest}
            scan={app.keyScan}
            onLookup={() => call({ action: "requestKeyScan", appSlug: app.appSlug })}
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            className="min-h-11 sm:min-h-0"
            isDisabled={busy}
            size="sm"
            variant="flat"
            onPress={() =>
              call({
                action: "updateApp",
                appSlug: app.appSlug,
                releaseAccountId: acc || null,
                releaseStatus: status,
                packageName: pkgName,
                firstUploadDone: first,
                keyId,
              })
            }
          >
            저장
          </Button>
          <select
            aria-label="출시 일감 종류"
            className={`${input} sm:w-48`}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setItems([]);
            }}
          >
            {data.kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <Button
            className="min-h-11 sm:min-h-0"
            color="primary"
            isDisabled={busy || !app.releaseAccountId || !app.done || app.active || needItems}
            size="sm"
            onPress={() => {
              const label = data.kinds.find((k) => k.value === kind)?.label ?? kind;
              const picked = kindItems.filter((i) => items.includes(i.value));
              const skipped = kindItems.filter((i) => !items.includes(i.value));
              const itemText = picked.length
                ? `\n\n갱신할 항목(이것만 해요): ${picked.map((i) => i.label).join(", ")}${skipped.length ? `\n건드리지 않음: ${skipped.map((i) => i.label).join(", ")}` : ""}`
                : "";

              const ow = canOverwrite && overwrite;
              const owText = canOverwrite
                ? ow
                  ? "\n\n⚠️ 고른 항목의 홈페이지 프로젝트 기존 값(설명·대표 이미지·앱 링크·기술 스택)을 덮어써요."
                  : "\n\n홈페이지 프로젝트는 고른 항목 중 빈 칸만 채워요."
                : "";

              if (window.confirm(`${app.title}: '${label}' 일감을 만들고 바로 승인할까요?\n\n${KIND_HELP[kind] ?? ""}${itemText}${owText}`)) {
                call({
                  action: "enqueueRelease",
                  appSlug: app.appSlug,
                  kind,
                  runNow: true,
                  overwriteProject: ow,
                  ...(kindItems.length ? { updateItems: picked.map((i) => i.value) } : {}),
                });
              }
            }}
          >
            ✅ 승인
          </Button>
          <Button
            className="min-h-11 sm:min-h-0"
            color="danger"
            isDisabled={busy || app.active}
            size="sm"
            variant="light"
            onPress={() => {
              if (window.confirm(`이 앱을 ${REMOVE_CONFIRM}`)) call({ action: "removeApps", appSlugs: [app.appSlug] });
            }}
          >
            삭제
          </Button>
          {!app.releaseAccountId && <span className="text-xs text-default-500">계정을 골라 저장하면 승인할 수 있어요</span>}
          {app.releaseAccountId && needItems && <span className="text-xs text-warning-600">갱신할 항목을 하나 이상 고르면 승인할 수 있어요</span>}
          {app.active && <span className="text-xs text-default-500">진행 중 일감이 있어요(삭제할 수 없어요)</span>}
        </div>
        {kindItems.length > 0 && (
          <fieldset className="space-y-1 rounded-lg border border-default-200 p-2">
            <legend className="px-1 text-sm font-medium">갱신할 항목 (1개 이상, 고른 것만 해요)</legend>
            {kindItems.map((it) => (
              <label key={it.value} className="flex items-start gap-2 text-sm">
                <input
                  checked={items.includes(it.value)}
                  className="mt-1"
                  type="checkbox"
                  onChange={(e) => setItems((s) => (e.target.checked ? [...s, it.value] : s.filter((x) => x !== it.value)))}
                />
                <span>
                  {it.label}
                  <span className="block text-xs text-default-500">{it.help}</span>
                  {it.value === "privacy" && (
                    <span className="block text-xs text-default-500">
                      Play 의 개인정보처리방침 주소(/project/&lt;이름&gt;/privacy)는 고정이라, 홈페이지 내용만 바꾸면 Play 가 보여 주는 내용도 바뀌어요.
                    </span>
                  )}
                  {it.value === "video" && !app.promoVideoUrl && (
                    <span className="block text-xs text-warning-600">아직 저장된 영상 링크가 없어요. 아래에 링크를 저장해야 Play 영상이 바뀌어요.</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {canOverwrite && (
          <label className="flex items-center gap-2 text-sm">
            <input checked={overwrite} type="checkbox" onChange={(e) => setOverwrite(e.target.checked)} />
            홈페이지 프로젝트도 덮어쓰기 (고른 항목의 설명·대표 이미지·앱 링크·기술 스택. 끄면 빈 칸만 채움. 개인정보처리방침은 위 항목으로 따로)
          </label>
        )}
        <p className="text-xs text-default-500">{KIND_HELP[kind]}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field className="sm:flex-1" label="홍보 영상 링크 (YouTube)">
            <input className={input} placeholder="예: https://youtu.be/…" value={video} onChange={(e) => setVideo(e.target.value)} />
          </Field>
          <Button
            className="min-h-11 sm:min-h-0"
            isDisabled={busy || video.trim() === (app.promoVideoUrl ?? "")}
            size="sm"
            variant="flat"
            onPress={() => call({ action: "savePromoVideo", appSlug: app.appSlug, url: video })}
          >
            링크 저장
          </Button>
        </div>
        <p className="text-xs text-default-500">
          영상은 YouTube 에 직접 올리고 링크만 넣어요(공개 또는 일부 공개, 퍼가기 허용, 광고 끔). 다음 &apos;스토어 자료 수정&apos; 업로드 때 Play 등록정보 영상에
          들어가요.
        </p>
        {app.playMissing.length > 0 ? (
          <p className="text-xs text-warning-600">Play 업로드 안 됨(스토어 자료·업데이트 AAB) — 부족한 것: {app.playMissing.join(" / ")}</p>
        ) : (
          <p className="text-xs text-success-600">Play 업로드 조건 충족: 스토어 자료 수정은 등록정보·이미지를, 첫 출시는 업데이트 AAB 를 비공개 테스트 트랙에 올려요.</p>
        )}
        {account?.playConsoleUrl && (
          <a className="text-sm text-primary underline" href={account.playConsoleUrl} rel="noopener noreferrer" target="_blank">
            ▶ Play Console (계정 {account.label}) 열기
          </a>
        )}
        {notice && <p className="text-sm text-default-600">{notice}</p>}
        {app.lastReleaseJob && (
          <JobStatus
            busy={busy}
            job={app.lastReleaseJob}
            kinds={data.kinds}
            onRetry={() => app.lastReleaseJob && call({ action: "retryRelease", jobId: app.lastReleaseJob.id })}
          />
        )}

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
        {app.storeAssets && <StoreAssetsView assets={app.storeAssets} />}
        {app.releasePackage ? (
          <div className="space-y-1">
            <div className="text-xs text-default-500">패키지 생성: {app.releasePackageAt ? new Date(app.releasePackageAt).toLocaleString("ko-KR") : "-"}</div>
            <PackageView pkg={app.releasePackage} />
          </div>
        ) : (
          <p className="text-sm text-default-500">아직 출시 패키지가 없어요. &apos;첫 출시&apos;를 승인하면 만들어져요.</p>
        )}
      </CardBody>
    </Card>
  );
}

export default function ReleasePanel() {
  const [data, setData] = useState<ReleaseOverview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  // 진행 중이거나 대기 중인 출시 일감이 있으면 15초마다 단계를 새로 읽는다
  // [키 조회] 결과를 기다리는 앱이 있어도 새로 읽는다
  const live = !!data?.apps.some(
    (a) => (a.lastReleaseJob && ["pending", "approved", "running"].includes(a.lastReleaseJob.status)) || a.keyScanRequest || a.key?.checking || a.key?.untracking,
  );

  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 15_000);

    return () => clearInterval(t);
  }, [live, load]);

  if (!data) return <p className="text-sm text-default-500">읽는 중…</p>;

  const apps = data.apps.filter((a) => a.done);
  const picked = apps.filter((a) => selected.includes(a.appSlug) && !a.active).map((a) => a.appSlug);
  const onSaved = (d: Partial<ReleaseOverview>) => {
    if (d.apps && d.accounts) {
      setData(d as ReleaseOverview);
      setSelected((s) => s.filter((x) => d.apps?.some((a) => a.appSlug === x)));
    } else load();
    // 지운 앱의 행은 사라지니, 그 결과는 목록 위에 보여 준다
    if (d.apps && apps.some((a) => !d.apps?.some((x) => x.appSlug === a.appSlug))) setNotice(d.message ?? null);
  };
  const removePicked = async () => {
    if (!picked.length || !window.confirm(`${picked.length}개 앱을 ${REMOVE_CONFIRM}\n\n${picked.join(", ")}`)) return;
    setBusy(true);
    const { data: d } = await postRelease({ action: "removeApps", appSlugs: picked });

    onSaved(d);
    setNotice(d.message ?? "처리하지 못했어요.");
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      {apps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button color="danger" isDisabled={busy || picked.length === 0} size="sm" variant="flat" onPress={removePicked}>
            선택 삭제{picked.length ? ` (${picked.length})` : ""}
          </Button>
          <span className="text-xs text-default-500">출시 패키지 목록에서만 빠져요. 앱 소스·지시 기록·PC 의 AAB·키 파일은 그대로예요.</span>
          {notice && <span className="text-sm text-default-600">{notice}</span>}
        </div>
      )}
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
            selected={selected.includes(a.appSlug)}
            onSaved={onSaved}
            onSelect={(v) => setSelected((s) => (v ? [...s, a.appSlug] : s.filter((x) => x !== a.appSlug)))}
          />
        ))
      )}
    </div>
  );
}
