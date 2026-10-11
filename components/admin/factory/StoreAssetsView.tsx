// components/admin/factory/StoreAssetsView.tsx
// 출시 패키지 카드의 "스토어 자료"(출시 2단계): 단계별 결과(아이콘·대표 이미지 / 스크린샷 / 영상 / 문구 / 업로드 / 홈페이지 반영),
// 홈페이지에 올라온 이미지(아이콘·대표 이미지·폰 스크린샷: 누르면 크게, [다운로드]), 영상은 PC 경로·크기·길이만, Play 업로드·업데이트 AAB 업로드 결과.
"use client";

import { ImageGallery } from "./ReleaseReview";
import { fmtSize, type StoreAssets } from "./releaseTypes";

const STAGES: [keyof StoreAssets["stages"], string][] = [
  ["icon", "아이콘·대표 이미지"],
  ["screenshots", "스크린샷"],
  ["video", "영상"],
  ["listing", "문구"],
  ["review", "검토"],
  ["upload", "업로드"],
  ["homepage", "홈페이지 반영"],
];
const MARK = { ok: "✅", skipped: "⏭", failed: "❌" } as const;

export default function StoreAssetsView({ assets }: { assets: StoreAssets }) {
  const shots = Object.entries(assets.images)
    .filter(([k, v]) => k.startsWith("phone-") && v.url)
    .sort(([a], [b]) => a.localeCompare(b));
  const icon = assets.images.icon?.url;
  const feature = assets.images.feature?.url;

  return (
    <details className="rounded-lg border border-default-200 p-2" open>
      <summary className="cursor-pointer text-sm font-medium">스토어 자료 · {new Date(assets.at).toLocaleString("ko-KR")}</summary>
      <div className="mt-2 space-y-2 text-sm">
        <ul className="space-y-1">
          {STAGES.map(([k, label]) => {
            const s = assets.stages[k];

            return (
              <li key={k} className="break-words">
                {s ? MARK[s.status] : "·"} <b>{label}</b>
                {s?.note ? <span className="text-default-600"> — {s.note}</span> : s ? null : <span className="text-default-400"> — 아직 없음</span>}
              </li>
            );
          })}
        </ul>
        {(icon || feature || shots.length > 0) && <ImageGallery assets={assets} />}
        {assets.video && (
          <p>
            🎬 홍보 영상(PC 에만): <code className="break-all text-xs">{assets.video.path}</code> · {fmtSize(assets.video.size)}
            {assets.video.durationSec ? ` · ${assets.video.durationSec}초` : " · 길이 모름"}
          </p>
        )}
        {assets.upload && (
          <p className={assets.upload.ok ? "" : "text-danger"}>
            ▶ Play 등록정보 업로드 {assets.upload.ok ? "완료" : "실패"} ({new Date(assets.upload.at).toLocaleString("ko-KR")}): {assets.upload.note}
          </p>
        )}
        {assets.aabUpload && (
          <p className={assets.aabUpload.ok ? "" : "text-danger"}>
            📦 업데이트 AAB 업로드 {assets.aabUpload.ok ? "완료" : "실패"} ({new Date(assets.aabUpload.at).toLocaleString("ko-KR")}): {assets.aabUpload.note}
          </p>
        )}
        {assets.tools && <p className="text-xs text-default-500">확인한 도구: {assets.tools}</p>}
      </div>
    </details>
  );
}
