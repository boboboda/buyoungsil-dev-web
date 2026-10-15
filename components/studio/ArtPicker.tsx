// components/studio/ArtPicker.tsx
// 그림 썸네일 선택기. 카드 [고치기]의 기본 그림, 운영 탭 [기본 그림으로], 제작 탭 참고 그림 고르기가 같이 쓴다.
// 그림 주소는 그림 저장소가 이미 주는 url 을 그대로 쓴다(새 공개 경로 없음). 대상 필터 · 칸을 누르면 선택 + 크게 보기.
"use client";

import { useMemo, useState } from "react";

import { RESULT_KIND_LABELS } from "@/lib/factory/projectToolSettings";
import { ALL_SUBJECTS, artDateLabel, filterPickerArts, initialSubject, nextSelection, pickerSubjects, type PickerArt } from "@/lib/studio/artPicker";

const kindLabel = (k: string) => RESULT_KIND_LABELS[k as keyof typeof RESULT_KIND_LABELS] ?? k;
const PIXELATED = { imageRendering: "pixelated" } as const;
const CELL = "relative flex min-w-0 flex-col gap-1 rounded border p-1 text-left";

export default function ArtPicker({
  arts,
  value,
  onChange,
  multiple = false,
  max,
  allowNone = false,
  noneLabel = "(고르지 않음)",
  starIds = [],
  preferSubject,
  disabled = false,
  name,
}: {
  arts: readonly PickerArt[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  max?: number;
  allowNone?: boolean;
  noneLabel?: string;
  starIds?: readonly string[]; // 현재 기본 그림(★)
  preferSubject?: string | null; // 대상 필터 처음 값(카드 대상)
  disabled?: boolean;
  name: string;
}) {
  const subjects = useMemo(() => pickerSubjects(arts), [arts]);
  const [subject, setSubject] = useState(() => initialSubject(arts, preferSubject));
  const [preview, setPreview] = useState<string | null>(value[0] ?? null);
  const list = useMemo(() => filterPickerArts(arts, subject, value), [arts, subject, value]);
  const previewArt = arts.find((a) => a.id === preview) ?? null;
  const star = new Set(starIds);

  if (!arts.length) return <p className="text-xs fx-muted" data-art-picker-empty={name}>승인된 그림이 아직 없어요.</p>;

  return (
    <div className="min-w-0 space-y-2" data-art-picker={name}>
      <label className="block text-xs fx-muted">
        대상
        <select className="mt-1 w-full min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm" data-art-picker-subject disabled={disabled} value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value={ALL_SUBJECTS}>전체 보기</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <ul className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4" data-art-picker-grid>
        {allowNone ? (
          <li>
            <button
              aria-pressed={value.length === 0}
              className={`${CELL} h-full w-full justify-center ${value.length === 0 ? "border-default-700 bg-default-100" : "border-default-300"}`}
              data-art-picker-none
              disabled={disabled}
              type="button"
              onClick={() => {
                onChange([]);
                setPreview(null);
              }}
            >
              <span className="text-xs">{noneLabel}</span>
            </button>
          </li>
        ) : null}
        {list.map((a) => {
          const on = value.includes(a.id);
          const date = artDateLabel(a.decidedAt);

          return (
            <li key={a.id} className="min-w-0">
              <button
                aria-pressed={on}
                className={`${CELL} w-full ${on ? "border-default-700 bg-default-100 outline outline-2 outline-default-700" : "border-default-300"}`}
                data-art-picker-art={a.id}
                disabled={disabled}
                title={`${a.subject} · ${kindLabel(a.kind)}`}
                type="button"
                onClick={() => {
                  onChange(nextSelection(value, a.id, multiple, max));
                  setPreview(a.id);
                }}
              >
                {star.has(a.id) ? (
                  <span aria-label="기본 그림" className="absolute right-1 top-1 rounded bg-default-100 px-1 text-xs" data-art-picker-star>
                    ★
                  </span>
                ) : null}
                <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded bg-default-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt={`${a.subject} ${kindLabel(a.kind)}`} className="max-h-full max-w-full object-contain" loading="lazy" src={a.url} style={PIXELATED} />
                </span>
                <span className="block min-w-0 truncate text-xs font-medium">
                  {a.subject} · {kindLabel(a.kind)}
                </span>
                {date ? <span className="block text-[10px] fx-muted">승인 {date}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {!list.length ? <p className="text-xs fx-muted">이 대상의 승인 그림이 없어요. 전체 보기로 바꿔 보세요.</p> : null}
      {previewArt ? (
        <div className="flex min-w-0 items-start gap-2 rounded border border-default-300 p-2" data-art-picker-preview={previewArt.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={`${previewArt.subject} 크게 보기`} className="max-h-64 max-w-[60%] rounded bg-default-100 object-contain" src={previewArt.url} style={PIXELATED} />
          <p className="min-w-0 text-xs">
            <span className="font-medium">{previewArt.subject}</span> · {kindLabel(previewArt.kind)}
            {artDateLabel(previewArt.decidedAt) ? <span className="block fx-muted">승인 {artDateLabel(previewArt.decidedAt)}</span> : null}
            {star.has(previewArt.id) ? <span className="block">★ 현재 기본 그림</span> : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
