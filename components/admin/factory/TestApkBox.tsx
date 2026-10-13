// components/admin/factory/TestApkBox.tsx
// 출시 패키지 카드의 '시험용 APK': 등록된 서명 키로 release APK 를 만들어(출시 일감 종류 apk) 통제실에서 내려받는다(관리자만).
// 준비 조건(앱 종류·배포 계정·패키지 이름·서명 키·비밀번호·키 파일)이 모자라면 요청 버튼을 막고 무엇이 부족한지 보여 준다.
// 첫 출시·스토어 수정·앱 업데이트의 준비 조건과는 따로다. Play 는 건드리지 않는다.
"use client";

import { Button } from "@heroui/react";

import { fmtSize, type ReadyItem, type ReleaseApp } from "./releaseTypes";

const MARK = (ok: boolean | null) => (ok === true ? "✅" : ok === false ? "⬜" : "⏳");
const RUNNING = ["pending", "approved", "running"];
const when = (v: string | null) => (v ? new Date(v).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-");
// APK 에 든 CPU 종류 한 줄. 예전 것(null)은 표시하지 않는다
const ABI_LINE: Record<string, string> = {
  "arm64-v8a": "📱 휴대폰용(arm64) — 에뮬레이터(x86_64)나 아주 오래된 32비트 폰에는 설치되지 않을 수 있어요.",
  universal: "모든 CPU 용(예전 방식, 파일이 커요).",
};
const abiLine = (abi: string | null) => (abi ? (ABI_LINE[abi] ?? `CPU ${abi} 전용`) : null);

export default function TestApkBox({ app, busy, call }: { app: ReleaseApp; busy: boolean; call: (body: Record<string, unknown>) => void }) {
  const t = app.testApk;
  const ready: ReadyItem[] = app.readiness.apk ?? [];
  const lacking = ready.filter((r) => r.ok === false);
  const job = t?.job ?? null;
  const running = !!job && RUNNING.includes(job.status);
  const files = t?.files ?? [];
  // 같은 앱의 다른 일감(출시·수정)이 돌고 있으면 앱 폴더를 같이 쓰므로 막는다
  const blocked = lacking.length > 0 || !app.done || app.active || running;
  const why = !app.done
    ? "완성된 앱만 만들 수 있어요"
    : running
      ? "시험용 APK 를 만드는 중이에요"
      : app.active
        ? "이 앱의 다른 일감이 진행 중이에요(끝난 뒤 요청)"
        : lacking.length
          ? `부족한 것: ${lacking.map((r) => `${r.label}${r.note ? `(${r.note})` : ""}`).join(", ")}`
          : null;

  return (
    <details className="rounded-lg border border-default-200 p-2" open={running || files.length > 0 || job?.status === "failed"}>
      <summary className="cursor-pointer text-sm font-medium">
        📲 시험용 APK{files.length ? ` · ${files.length}개` : ""}
        {running ? ` · 만드는 중(${job?.phaseLabel ?? "대기"})` : job?.status === "failed" ? " · 실패" : ""}
      </summary>
      <div className="mt-2 space-y-2 text-sm">
        <p className="text-xs text-default-500">
          등록된 서명 키로 release APK 를 만들어 휴대폰에서 바로 설치해 시험해요. Play Console 은 건드리지 않아요.
          휴대폰용(arm64) 하나만 만들어요: 에뮬레이터(x86_64)나 아주 오래된 32비트 폰에는 설치되지 않을 수 있어요.
        </p>
        <ul className="space-y-0.5 text-xs">
          {ready.map((r) => (
            <li key={r.label} className="break-words">
              {MARK(r.ok)} {r.label}
              {r.note ? <span className="text-default-500"> — {r.note}</span> : null}
            </li>
          ))}
        </ul>
        <Button
          className="min-h-12 w-full sm:w-auto"
          color="primary"
          isDisabled={busy || blocked}
          variant="flat"
          onPress={() => {
            if (window.confirm(`${app.displayName}: 시험용 APK 를 만들까요?\n\n등록된 서명 키로 release APK 를 만들고 서명을 확인한 뒤 여기서 내려받을 수 있게 올려요(몇 분 걸려요).`)) {
              call({ action: "enqueueRelease", appSlug: app.appSlug, kind: "apk", runNow: true });
            }
          }}
        >
          🛠 시험용 APK 만들기
        </Button>
        {why && <p className="text-xs text-warning-600">{why}</p>}

        {job && (
          <div className={`rounded-lg border p-2 text-xs ${job.status === "failed" ? "border-danger-200 bg-danger-50 dark:bg-danger-50/10" : "border-default-200"}`}>
            최근 요청: {when(job.createdAt)} ·{" "}
            <b>
              {running
                ? job.status === "running"
                  ? `진행 중(${job.phaseLabel})`
                  : "대기 중(작업 PC 가 곧 시작)"
                : job.status === "done"
                  ? "완료"
                  : job.status === "failed"
                    ? `실패(${job.failStageLabel ?? "?"} 단계)`
                    : job.status}
            </b>
            {job.failReason && <div className="mt-1 whitespace-pre-wrap break-words text-default-700">이유: {job.failReason}</div>}
            {job.status === "failed" && (
              <Button className="mt-1 min-h-11 sm:min-h-0" color="warning" isDisabled={busy || app.active} size="sm" variant="flat" onPress={() => call({ action: "retryRelease", jobId: job.id })}>
                🔁 재시도 ({job.failStageLabel ?? "처음"}부터)
              </Button>
            )}
          </div>
        )}

        {files.length > 0 ? (
          <ul className="space-y-2">
            {files.map((f, i) => (
              <li key={f.id} className="space-y-1 rounded-lg border border-default-200 p-2">
                <div className="text-xs">
                  {i === 0 ? <b>최신 · </b> : null}버전 {f.versionName ?? "?"}({f.versionCode ?? "?"}) · {fmtSize(f.size)} · 빌드 {when(f.builtAt)}
                </div>
                <div className="break-all text-xs text-default-500">
                  커밋 {f.gitCommit ?? "-"} · SHA-256 <code>{f.sha256.slice(0, 12)}</code>
                  {f.keyLabel ? ` · 서명 키 ${f.keyLabel}` : ""}
                </div>
                {abiLine(f.abi) && <div className="text-xs">{abiLine(f.abi)}</div>}
                <a
                  className="flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground sm:w-auto sm:inline-flex"
                  download={f.fileName}
                  href={`/api/admin/factory/test-apk/${encodeURIComponent(f.id)}`}
                >
                  ⬇ 내려받기
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-default-500">아직 내려받을 APK 가 없어요.</p>
        )}
        <p className="text-xs text-default-500">
          설치: 휴대폰에서 내려받은 뒤 파일을 열고, 처음이면 브라우저(또는 파일 앱)의 &apos;출처를 알 수 없는 앱 설치&apos;를 허용하세요.
        </p>
        <p className="text-xs text-default-500">
          같은 기기에 덮어 설치하려면 서명이 같아야 해요. 다른 키로 만든 APK(또는 Play 에서 받은 앱)가 깔려 있으면 먼저 지우고 설치하세요. 앱당 최근 5개만 남아요.
        </p>
      </div>
    </details>
  );
}
