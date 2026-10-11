// components/admin/factory/ReleaseReview.tsx
// 출시 카드의 '검토 대기' 화면과 그 부품.
// - 아이콘·대표 이미지·스크린샷(누르면 크게, [다운로드]), 문구(글자 수·[복사]), 개인정보처리방침 초안, 홍보 영상(업로드 서버 사본 재생. 예전 일감은 DB 사본: 관리자만, 결정 뒤·7일 뒤 지워짐)
// - [✅ 이대로 진행] [🔁 다시 만들기](메모) [취소]. 승인 전에는 Play 업로드·홈페이지 반영·완료가 되지 않는다(서버·감독 프로그램 양쪽에서 막음)
// - 앱 업데이트 완료 결과(버전 이름·코드, AAB 크기, 시험 요약, 업로드 트랙)
"use client";

import { useState } from "react";
import { Button } from "@heroui/react";

import { fmtSize, type ReleaseApp, type ReleaseJobInfo, type StoreAssets } from "./releaseTypes";

const LIMITS: Record<string, number> = { title: 30, shortDescription: 80, fullDescription: 4000 };
const NAMES: Record<string, string> = { title: "앱 이름", shortDescription: "짧은 설명", fullDescription: "긴 설명" };

export function CopyButton({ text, label = "복사" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);

  return (
    <Button
      className="min-h-9 sm:min-h-0"
      size="sm"
      variant="light"
      onPress={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt("복사해서 쓰세요", text);
        }
      }}
    >
      {done ? "복사됨" : label}
    </Button>
  );
}

