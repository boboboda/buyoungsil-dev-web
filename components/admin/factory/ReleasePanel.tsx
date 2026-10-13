// components/admin/factory/ReleasePanel.tsx
// 통제실 "출시 패키지": 앱별 배포 계정·출시 상태·패키지 이름, 출시 준비 일감 보내기, 만들어진 패키지(스토어 문구·데이터 보안·
// 콘텐츠 등급·체크리스트·방침 초안)와 AAB 정보(파일은 PC 에만), 비공개 테스트 일정.
// [승인]: 종류(첫 출시 / 스토어 수정 / 앱 업데이트(기능 추가))를 고르면 일감을 만들고 바로 승인한다. 종류마다 필요한 입력칸만 보인다.
// 첫 출시·스토어 수정은 자료를 만든 뒤 '검토 대기'(노란색): 이미지·문구·영상·방침 초안을 보고 [이대로 진행]/[다시 만들기]/[취소].
// 앱 업데이트는 검토 없이 빌드 결과(버전·AAB·시험·업로드 트랙)를 보여 준다. 예전 '프로젝트 업데이트' 일감은 '(예전)'으로 읽힌다.
// 카드 제목은 앱 이름(직접 정한 이름 → 스토어 문구 앱 이름 → 홈페이지 프로젝트 제목 → 작업 이름). 종류를 고르면 그 종류에 필요한 칸·준비 목록만 보인다.
// 출시 일감 진행 단계, 실패 단계·이유·최근 로그(서버가 비밀번호를 가림), 실패한 단계부터 [재시도].
// 2단계: 홍보 영상 링크(YouTube, 앱별), 스토어 자료·Play 업로드 결과, Play 업로드에 모자란 것,
// 스토어 자료 수정·프로젝트 업데이트 승인 때 '홈페이지 프로젝트도 덮어쓰기'(기본 꺼짐, 개인정보처리방침 제외).
// 스토어 자료 수정·프로젝트 업데이트는 승인 전에 갱신할 항목을 고른다(1개 이상. 고른 것만 만들고·올리고·반영).
// '이 앱이 쓸 키'는 키 보관함에서 고른다(기본: 계정 기본 키). 고른 키를 [조회]하면 작업 PC 가 그 파일을 직접 확인한다.
// 보조: '이 앱 폴더에서 키 파일 후보 찾기'(확장자 없는 JKS 도 찾음) → 보관함 [기존 키 등록]으로 넘긴다.
// 홈페이지 프로젝트: 카드에서 연결 표시·바꾸기, [홈페이지만 반영](Play 없이 저장된 출시 자료로 덮어씀). 출시 패키지에 추가할 때 기존 프로젝트/새로 만들기/나중에 중 고른다.
// 검수 페이지: 앱별 주소(https)·[🔍 검수 페이지 열기]·'검수 대기 N장'(서버가 대신 확인). 1장 이상이면 카드 위와 목록 위 요약에 보인다.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader, Chip } from "@heroui/react";

import Field from "./Field";
import AiEngineSelect from "./AiEngineSelect";
import { AI_LABELS, type TaskAiEngine } from "@/lib/factory/ai";
import AppKeyLookup from "./AppKeyLookup";
import { KeyCheckView, KeyError, UntrackView } from "./KeyVault";
import StoreAssetsView from "./StoreAssetsView";
import TestApkBox from "./TestApkBox";
import ReviewBox, { ReviewBadge } from "./ReviewBox";
import UploadTestBox from "./UploadTestBox";
import { BuildResultView, FirstVideoPanel, LinkWaitPanel, ListingCopy, ReviewPanel, isYoutubeUrl } from "./ReleaseReview";
import {
  JOB_KIND_TEXT,
  JOB_STATUS_TEXT,
  KEY_PASSWORD_TEXT,
  fmtDate,
  fmtSize,
  postRelease,
  type OtherApp,
  type ProjectSyncResult,
  type ReadyItem,
  type ReleaseApp,
  type ReleaseJobInfo,
  type ReleaseOverview,
  type ReviewStatusRow,
} from "./releaseTypes";

const input = "w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm";

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
          <summary className="cursor-pointer text-sm font-medium">스토어 문구 (Console 에 넣을 때 [복사])</summary>
          <div className="mt-2">
            <ListingCopy listing={listing} />
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

// [출시 데이터 삭제]: 출시 데이터를 비우고 출시 대상에서도 뺀다 / [출시 대상에서 빼기]: 목록에서만 빠지고 출시 데이터는 남는다
const REMOVE_CONFIRM =
  "출시 데이터를 삭제할까요?\n\n지워지는 것: 배포 계정 선택·출시 상태·패키지 이름·최초 AAB 업로드 체크·비공개 테스트 일정·출시 패키지(스토어 문구·체크리스트)·AAB 정보. 출시 대상에서도 빠져요.\n남는 것: 앱 소스·지시 기록·홈페이지 프로젝트·PC 의 AAB·키 파일.";
const UNTARGET_CONFIRM =
  "출시 대상에서 뺄까요?\n\n출시 패키지 목록에서만 빠져요(아래 '출시 대상이 아닌 앱'으로 옮겨짐). 지워지는 것은 없어요.\n남는 것: 배포 계정·패키지 이름·출시 패키지·AAB 정보 등 출시 데이터 전부. 다시 추가하면 이어서 써요.";

