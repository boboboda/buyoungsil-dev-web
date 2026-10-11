// components/admin/factory/ReleaseReview.tsx
// 출시 카드의 '검토 대기' 화면과 그 부품.
// - 아이콘·대표 이미지·스크린샷(누르면 크게, [다운로드]), 문구(글자 수·[복사]), 개인정보처리방침 초안, 홍보 영상(업로드 서버 사본 재생. 예전 일감은 DB 사본: 관리자만, 결정 뒤·7일 뒤 지워짐)
// - [✅ 이대로 진행] [🔁 다시 만들기](메모) [취소]. 승인 전에는 Play 업로드·홈페이지 반영·완료가 되지 않는다(서버·감독 프로그램 양쪽에서 막음)
// - 앱 업데이트 완료 결과(버전 이름·코드, AAB 크기, 시험 요약, 업로드 트랙)
// - 영상 링크 대기(스토어 수정 '홍보 영상 만들기' 뒤): [영상 내려받기] → YouTube 에 올린 뒤 링크 [링크 반영] 또는 [영상 링크 없이 마치기]
// - 첫 출시 완료 뒤: [영상 내려받기]와 링크 안내(첫 출시는 Play API 를 쓰지 않음), 링크 저장
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
const input = "w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm";
// youtube.com/watch?v=… 또는 youtu.be/… (서버가 한 번 더 확인)
export const isYoutubeUrl = (v: string) => /^https?:\/\/((www\.|m\.)?youtube\.com\/watch\?(.*&)?v=[A-Za-z0-9_-]{11}|youtu\.be\/[A-Za-z0-9_-]{11})/.test(v.trim());
const YT_GUIDE = "YouTube 에 올린 뒤 링크를 붙여 넣으세요(공개 또는 일부 공개, 퍼가기 허용, 광고 끔).";

/** [영상 내려받기](업로드 서버의 검토용 사본) + 원본 위치 */
export function VideoDownload({ job }: { job: ReleaseJobInfo }) {
  const src = job.reviewVideo ? (job.reviewVideo.url ?? `/api/admin/factory/review-video/${job.id}`) : null;

  return (
    <div className="space-y-1 text-xs">
      {src ? (
        <a className="inline-block rounded-lg bg-primary-100 px-3 py-2 text-sm text-primary-700" download href={src} rel="noopener noreferrer" target="_blank">
          ⬇️ 영상 내려받기 ({fmtSize(job.reviewVideo?.size)})
        </a>
      ) : (
        <span className="text-default-500">통제실에 올라간 영상 사본이 없어요.</span>
      )}
      {job.originalVideo && (job.originalVideo.reduced || !src) && (
        <div className="text-default-600">
          {job.originalVideo.reduced ? "줄여서 올린 사본이에요. " : ""}원본은 PC 의 <code className="break-all">{job.originalVideo.path}</code> 에 있어요(
          {fmtSize(job.originalVideo.size)}).
        </div>
      )}
    </div>
  );
}

/** 영상 링크 대기: 내려받기 → YouTube → [링크 반영] / [영상 링크 없이 마치기] */
export function LinkWaitPanel({
  app,
  job,
  busy,
  onApply,
  onSkip,
}: {
  app: ReleaseApp;
  job: ReleaseJobInfo;
  busy: boolean;
  onApply: (url: string) => void;
  onSkip: () => void;
}) {
  const [url, setUrl] = useState(app.promoVideoUrl ?? "");
  const valid = isYoutubeUrl(url);

  return (
    <div className="space-y-2 rounded-lg border-2 border-warning-300 bg-warning-50 p-3 text-sm dark:bg-warning-50/10">
      <div className="font-semibold">🎬 영상 링크 대기</div>
      <p className="text-xs text-default-600">
        이미지·문구는 Play 에 반영했어요. 홍보 영상을 내려받아 YouTube 에 올리고 링크를 넣으면 Play 등록정보 영상만 바꾸고 완료로 닫아요. 며칠 두어도 사라지지
        않고, 다른 일감도 막지 않아요.
      </p>
      <VideoDownload job={job} />
      <p className="text-xs">{YT_GUIDE}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input className={`${input} sm:flex-1`} placeholder="예: https://youtu.be/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button className="min-h-11 sm:min-h-0" color="warning" isDisabled={busy || !valid} size="sm" onPress={() => onApply(url.trim())}>
          링크 반영
        </Button>
        <Button
          className="min-h-11 sm:min-h-0"
          isDisabled={busy}
          size="sm"
          variant="light"
          onPress={() => window.confirm("영상 링크 없이 이 일감을 완료로 닫을까요? 링크는 나중에 '홍보 영상 링크만 반영'으로 넣을 수 있어요.") && onSkip()}
        >
          영상 링크 없이 마치기
        </Button>
      </div>
      {url.trim() && !valid && <p className="text-xs text-danger">YouTube 링크(youtube.com/watch?v=… 또는 youtu.be/…)만 넣을 수 있어요.</p>}
    </div>
  );
}

/** 첫 출시 완료 뒤 영상: 내려받기와 링크 안내(Play API 를 쓰지 않음), 링크는 저장만(나중에 스토어 수정에서 씀) */
export function FirstVideoPanel({ app, job, busy, onSave }: { app: ReleaseApp; job: ReleaseJobInfo; busy: boolean; onSave: (url: string) => void }) {
  const [url, setUrl] = useState(app.promoVideoUrl ?? "");
  const valid = !url.trim() || isYoutubeUrl(url);

  if (!job.reviewVideo && !job.originalVideo) return null;

  return (
    <div className="space-y-2 rounded-lg border border-default-200 p-2 text-sm">
      <div className="font-medium">🎬 홍보 영상</div>
      <VideoDownload job={job} />
      <p className="text-xs text-default-600">
        {YT_GUIDE} 링크는 Play Console 에 직접 입력하거나, 첫 업로드 뒤 스토어 수정의 &apos;홍보 영상 링크만 반영&apos;으로 넣으세요.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input className={`${input} sm:flex-1`} placeholder="예: https://youtu.be/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button className="min-h-11 sm:min-h-0" isDisabled={busy || !valid || url.trim() === (app.promoVideoUrl ?? "")} size="sm" variant="flat" onPress={() => onSave(url.trim())}>
          링크 저장
        </Button>
      </div>
    </div>
  );
}

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
        {(job.reviewVideo || job.originalVideo) && (
          <>
            <VideoDownload job={job} />
            {!isFirst && <p className="text-xs text-default-500">[이대로 진행] 뒤 &apos;영상 링크 대기&apos;에서 YouTube 링크를 넣으면 Play 등록정보 영상에 반영돼요.</p>}
          </>
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