/** 스토어 문구(언어별): 글자 수와 [복사] */
export function ListingCopy({ listing }: { listing: Record<string, Record<string, unknown>> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Object.entries(listing).map(([lang, v]) => (
        <div key={lang} className="space-y-1">
          <div className="text-xs font-semibold text-default-500">{lang === "ko" || lang === "ko-KR" ? `한국어 (${lang})` : lang === "en" || lang === "en-US" ? `영어 (${lang})` : lang}</div>
          {Object.entries(v ?? {}).map(([k, val]) => {
            const s = typeof val === "string" ? val : JSON.stringify(val);
            const n = [...s].length;
            const over = LIMITS[k] && n > LIMITS[k];

            return (
              <div key={k} className="text-sm">
                <div className="flex items-center gap-1 text-default-500">
                  <span>
                    {NAMES[k] ?? k} ({n}
                    {LIMITS[k] ? `/${LIMITS[k]}` : ""}자{over ? " ⚠️ 초과" : ""})
                  </span>
                  <CopyButton text={s} />
                </div>
                <div className="whitespace-pre-wrap break-words">{s}</div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** 아이콘·대표 이미지·스크린샷: 누르면 크게, [다운로드] */
export function ImageGallery({ assets }: { assets: StoreAssets }) {
  const [big, setBig] = useState<{ url: string; name: string } | null>(null);
  const items = [
    ["icon", "아이콘"],
    ["feature", "대표 이미지"],
    ...Object.keys(assets.images)
      .filter((k) => k.startsWith("phone-"))
      .sort()
      .map((k) => [k, `스크린샷 ${Number(k.slice(6))}`]),
  ]
    .map(([k, label]) => ({ k, label, url: assets.images[k]?.url ?? null, img: assets.images[k] }))
    .filter((x): x is typeof x & { url: string } => !!x.url);

  if (items.length === 0) return <p className="text-xs text-default-500">올라온 이미지가 없어요.</p>;

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        {items.map((x) => (
          <figure key={x.k} className="space-y-1 text-center text-xs">
            <button className="block" title="크게 보기" type="button" onClick={() => setBig({ url: x.url, name: x.label })}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={x.label} className={`rounded border border-default-200 ${x.k === "icon" ? "h-16 w-16" : x.k === "feature" ? "h-20" : "h-40"}`} src={x.url} />
            </button>
            <figcaption>
              {x.label}
              {x.img?.width ? ` ${x.img.width}x${x.img.height}` : ""}
              <br />
              <a className="text-primary underline" download href={x.url} rel="noopener noreferrer" target="_blank">
                다운로드
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
      {big && (
        <button
          aria-label="크게 보기 닫기"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-black/80 p-4"
          type="button"
          onClick={() => setBig(null)}
          onKeyDown={(e) => e.key === "Escape" && setBig(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={big.name} className="max-h-[85vh] max-w-full rounded" src={big.url} />
          <span className="text-sm text-white">{big.name} · 아무 곳이나 누르면 닫혀요</span>
        </button>
      )}
    </>
  );
}

const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("ko-KR") : "-");

/** 검토 대기 화면 */
export function ReviewPanel({
  app,
  job,
  busy,
  onDecision,
}: {
  app: ReleaseApp;
  job: ReleaseJobInfo;
  busy: boolean;
  onDecision: (decision: "approve" | "redo" | "cancel", note?: string) => void;
}) {
  const [redo, setRedo] = useState(false);
  const [note, setNote] = useState("");
  const assets = app.storeAssets && app.storeAssets.jobId === job.id ? app.storeAssets : null;
  const pkg = app.releasePackageJob === job.id ? app.releasePackage : null;
  const listing = (assets?.listing ?? (pkg?.storeListing as Record<string, Record<string, unknown>> | undefined) ?? null) as Record<string, Record<string, unknown>> | null;
  const privacy = typeof pkg?.privacyPolicyDraft === "string" ? pkg.privacyPolicyDraft : null;
  const videoStage = assets?.stages.video;
  const isFirst = job.releaseKind === "first";

  return (
    <div className="space-y-3 rounded-lg border-2 border-warning-300 bg-warning-50 p-3 text-sm dark:bg-warning-50/10">
      <div className="font-semibold">👀 검토 대기 · {fmt(job.reviewAt)}</div>
      <p className="text-xs text-default-600">
        확인한 뒤 [이대로 진행]을 눌러야 {isFirst ? "홈페이지 프로젝트 빈 칸 채우기와 최초 AAB 안내" : "Play 업로드와 홈페이지 반영"}가 돼요. 그 전에는 아무것도 바깥에 나가지
        않아요. 며칠 두어도 사라지지 않아요.
      </p>

      <section className="space-y-1">
        <div className="font-medium">이미지</div>
        {assets ? <ImageGallery assets={assets} /> : <p className="text-xs text-default-500">이번 일감의 스토어 이미지 결과가 아직 없어요.</p>}
        {assets?.stages.screenshots?.status === "skipped" && <p className="text-xs text-warning-700">⏭ {assets.stages.screenshots.note}</p>}
      </section>

      {listing && Object.keys(listing).length > 0 && (
        <section className="space-y-1">
          <div className="font-medium">문구</div>
          <ListingCopy listing={listing} />
        </section>
      )}

      {privacy && (
        <details className="rounded border border-default-200 p-2">
          <summary className="cursor-pointer font-medium">개인정보처리방침 초안</summary>
          <div className="mt-1 flex justify-end">
            <CopyButton text={privacy} />
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{privacy}</pre>
        </details>
      )}

      <section className="space-y-1">
        <div className="font-medium">홍보 영상</div>
        {job.reviewVideo ? (
          <>
            <video className="max-h-96 w-full max-w-xl rounded border border-default-200" controls preload="metadata" src={job.reviewVideo.url ?? `/api/admin/factory/review-video/${job.id}`}>
              <track kind="captions" />
            </video>
            <p className="text-xs text-default-500">
              {job.reviewVideo.expiresAt
                ? `검토용 사본 ${fmtSize(job.reviewVideo.size)} · 결정하거나 ${fmt(job.reviewVideo.expiresAt)}이 지나면 서버에서 지워져요(PC 의 원본은 그대로).`
                : `검토용 사본 ${fmtSize(job.reviewVideo.size)} · 업로드 서버에 있어요(삭제 기능이 없어 남아요. 주소를 아는 사람만 볼 수 있어요). PC 의 원본은 그대로.`}
            </p>
          </>
        ) : videoStage?.status === "skipped" ? (
          <p className="text-xs">⏭ {videoStage.note}</p>
        ) : assets?.video ? (
          <p className="text-xs text-warning-700">
            검토 영상을 통제실에 올리지 못했어요(아래 요약 참고). PC 에서 직접 확인: <code className="break-all">{assets.video.path}</code>
          </p>
        ) : (
          <p className="text-xs text-default-500">영상이 없어요.</p>
        )}
      </section>

      {isFirst && app.aab && (
        <p className="text-xs">
          📱 서명 AAB(PC 에만): <code className="break-all">{app.aab.path}</code> · {app.aab.versionName ?? "?"} ({app.aab.versionCode ?? "?"}) · {fmtSize(app.aab.size)}
        </p>
      )}
      {job.summary && (
        <details>
          <summary className="cursor-pointer text-xs text-default-500">만든 결과 요약</summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">{job.summary}</pre>
        </details>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-0"
          color="success"
          isDisabled={busy}
          size="sm"
          onPress={() => {
            if (window.confirm(isFirst ? "이대로 확정할까요? 홈페이지 프로젝트 빈 칸을 채우고 최초 AAB 위치를 알려 줘요." : "이대로 진행할까요? Play 업로드와 홈페이지 반영을 시작해요.")) {
              onDecision("approve");
            }
          }}
        >
          ✅ 이대로 진행
        </Button>
        <Button className="min-h-11 sm:min-h-0" color="warning" isDisabled={busy} size="sm" variant="flat" onPress={() => setRedo((v) => !v)}>
          🔁 다시 만들기
        </Button>
        <Button
          className="min-h-11 sm:min-h-0"
          color="danger"
          isDisabled={busy}
          size="sm"
          variant="light"
          onPress={() => window.confirm("이 출시 일감을 취소할까요? 작업 PC 의 자료는 그대로 남아요.") && onDecision("cancel")}
        >
          취소
        </Button>
      </div>
      {redo && (
        <div className="space-y-2">
          <textarea
            className="w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm"
            placeholder="무엇을 다시 만들지 적어 주세요. 예: 스크린샷 3번 다시, 아이콘 색 밝게"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button className="min-h-11 sm:min-h-0" color="warning" isDisabled={busy || !note.trim()} size="sm" onPress={() => onDecision("redo", note)}>
            이 메모로 다시 만들기
          </Button>
          <p className="text-xs text-default-500">메모에 적은 항목만 다시 만들고 나머지는 그대로 둬요. 끝나면 다시 검토 대기로 와요.</p>
        </div>
      )}
    </div>
  );
}

/** 앱 업데이트 완료 결과 */
export function BuildResultView({ job }: { job: ReleaseJobInfo }) {
  const b = job.buildResult;

  if (!b) return null;

  return (
    <div className="space-y-1 rounded-lg border border-default-200 p-2 text-sm">
      <div className="font-medium">📦 빌드 결과</div>
      <div>
        버전 <b>{b.versionName ?? "?"}</b> (코드 {b.versionCode ?? "?"}) · AAB {fmtSize(b.aabSize)}
        {b.aabPath ? (
          <>
            {" "}
            · <code className="break-all text-xs">{b.aabPath}</code>
          </>
        ) : null}
      </div>
      {b.tests && <div>시험: {b.tests}</div>}
      <div className={b.uploaded ? "text-success-600" : "text-default-600"}>
        {b.uploaded ? `✅ ${b.track ?? "alpha"} 트랙(비공개 테스트)에 올렸어요. 프로덕션 승격은 Play Console 에서 직접.` : `업로드: ${b.uploadNote ?? "안 함"}`}
      </div>
      {job.releaseNotes && <div className="text-xs text-default-500">출시 노트(입력): {job.releaseNotes}</div>}
    </div>
  );
}