const KIND_HELP: Record<string, string> = {
  first: "키 준비 → AAB 빌드·서명 → 스토어 문구·체크리스트·이미지·영상 → 검토 대기 → (이대로 진행) 홈페이지 빈 칸 채우기 + 최초 AAB 안내(Console 에 직접 올림)",
  store:
    "고른 항목만: 이미지(아이콘·대표 이미지·스크린샷) / 문구 / 홍보 영상 / 개인정보처리방침 → 검토 대기 → (이대로 진행) Play 등록정보·이미지 업로드 → 홈페이지 반영",
  update: "업데이트 내용대로 코드 수정·시험 → 버전 올림 → 서명 AAB → 비공개 테스트 트랙(alpha) 업로드 → (고르면) 홈페이지 반영. 프로덕션 승격은 Console 에서",
  project: "예전 종류: 홈페이지 프로젝트 정보 중 고른 항목만 갱신해요",
};

// 카드에 보일 출시 일감 상태
const STATE_CHIP: Record<string, { text: string; color: "default" | "primary" | "warning" | "success" | "danger" }> = {
  pending: { text: "승인 대기", color: "default" },
  generating: { text: "생성 중", color: "primary" },
  review: { text: "검토 대기", color: "warning" },
  linkwait: { text: "영상 링크 대기", color: "warning" },
  publishing: { text: "반영 중", color: "primary" },
  done: { text: "완료", color: "success" },
  failed: { text: "실패", color: "danger" },
  cancelled: { text: "취소됨", color: "default" },
};

// 지난 버전의 patch +1 (앱 업데이트 버전 이름 제안)
const nextPatch = (v: string | null | undefined) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v ?? "");

  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : null;
};

const JOB_STATUS: Record<string, string> = {
  pending: "승인 대기",
  approved: "대기열(작업 PC 가 곧 시작)",
  running: "진행 중",
  review: "검토 대기",
  linkwait: "영상 링크 대기",
  done: "완료",
  failed: "실패",
  cancelled: "취소됨",
};

