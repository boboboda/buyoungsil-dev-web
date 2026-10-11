// components/admin/factory/UploadTestBox.tsx
// 출시 패키지 위쪽 '업로드 시험'(접이식): 작업 PC 가 운영과 같은 경로(PC → 홈페이지 → 업로드 서버)로 시험 파일을 올리고
// 공개 주소·크기·걸린 시간·구간별 성공/실패(HTTP 상태)를 보여 준다. 업로드 서버에는 삭제 API 가 없어 시험 파일이 남는다.
"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";

import { fmtSize, postRelease, type ReleaseOverview, type UploadTestReport, type UploadTestStep } from "./releaseTypes";

const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("ko-KR") : "-");
const KIND_TEXT: Record<string, string> = { video: "🎬 영상", image: "🖼 이미지", big: "📏 큰 파일" };

/** 구간별 결과 한 줄 */
function stageText(s: UploadTestStep): string {
  if (s.ok) return "✅ PC→홈페이지 · ✅ 홈페이지→업로드 서버";
  if (s.stage === "upstream") return `✅ PC→홈페이지 · ❌ 홈페이지→업로드 서버${s.upstreamStatus ? `(업로드 서버 HTTP ${s.upstreamStatus})` : ""}`;
  if (s.stage === "receive") return "❌ PC→홈페이지(홈페이지가 거절하거나 끝까지 받지 못함)";

  return `❌ PC→홈페이지${s.status ? `(HTTP ${s.status})` : "(연결 실패)"}`;
}

function Report({ r }: { r: UploadTestReport }) {
  return (
    <div className="space-y-1 rounded-lg border border-default-200 p-2 text-xs">
      <div className="font-medium">
        {KIND_TEXT[r.kind] ?? r.kind} 시험 · {fmt(r.at)}
        {r.synthetic ? " · 합성 파일" : ""}
      </div>
      {r.note && <div className="text-default-600">{r.note}</div>}
      {r.steps.map((s, i) => (
        <div key={i} className={`space-y-1 border-t border-default-100 pt-1 ${s.ok ? "" : "text-danger"}`}>
          <div>
            <b>{s.label}</b> · {fmtSize(s.bytes)} · {s.ms !== null ? `${(s.ms / 1000).toFixed(1)}초` : "-"} · {stageText(s)}
          </div>
          {s.message && <div>{s.message}</div>}
          {s.url && (
            <div className="text-default-700">
              <a className="break-all text-primary underline" href={s.url} rel="noopener noreferrer" target="_blank">
                {s.url}
              </a>
            </div>
          )}
          {s.url && r.kind === "video" && !r.synthetic && (
            <video className="max-h-60 w-full max-w-md rounded border border-default-200" controls preload="metadata" src={s.url}>
              <track kind="captions" />
            </video>
          )}
          {s.url && r.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="업로드 시험 이미지" className="h-16 w-16 rounded border border-default-200" src={s.url} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function UploadTestBox({ data, onSaved, onReload }: { data: ReleaseOverview; onSaved: (d: Partial<ReleaseOverview>) => void; onReload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const t = data.uploadTest;
  const running = !!t?.current && !t.current.stale;

  // 시험 중에는 5초마다 새로 읽는다
  useEffect(() => {
    if (!running) return;
    const id = setInterval(onReload, 5000);

    return () => clearInterval(id);
  }, [running, onReload]);

  const start = async (kind: "video" | "image" | "big") => {
    if (kind === "big") {
      const last = t?.last.big;
      const recent = last ? `\n\n최근 결과(${fmt(last.at)}): ${last.note ?? "-"}\n같은 크기를 다시 올리면 같은 파일이 또 남아요. 최근 결과로 충분하면 취소하세요.` : "";

      if (!window.confirm(`10MB → 50MB → 120MB 시험 파일을 차례로 올려요(처음 실패한 크기에서 멈춤).\n시험 파일이 업로드 서버에 남아요(최대 약 180MB, 삭제 기능 없음).${recent}`)) return;
    }
    setBusy(true);
    setNotice(null);
    const { ok, data: d } = await postRelease({ action: "uploadTestStart", kind });

    if (ok) onSaved(d);
    setNotice(d.message ?? (ok ? "요청했어요." : "요청하지 못했어요."));
    setBusy(false);
  };

  return (
    <details className="rounded-lg border border-default-200 p-3" open={running}>
      <summary className="cursor-pointer text-sm font-medium">🧪 업로드 시험 (실제 경로로 테스트 파일을 올려 주소 받기)</summary>
      <div className="mt-2 space-y-2 text-sm">
        <p className="text-xs text-default-500">
          작업 PC 가 운영과 같은 코드로 PC → 홈페이지 → 업로드 서버까지 올려 봐요. 실패하면 어느 구간에서 어떤 HTTP 상태인지 보여 줘요(413 이면 크기 제한).
          시험 파일은 업로드 서버에 남아요(삭제 기능 없음, 주소를 아는 사람만 볼 수 있음).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11 sm:min-h-0" isDisabled={busy || running} size="sm" variant="flat" onPress={() => start("video")}>
            🎬 영상 시험 올리기
          </Button>
          <Button className="min-h-11 sm:min-h-0" isDisabled={busy || running} size="sm" variant="flat" onPress={() => start("image")}>
            🖼 이미지 시험 올리기
          </Button>
          <Button className="min-h-11 sm:min-h-0" color="warning" isDisabled={busy || running} size="sm" variant="flat" onPress={() => start("big")}>
            📏 큰 파일 시험(최대 120MB)
          </Button>
        </div>
        {t?.current && (
          <p className={`text-xs ${t.current.stale ? "text-danger" : "text-default-600"}`}>
            {KIND_TEXT[t.current.kind]} 시험{" "}
            {t.current.stale
              ? `응답 없음(요청 ${fmt(t.current.requestedAt)}). 작업 PC 가 꺼져 있거나 감독 프로그램이 예전 버전일 수 있어요. 다시 눌러 보세요.`
              : t.current.takenAt
                ? "진행 중: 작업 PC 가 올리는 중…"
                : "요청함: 작업 PC 가 15초 안에 가져가요…"}
          </p>
        )}
        {notice && <p className="text-xs text-default-600">{notice}</p>}
        {(["video", "image", "big"] as const).map((k) => t?.last[k] && <Report key={k} r={t.last[k] as UploadTestReport} />)}
      </div>
    </details>
  );
}