/** 마지막 출시 일감: 상태(생성 중/검토 대기/반영 중/완료/실패), 진행 중 단계, 검토 화면, 실패 단계·이유·최근 로그, 재시도, 빌드 결과 */
function JobStatus({
  app,
  job,
  kinds,
  busy,
  onRetry,
  onDecision,
  onVideoLink,
  onVideoSkip,
  onSaveLink,
}: {
  app: ReleaseApp;
  job: ReleaseJobInfo;
  kinds: { value: string; label: string }[];
  busy: boolean;
  onRetry: () => void;
  onDecision: (decision: "approve" | "redo" | "cancel", note?: string) => void;
  onVideoLink: (url: string) => void;
  onVideoSkip: () => void;
  onSaveLink: (url: string) => void;
}) {
  const kind = kinds.find((k) => k.value === job.releaseKind)?.label ?? job.releaseKind;
  const failed = job.status === "failed";
  const chip = STATE_CHIP[job.state] ?? { text: JOB_STATUS[job.status] ?? job.status, color: "default" as const };

  return (
    <div className={`space-y-2 rounded-lg border p-2 text-sm ${failed ? "border-danger-200 bg-danger-50 dark:bg-danger-50/10" : "border-default-200"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span>
          최근 출시 일감({kind}
          {` · ${AI_LABELS[job.aiEngine ?? "claude"]}`}
          {job.updateItemsText ? ` · 갱신: ${job.updateItemsText}` : ""}
          {job.versionName ? ` · 버전 ${job.versionName}` : ""}
          {job.overwriteProject ? (job.releaseKind === "update" ? " · 홈페이지 반영" : " · 홈페이지 덮어쓰기") : ""})
        </span>
        <Chip color={chip.color} size="sm" variant={job.state === "review" || job.state === "linkwait" ? "solid" : "flat"}>
          {chip.text}
        </Chip>
        {job.status === "running" && job.phase ? <span>현재 단계: {job.phaseLabel}</span> : null}
        {job.finishedAt ? <span className="text-xs text-default-500">{new Date(job.finishedAt).toLocaleString("ko-KR")}</span> : null}
      </div>
      {job.redoNote && job.state === "generating" && <div className="text-xs">🔁 다시 만드는 중: {job.redoNote}</div>}
      {job.status === "review" && <ReviewPanel app={app} busy={busy} job={job} onDecision={onDecision} />}
      {job.status === "linkwait" && <LinkWaitPanel app={app} busy={busy} job={job} onApply={onVideoLink} onSkip={onVideoSkip} />}
      {job.status === "done" && job.releaseKind === "first" && job.reviewRequired && <FirstVideoPanel app={app} busy={busy} job={job} onSave={onSaveLink} />}
      {job.status === "done" && job.releaseKind === "update" && <BuildResultView job={job} />}
      {job.status === "done" && job.summary && job.releaseKind !== "update" && (
        <details>
          <summary className="cursor-pointer text-xs text-default-500">결과 요약</summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">{job.summary}</pre>
        </details>
      )}
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

/** 이 앱이 쓸 키(첫 출시·앱 업데이트에서만 필요): 보관함 선택, 지금 쓰는 키, 조회·커밋에서 빼기, 키 파일 후보 찾기 */
function KeyBox({
  app,
  data,
  acc,
  keyId,
  setKeyId,
  busy,
  call,
}: {
  app: ReleaseApp;
  data: ReleaseOverview;
  acc: string;
  keyId: string;
  setKeyId: (v: string) => void;
  busy: boolean;
  call: (body: Record<string, unknown>) => void;
}) {
  const accDefault = data.keys.find((k) => k.id === data.accounts.find((a) => a.id === acc)?.defaultKeyId) ?? null;

  return (
    <div className="space-y-2 rounded-lg border border-default-200 p-2 text-sm">
      <Field
        help="키 보관함(설정)에서 만들거나 등록한 키 중에서 골라요. 바꾼 뒤 위의 [저장]. 앱 폴더에 key.properties 가 이미 있으면 그 키를 그대로 써요(건드리지 않음)."
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
          쓸 키가 없어요. 설정 → 키 보관함에서 만들거나 등록한 뒤, 계정 기본 키로 고르거나 여기서 고르세요(키 파일이 없으면 만들지 않고 멈춰요).
        </p>
      )}
      {/* 후보 찾기는 키가 없거나 조회에서 파일이 없을 때만. 이미 찾은 결과·요청 중이면 계속 보여요 */}
      {(!app.key || app.key.check?.exists === false || app.keyScan || app.keyScanRequest) && (
        <AppKeyLookup
          appSlug={app.appSlug}
          busy={busy}
          request={app.keyScanRequest}
          scan={app.keyScan}
          onLookup={() => call({ action: "requestKeyScan", appSlug: app.appSlug })}
        />
      )}
    </div>
  );
}

/** AAB 를 만들지 않는 종류(스토어 수정·프로젝트 갱신): 키는 필요 없어서 한 줄 요약 + 접힌 자세히(지금 키·조회만) */
function StoreKeySummary({ app, busy, call }: { app: ReleaseApp; busy: boolean; call: (body: Record<string, unknown>) => void }) {
  return (
    <details className="rounded-lg border border-default-200 p-2 text-sm">
      <summary className="cursor-pointer text-default-500">
        🔑 키 필요 없음 (이 종류는 AAB 를 만들지 않아요) · 등록된 키: {app.key ? (app.key.name ?? app.key.path) : "없음"}
      </summary>
      <div className="mt-2 space-y-1">
        {app.key ? (
          <>
            <div className="text-xs">
              지금 쓰는 키: <b>{app.key.name ?? app.key.path}</b> ({app.key.source === "custom" ? "이 앱에 고른 키" : "계정 기본 키"}
              {app.key.production ? " · 🛡 운영 키" : ""}) · <code className="break-all">{app.key.path}</code> · 별칭 {app.key.alias}
            </div>
            <KeyCheckView alias={app.key.alias} check={app.key.check} />
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
          </>
        ) : (
          <p className="text-xs text-default-500">등록된 키가 없어요. 첫 출시·앱 업데이트를 할 때 고르면 돼요.</p>
        )}
      </div>
    </details>
  );
}

// 고를 수 있는 프로젝트: 연결 안 된 것 + 이 앱에 연결된 것(다른 앱에 연결된 건 뺀다)
const pickableProjects = (data: ReleaseOverview, appSlug: string) => (data.projects ?? []).filter((p) => !p.linkedApp || p.linkedApp === appSlug);

/** 홈페이지 프로젝트 연결 표시·바꾸기와 [홈페이지만 반영](Play 는 건드리지 않음) */
function ProjectBox({
  app,
  data,
  busy,
  call,
  setNotice,
}: {
  app: ReleaseApp;
  data: ReleaseOverview;
  busy: boolean;
  call: (body: Record<string, unknown>) => void;
  setNotice: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(app.projectId ?? "");
  const [checking, setChecking] = useState(false);
  const options = pickableProjects(data, app.appSlug);

  useEffect(() => setPick(app.projectId ?? ""), [app.projectId]);

  const syncHomepage = async () => {
    if (!app.projectId) {
      setNotice("먼저 프로젝트를 연결하세요. ([프로젝트 연결 바꾸기]에서 고를 수 있어요)");

      return;
    }
    setChecking(true);
    setNotice(null);
    const { ok, data: d } = await postRelease({ action: "projectSyncPreview", appSlug: app.appSlug });
    const p = d as Partial<ProjectSyncResult>;

    setChecking(false);
    if (!ok) {
      setNotice(p.message ?? "미리보기를 읽지 못했어요.");

      return;
    }
    const changes = [...(p.filled ?? []).map((k) => `· ${k} (빈 칸 채움): ${p.values?.[k] ?? ""}`), ...(p.overwritten ?? []).map((k) => `· ${k} (덮어씀): ${p.values?.[k] ?? ""}`)];
    const rest = [
      p.unchanged?.length ? `같아서 그대로: ${p.unchanged.join(", ")}` : "",
      p.skipped?.length ? `건너뜀(서버에 값 없음): ${p.skipped.join(", ")}` : "",
    ].filter(Boolean);

    if (changes.length === 0) {
      setNotice(`바꿀 항목이 없어요. ${rest.join(" / ")}`);

      return;
    }
    const text =
      `"${p.projectTitle ?? app.projectTitle}" 프로젝트를 저장된 출시 자료로 바꿀까요?\n\n${changes.join("\n")}` +
      `${rest.length ? `\n\n${rest.join("\n")}` : ""}\n\nPlay·개인정보처리방침·공개 여부(상태)는 바꾸지 않아요.`;

    if (window.confirm(text)) call({ action: "projectSync", appSlug: app.appSlug });
  };

  return (
    <div className="space-y-2 rounded-lg border border-default-200 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          🏠 홈페이지 프로젝트: {app.projectId ? <b>{app.projectTitle}</b> : <span className="text-warning-700">연결 안 됨</span>}
        </span>
        <Button className="min-h-11 sm:min-h-0" isDisabled={busy} size="sm" variant="light" onPress={() => setOpen((v) => !v)}>
          {open ? "닫기" : "프로젝트 연결 바꾸기"}
        </Button>
        <Button className="min-h-11 sm:min-h-0" isDisabled={busy || checking} size="sm" variant="flat" onPress={syncHomepage}>
          {checking ? "확인 중…" : "홈페이지만 반영"}
        </Button>
      </div>
      <p className="text-xs text-default-500">
        [홈페이지만 반영]은 Play 를 건드리지 않고, 서버에 저장된 출시 자료(앱 이름·스토어 설명·대표 이미지·Play 주소·기술 스택)로 연결된 프로젝트를 덮어써요. 개인정보처리방침과
        공개 여부는 그대로예요.
      </p>
      {open && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select aria-label="연결할 홈페이지 프로젝트" className={`${input} sm:flex-1`} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">프로젝트 고르기…</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.platform}, {p.status}){p.id === app.projectId ? " — 지금 연결됨" : ""}
              </option>
            ))}
          </select>
          <Button
            className="min-h-11 sm:min-h-0"
            color="primary"
            isDisabled={busy || !pick || pick === app.projectId}
            size="sm"
            onPress={() => call({ action: "linkProject", appSlug: app.appSlug, projectId: pick })}
          >
            연결
          </Button>
          {app.projectId && (
            <Button
              className="min-h-11 sm:min-h-0"
              isDisabled={busy}
              size="sm"
              variant="light"
              onPress={() => {
                if (window.confirm(`${app.displayName}: 홈페이지 프로젝트 연결을 풀까요?\n(프로젝트는 지워지지 않아요)`)) call({ action: "linkProject", appSlug: app.appSlug, projectId: null });
              }}
            >
              연결 풀기
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

const READY_MARK = (ok: boolean | null) => (ok === true ? "✅" : ok === false ? "⬜" : "⏳");

function AppRow({
  app,
  data,
  selected,
  onSelect,
  onSaved,
  review,
  reviewLoading,
}: {
  app: ReleaseApp;
  data: ReleaseOverview;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onSaved: (d: Partial<ReleaseOverview>) => void;
  review?: ReviewStatusRow;
  reviewLoading: boolean;
}) {
  const [appName, setAppName] = useState(app.appName ?? "");
  const [acc, setAcc] = useState(app.releaseAccountId ?? "");
  const [status, setStatus] = useState(app.releaseStatus);
  const [pkgName, setPkgName] = useState(app.packageName ?? "");
  const [first, setFirst] = useState(app.firstUploadDone);
  // 이 앱이 쓸 키(보관함 항목 id). 빈 값이면 배포 계정 기본 키
  const [keyId, setKeyId] = useState(app.keyId ?? "");
  // 이미 첫 업로드를 마친 앱은 보통 스토어 수정이라 그걸 먼저 보여 준다
  const [kind, setKind] = useState(app.alreadyReleased ? "store" : "first");
  const [aiEngine, setAiEngine] = useState<TaskAiEngine>("default");
  // 앱 업데이트(기능 추가) 입력
  const [updateText, setUpdateText] = useState("");
  const [versionName, setVersionName] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const suggestedVersion = nextPatch(app.aab?.versionName);
  const isFirst = kind === "first";
  const isStore = kind === "store";
  const isUpdate = kind === "update";
  const [overwrite, setOverwrite] = useState(false);
  // 갱신 항목(스토어 수정). 종류를 바꾸면 비운다
  const [items, setItems] = useState<string[]>([]);
  const kindDef = data.kinds.find((k) => k.value === kind);
  const kindItems = kindDef?.items ?? [];
  const [video, setVideo] = useState(app.promoVideoUrl ?? "");
  const canOverwrite = kindDef?.canOverwrite ?? false;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const label = data.statuses.find((s) => s.value === app.releaseStatus)?.label ?? app.releaseStatus;
  const account = data.accounts.find((a) => a.id === app.releaseAccountId);
  const dDay = app.testingDueAt ? Math.ceil((new Date(app.testingDueAt).getTime() - Date.now()) / 86400000) : null;
  // 저장하지 않은 공통 설정이 있으면 준비 목록은 예전 값 기준
  const dirty =
    acc !== (app.releaseAccountId ?? "") || pkgName !== (app.packageName ?? "") || first !== app.firstUploadDone || keyId !== (app.keyId ?? "") || status !== app.releaseStatus;

  // 종류별 필요한 준비: 서버가 저장된 값으로 계산한 목록 + 카드에서 고르는 입력
  const ready: ReadyItem[] = [
    ...(app.readiness[kind as "first" | "store" | "update"] ?? []),
    ...(isStore ? [{ label: "갱신 항목 1개 이상 선택", ok: items.length > 0, note: items.length ? null : "아래에서 고르세요" }] : []),
    ...(isStore && items.includes("videoLink")
      ? [{ label: "YouTube 링크", ok: isYoutubeUrl(video), note: isYoutubeUrl(video) ? null : "아래 링크 칸에 youtube.com/watch?v=… 또는 youtu.be/… 를 넣으세요" }]
      : []),
    ...(isUpdate ? [{ label: "업데이트 내용(10자 이상)", ok: updateText.trim().length >= 10, note: updateText.trim().length >= 10 ? null : "아래에 적으세요" }] : []),
  ];
  const lacking = ready.filter((r) => r.ok === false);

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNotice(null);
    const { ok, data: d } = await postRelease(body);

    if (ok) onSaved(d);
    setNotice(d.message ?? (ok ? "처리했어요." : "처리하지 못했어요."));
    setBusy(false);
  };

  const approve = () => {
    const picked = kindItems.filter((i) => items.includes(i.value));
    const skipped = kindItems.filter((i) => !items.includes(i.value));
    const itemText = picked.length
      ? `\n\n갱신할 항목(이것만 해요): ${picked.map((i) => i.label).join(", ")}${skipped.length ? `\n건드리지 않음: ${skipped.map((i) => i.label).join(", ")}` : ""}`
      : "";
    const ow = canOverwrite && overwrite;
    const owText = isUpdate
      ? ow
        ? "\n\n홈페이지 프로젝트(설명·기술 스택)도 새 버전에 맞게 바꿔요."
        : "\n\n홈페이지 프로젝트는 그대로 둬요."
      : canOverwrite
        ? ow
          ? "\n\n⚠️ 고른 항목의 홈페이지 프로젝트 기존 값(설명·대표 이미지·앱 링크·기술 스택)을 덮어써요."
          : "\n\n홈페이지 프로젝트는 고른 항목 중 빈 칸만 채워요."
        : "";
    const updText = isUpdate ? `\n\n버전: ${versionName.trim() || `${suggestedVersion ?? "patch +1"}(자동)`} · 버전 코드 +1` : "";

    if (window.confirm(`${app.displayName}: '${kindDef?.label ?? kind}' 일감을 만들고 바로 승인할까요?\n\n${KIND_HELP[kind] ?? ""}${itemText}${updText}${owText}`)) {
      call({
        action: "enqueueRelease",
        aiEngine: aiEngine === "default" ? undefined : aiEngine,
        appSlug: app.appSlug,
        kind,
        runNow: true,
        overwriteProject: ow,
        ...(kindItems.length ? { updateItems: picked.map((i) => i.value) } : {}),
        ...(isUpdate ? { updateText, versionName: versionName.trim(), releaseNotes: releaseNotes.trim() } : {}),
        // '홍보 영상 링크만 반영': 링크를 먼저 저장하고 등록
        ...(isStore && items.includes("videoLink") ? { videoUrl: video.trim() } : {}),
      });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <input
            aria-label={`${app.displayName} 선택`}
            checked={selected}
            disabled={app.active}
            type="checkbox"
            onChange={(e) => onSelect(e.target.checked)}
          />
          <div className="min-w-0">
            <div className="truncate font-semibold">{app.displayName}</div>
            <div className="text-xs text-default-500">
              {app.appSlug} · {app.stack}
              {account ? ` · 계정 ${account.label}(${account.name})` : " · 계정 미정"}
            </div>
            {app.title !== app.displayName && <div className="truncate text-xs text-default-400">작업: {app.title}</div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReviewBadge row={review} />
          <Chip color={app.releaseStatus === "released" ? "success" : app.releaseStatus === "testing" ? "warning" : "default"} size="sm" variant="flat">
            {label}
          </Chip>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {/* ── 공통 설정 ── */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field className="sm:flex-1" help={`스토어·홈페이지에 보일 이름(30자). 비우면 자동: 지금은 ${app.nameSourceLabel}`} label="앱 이름">
            <input className={input} maxLength={30} placeholder={app.displayName} value={appName} onChange={(e) => setAppName(e.target.value)} />
          </Field>
          <Button
            className="min-h-11 sm:min-h-0"
            isDisabled={busy || appName.trim() === (app.appName ?? "")}
            size="sm"
            variant="flat"
            onPress={() => call({ action: "updateApp", appSlug: app.appSlug, appName: appName.trim() })}
          >
            이름 저장
          </Button>
        </div>
        <ReviewBox app={app} busy={busy} call={call} loading={reviewLoading} row={review} />
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
        <label className="flex items-start gap-2 text-sm">
          <input checked={first} className="mt-1" type="checkbox" onChange={(e) => setFirst(e.target.checked)} />
          <span>
            최초 AAB 를 Play Console 에 직접 올렸어요
            <span className="block text-xs text-default-500">
              {isFirst
                ? "첫 출시가 끝나면 안내된 AAB 를 Console 에 올린 뒤 체크하세요. 그 뒤로 스토어 수정·앱 업데이트를 Play 에 올릴 수 있어요."
                : "스토어 수정·앱 업데이트는 이게 체크돼야 Play API 로 올려요."}
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
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
          {dirty && <span className="text-xs text-warning-600">저장하지 않은 설정이 있어요. 아래 준비 목록은 저장한 값 기준이에요.</span>}
          {account?.playConsoleUrl && (
            <a className="text-sm text-primary underline" href={account.playConsoleUrl} rel="noopener noreferrer" target="_blank">
              ▶ Play Console (계정 {account.label}) 열기
            </a>
          )}
        </div>
        <ProjectBox app={app} busy={busy} call={call} data={data} setNotice={setNotice} />

        {/* ── 종류(선택한 종류에 필요한 것만) ── */}
        <div className="space-y-3 rounded-lg border-2 border-default-200 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              aria-label="출시 일감 종류"
              className={`${input} sm:w-56`}
              value={kind}
              onChange={(e) => {
                const next = e.target.value;

                if (next === "first" && app.alreadyReleased && !window.confirm("이미 첫 업로드를 마친 앱이에요. 정말 첫 출시 자료를 다시 만들까요?")) return;
                setKind(next);
                setItems([]);
                setOverwrite(false);
              }}
            >
              {data.kinds
                .filter((k) => k.selectable)
                .map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
            </select>
            <span className="text-sm text-default-600">{kindDef?.hint}</span>
          </div>
          <p className="text-xs text-default-500">순서: {KIND_HELP[kind]}</p>

          {isStore ? (
            <StoreKeySummary app={app} busy={busy} call={call} />
          ) : (
            <KeyBox acc={acc} app={app} busy={busy} call={call} data={data} keyId={keyId} setKeyId={setKeyId} />
          )}

          {isStore && kindItems.length > 0 && (
            <fieldset className="space-y-1 rounded-lg border border-default-200 p-2">
              <legend className="px-1 text-sm font-medium">갱신할 항목 (1개 이상, 고른 것만 해요)</legend>
              {kindItems.map((it) => (
                <label key={it.value} className="flex items-start gap-2 text-sm">
                  <input
                    checked={items.includes(it.value)}
                    className="mt-1"
                    type="checkbox"
                    onChange={(e) =>
                      // '홍보 영상 만들기'와 '홍보 영상 링크만 반영'은 같이 고를 수 없다
                      setItems((s) =>
                        e.target.checked
                          ? [...s.filter((x) => !(it.value === "video" && x === "videoLink") && !(it.value === "videoLink" && x === "video")), it.value]
                          : s.filter((x) => x !== it.value),
                      )
                    }
                  />
                  <span>
                    {it.label}
                    <span className="block text-xs text-default-500">{it.help}</span>
                    {it.value === "privacy" && (
                      <span className="block text-xs text-default-500">
                        Play 의 개인정보처리방침 주소(/project/&lt;이름&gt;/privacy)는 고정이라, 홈페이지 내용만 바꾸면 Play 가 보여 주는 내용도 바뀌어요.
                      </span>
                    )}
                    {it.value === "video" && (
                      <span className="block text-xs text-default-500">링크는 지금 필요 없어요. 검토에서 [이대로 진행] 뒤 &apos;영상 링크 대기&apos;에서 넣어요(&apos;링크만 반영&apos;과 같이 못 골라요).</span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {/* 링크 칸은 '홍보 영상 링크만 반영'을 골랐을 때만(필수). 영상 링크 대기 단계의 칸은 아래 일감 결과에 */}
          {isStore && items.includes("videoLink") && (
            <div className="space-y-1">
              <Field help="YouTube 에 이미 올린 영상의 링크(공개 또는 일부 공개, 퍼가기 허용, 광고 끔). 승인할 때 저장돼요." label="홍보 영상 링크 (YouTube, 필수)">
                <input className={input} placeholder="예: https://youtu.be/…" value={video} onChange={(e) => setVideo(e.target.value)} />
              </Field>
              {video.trim() && !isYoutubeUrl(video) && <p className="text-xs text-danger">youtube.com/watch?v=… 또는 youtu.be/… 링크만 넣을 수 있어요.</p>}
            </div>
          )}
          {isUpdate && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-default-200 p-2 sm:grid-cols-2">
              <Field className="sm:col-span-2" help="무엇을 추가·수정할지(수정 지시처럼 구체적으로, 10자 이상). 이 내용만 고쳐요." label="업데이트 내용 (필수)">
                <textarea className={input} rows={4} value={updateText} onChange={(e) => setUpdateText(e.target.value)} />
              </Field>
              <Field help={`비우면 patch +1${suggestedVersion ? `(제안: ${suggestedVersion})` : ""}. 버전 코드는 자동으로 +1.`} label="버전 이름 (선택)">
                <input className={input} placeholder={suggestedVersion ?? "예: 1.2.4"} value={versionName} onChange={(e) => setVersionName(e.target.value)} />
              </Field>
              <Field help="Play 의 '새로운 기능'(500자 이내). 비우면 공장이 업데이트 내용으로 초안을 써요." label="출시 노트 (선택)">
                <textarea className={input} rows={2} value={releaseNotes} onChange={(e) => setReleaseNotes(e.target.value)} />
              </Field>
            </div>
          )}
          {canOverwrite && !isFirst && (
            <label className="flex items-center gap-2 text-sm">
              <input checked={overwrite} type="checkbox" onChange={(e) => setOverwrite(e.target.checked)} />
              {isUpdate
                ? "홈페이지 프로젝트도 반영 (새 기능이 들어간 설명·기술 스택으로 바꿔요. 끄면 홈페이지는 그대로)"
                : "홈페이지 프로젝트도 덮어쓰기 (고른 항목의 앱 이름·설명·대표 이미지·앱 링크·기술 스택. 끄면 빈 칸만 채움. 개인정보처리방침은 위 항목으로 따로)"}
            </label>
          )}

          <div className="space-y-1 rounded-lg bg-default-50 p-2 text-sm dark:bg-default-50/10">
            <div className="font-medium">이 종류를 하려면 필요한 준비</div>
            <ul className="space-y-0.5">
              {ready.map((r) => (
                <li key={r.label} className={r.ok === false ? "text-warning-700" : ""}>
                  {READY_MARK(r.ok)} {r.label}
                  {r.note ? <span className="text-xs text-default-500"> — {r.note}</span> : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <AiEngineSelect allowDefault value={aiEngine} onChange={setAiEngine} disabled={busy || app.active} />
            <Button className="min-h-11 sm:min-h-0" color="primary" isDisabled={busy || !app.done || app.active || lacking.length > 0} size="sm" onPress={approve}>
              ✅ 승인
            </Button>
            <Button
              className="min-h-11 sm:min-h-0"
              isDisabled={busy || app.active}
              size="sm"
              variant="flat"
              onPress={() => {
                if (window.confirm(`${app.displayName}: ${UNTARGET_CONFIRM}`)) call({ action: "removeStoreTarget", appSlug: app.appSlug });
              }}
            >
              출시 대상에서 빼기
            </Button>
            <Button
              className="min-h-11 sm:min-h-0"
              color="danger"
              isDisabled={busy || app.active}
              size="sm"
              variant="light"
              onPress={() => {
                if (window.confirm(`${app.displayName}: ${REMOVE_CONFIRM}`)) call({ action: "removeApps", appSlugs: [app.appSlug] });
              }}
            >
              출시 데이터 삭제
            </Button>
            {lacking.length > 0 && <span className="text-xs text-warning-600">승인하려면: {lacking.map((r) => r.label).join(", ")}</span>}
            {app.active && (
              <span className="text-xs text-default-500">
                {app.lastReleaseJob?.status === "review" ? "검토 대기 중인 일감이 있어요(먼저 아래에서 결정하세요)" : "진행 중 일감이 있어요(빼기·삭제할 수 없어요)"}
              </span>
            )}
          </div>
        </div>
        {notice && <p className="text-sm text-default-600">{notice}</p>}

        {/* ── 공통 결과 ── */}
        {app.lastReleaseJob && (
          <JobStatus
            app={app}
            busy={busy}
            job={app.lastReleaseJob}
            kinds={data.kinds}
            onDecision={(decision, note) => app.lastReleaseJob && call({ action: "reviewDecision", jobId: app.lastReleaseJob.id, decision, note })}
            onSaveLink={(url) => call({ action: "savePromoVideo", appSlug: app.appSlug, url })}
            onVideoLink={(url) => app.lastReleaseJob && call({ action: "videoLinkApply", jobId: app.lastReleaseJob.id, url })}
            onVideoSkip={() => app.lastReleaseJob && call({ action: "videoLinkSkip", jobId: app.lastReleaseJob.id })}
            onRetry={() => app.lastReleaseJob && call({ action: "retryRelease", jobId: app.lastReleaseJob.id })}
          />
        )}

        {/* ── 시험용 APK(출시 일감과 따로) ── */}
        <TestApkBox app={app} busy={busy} call={call} />

        {app.requiresTesting && app.testingStartedAt && (
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
  // '검수 대기 N장'(앱별, 서버가 대신 확인). 목록과 따로 읽어서 느려도 카드는 먼저 보인다
  const [review, setReview] = useState<ReviewStatusRow[] | null>(null);

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

  // 검수 페이지 주소가 바뀌면(저장·삭제) 다시 확인. 서버가 60초 캐시한다
  const reviewKey = (data?.apps ?? []).map((a) => `${a.appSlug}=${a.reviewUrl ?? ""}`).join("|");
  const hasReviewUrl = !!data?.apps.some((a) => a.reviewUrl);

  useEffect(() => {
    if (!hasReviewUrl) return;
    let stop = false;

    setReview(null);
    fetch("/api/admin/factory/review-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { apps: [] }))
      .then((d: { apps?: ReviewStatusRow[] }) => !stop && setReview(Array.isArray(d.apps) ? d.apps : []))
      .catch(() => !stop && setReview([]));

    return () => {
      stop = true;
    };
  }, [reviewKey, hasReviewUrl]);

  // 진행 중이거나 대기 중인 출시 일감이 있으면 15초마다 단계를 새로 읽는다
  // [키 조회] 결과를 기다리는 앱이 있어도 새로 읽는다
  const live = !!data?.apps.some(
    (a) =>
      (a.lastReleaseJob && ["pending", "approved", "running"].includes(a.lastReleaseJob.status)) ||
      (a.testApk?.job && ["pending", "approved", "running"].includes(a.testApk.job.status)) ||
      a.keyScanRequest ||
      a.key?.checking ||
      a.key?.untracking,
  );

  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 15_000);

    return () => clearInterval(t);
  }, [live, load]);

  if (!data) return <p className="text-sm text-default-500">읽는 중…</p>;

  const apps = data.apps.filter((a) => a.done);
  const reviewOf = (slug: string) => review?.find((r) => r.appSlug === slug);
  // 목록 위 한 줄 요약: 검수 대기가 있는 앱(이름 + 장수)
  const waiting = apps.flatMap((a) => {
    const s = reviewOf(a.appSlug)?.status;

    return a.reviewUrl && s?.state === "ok" && s.review > 0 ? [`${a.displayName} ${s.review}장`] : [];
  });
  const picked = apps.filter((a) => selected.includes(a.appSlug) && !a.active).map((a) => a.appSlug);
  const onSaved = (d: Partial<ReleaseOverview>) => {
    if (d.apps && d.accounts) {
      setData(d as ReleaseOverview);
      setSelected((s) => s.filter((x) => d.apps?.some((a) => a.appSlug === x)));
    } else load();
    // 지운 앱의 행은 사라지니, 그 결과는 목록 위에 보여 준다
    if (d.apps && apps.some((a) => !d.apps?.some((x) => x.appSlug === a.appSlug))) setNotice(d.message ?? null);
  };
  const addOrRemove = async (action: string, appSlug: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    const { data: d } = await postRelease({ ...extra, action, appSlug });

    onSaved(d);
    setNotice(d.message ?? "처리하지 못했어요.");
    setBusy(false);
  };
  const removePicked = async () => {
    if (!picked.length || !window.confirm(`${picked.length}개 앱: ${REMOVE_CONFIRM}\n\n${picked.join(", ")}`)) return;
    setBusy(true);
    const { data: d } = await postRelease({ action: "removeApps", appSlugs: picked });

    onSaved(d);
    setNotice(d.message ?? "처리하지 못했어요.");
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      {waiting.length > 0 && (
        <div className="rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-sm font-medium text-warning-800 dark:bg-warning-50/10">
          🔍 검수 대기가 있는 앱: {waiting.join(" · ")}
        </div>
      )}
      <UploadTestBox data={data} onReload={load} onSaved={onSaved} />
      {apps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button color="danger" isDisabled={busy || picked.length === 0} size="sm" variant="flat" onPress={removePicked}>
            선택한 앱 출시 데이터 삭제{picked.length ? ` (${picked.length})` : ""}
          </Button>
          <span className="text-xs text-default-500">출시 데이터를 비우고 출시 대상에서도 빼요. 앱 소스·지시 기록·PC 의 AAB·키 파일은 그대로예요.</span>
          {notice && <span className="text-sm text-default-600">{notice}</span>}
        </div>
      )}
      {data.accounts.length === 0 && (
        <Card>
          <CardBody className="text-sm">
            먼저 <a className="underline" href="/admin/factory?tab=settings">[설정] 탭</a>에서 배포 계정 A/B 를 만들어 주세요.
          </CardBody>
        </Card>
      )}
      {apps.length === 0 ? (
        <p className="text-sm text-default-500">출시 대상인 완성된 앱이 없어요. 아래 &apos;출시 대상이 아닌 앱&apos;에서 스토어에 올릴 앱을 추가하세요.</p>
      ) : (
        apps.map((a) => (
          <AppRow
            key={a.appSlug}
            app={a}
            data={data}
            review={reviewOf(a.appSlug)}
            reviewLoading={!!a.reviewUrl && review === null}
            selected={selected.includes(a.appSlug)}
            onSaved={onSaved}
            onSelect={(v) => setSelected((s) => (v ? [...s, a.appSlug] : s.filter((x) => x !== a.appSlug)))}
          />
        ))
      )}
      {notice && apps.length === 0 && <p className="text-sm text-default-600">{notice}</p>}
      <OtherApps busy={busy} data={data} onCall={addOrRemove} />
    </div>
  );
}

// 출시 대상이 아닌 앱(접힘). [출시 패키지에 추가]. 웹/서버 앱(nextjs·nestjs)은 버튼 없이 이유만.
// 출시 대상이지만 아직 완성되지 않은 앱도 여기 한 줄로 보여 준다(완성되면 위 목록에 카드가 생김)
function OtherApps({
  data,
  busy,
  onCall,
}: {
  data: ReleaseOverview;
  busy: boolean;
  onCall: (action: string, appSlug: string, extra?: Record<string, unknown>) => void;
}) {
  const others: OtherApp[] = data.otherApps ?? [];
  const unfinished = data.apps.filter((a) => !a.done);
  // 추가할 때 연결할 홈페이지 프로젝트: "" = 나중에 연결, "new" = 새로 만들기, 그 밖 = 기존 프로젝트 id
  const [projectChoice, setProjectChoice] = useState<Record<string, string>>({});
  const add = (a: OtherApp) => {
    const c = projectChoice[a.appSlug] ?? "";

    onCall("addStoreTarget", a.appSlug, a.projectId ? {} : c === "new" ? { newProject: true } : c ? { projectId: c } : {});
  };

  return (
    <details className="rounded-lg border border-default-200 p-3">
      <summary className="cursor-pointer text-sm font-medium">출시 대상이 아닌 앱 ({others.length}개)</summary>
      <p className="mt-1 text-xs text-default-500">앱스토어·플레이스토어에 실제로 올릴 앱만 출시 패키지에 추가하세요. 새 앱은 저절로 들어오지 않아요.</p>
      {unfinished.length > 0 && (
        <div className="mt-2 space-y-1 text-sm">
          <div className="text-xs text-default-500">출시 대상이지만 아직 완성되지 않은 앱(완성되면 위에 카드가 생겨요)</div>
          {unfinished.map((a) => (
            <div key={a.appSlug} className="flex flex-wrap items-center gap-2">
              <span>
                {a.displayName} <span className="text-xs text-default-500">({a.appSlug} · {a.stack})</span>
              </span>
              <Button
                isDisabled={busy || a.active}
                size="sm"
                variant="light"
                onPress={() => {
                  if (window.confirm(`${a.displayName}: ${UNTARGET_CONFIRM}`)) onCall("removeStoreTarget", a.appSlug);
                }}
              >
                출시 대상에서 빼기
              </Button>
            </div>
          ))}
        </div>
      )}
      {others.length === 0 ? (
        <p className="mt-2 text-sm text-default-500">없어요.</p>
      ) : (
        <ul className="mt-2 divide-y divide-default-100">
          {others.map((a) => (
            <li key={a.appSlug} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-sm">
                <div className="truncate font-medium">{a.displayName}</div>
                <div className="text-xs text-default-500">
                  {`${a.appSlug} · ${a.stack} · 마지막 일감: ${JOB_KIND_TEXT[a.lastJob.kind] ?? a.lastJob.kind} ${JOB_STATUS_TEXT[a.lastJob.status] ?? a.lastJob.status} (${fmtDate(a.lastJob.createdAt)})`}
                  {a.done ? "" : " · 아직 완성 전"}
                </div>
              </div>
              {a.blockReason ? (
                <span className="text-xs text-default-500">{a.blockReason}</span>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {a.projectId ? (
                    <span className="text-xs text-default-500">홈페이지 프로젝트: {a.projectTitle} (연결됨)</span>
                  ) : (
                    <select
                      aria-label={`${a.displayName} 에 연결할 홈페이지 프로젝트`}
                      className={`${input} sm:w-64`}
                      value={projectChoice[a.appSlug] ?? ""}
                      onChange={(e) => setProjectChoice((c) => ({ ...c, [a.appSlug]: e.target.value }))}
                    >
                      <option value="">홈페이지 프로젝트: 나중에 연결</option>
                      <option value="new">새 프로젝트 만들기 (개발 중 상태로)</option>
                      {pickableProjects(data, a.appSlug).map((p) => (
                        <option key={p.id} value={p.id}>
                          기존: {p.title} ({p.platform}, {p.status})
                        </option>
                      ))}
                    </select>
                  )}
                  <Button className="min-h-11 sm:min-h-0" color="primary" isDisabled={busy} size="sm" variant="flat" onPress={() => add(a)}>
                    출시 패키지에 추가
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
