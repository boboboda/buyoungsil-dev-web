"use client";

// 통제실 프로젝트 연결 설정의 '배치 설정'(3-4): 공용 배치 편집기가 게임마다 다르게 동작하는 부분을 정한다.
// 맵 배경 · 칸 크기 · 맵 형태 · 층 목록 · 놓을 수 있는 그림 종류 · 내보내기 형식과 곳(앱 폴더 경로 또는 서비스 API) · 기존 배치를 불러올 서비스 API.
// 저장은 부모(CardsPanel)의 saveLink({ layoutConfig })로 보낸다. 검사는 서버가 다시 한다(lib/studio/layout.ts cleanLayoutConfig).
import { useState } from "react";

import { DEFAULT_CONFIG, FORMAT_LABELS, HUB_PRESET, LAYOUT_FORMATS, LAYOUT_SHAPES, SHAPE_LABELS, type LayoutConfig } from "@/lib/studio/layout";

const FIELD = "mt-1 w-full min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm";

interface Draft {
  cell: string;
  cols: string;
  rows: string;
  shape: string;
  bgKind: string;
  bgColor: string;
  bgUrl: string;
  layers: string; // "floor:바닥, facility:시설"
  kinds: string;
  format: string;
  schema: string;
  exportLayers: string;
  destKind: string;
  destPath: string;
  importPath: string;
}

const toDraft = (c: LayoutConfig): Draft => ({
  cell: String(c.cell),
  cols: String(c.cols),
  rows: String(c.rows),
  shape: c.shape,
  bgKind: c.background.kind,
  bgColor: c.background.color || "#e5e7eb",
  bgUrl: c.background.url,
  layers: c.layers.map((l) => `${l.id}:${l.name}`).join(", "),
  kinds: c.allowedKinds.join(", "),
  format: c.format,
  schema: c.schema,
  exportLayers: c.exportLayers.join(", "),
  destKind: c.dest.kind,
  destPath: c.dest.kind === "none" ? "" : c.dest.path,
  importPath: c.importPath,
});

const list = (text: string) => text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

/** 입력칸 → 서버로 보낼 설정 객체(검사는 서버가 한다) */
export function draftToConfig(d: Draft): Record<string, unknown> {
  return {
    cell: Number(d.cell),
    cols: Number(d.cols),
    rows: Number(d.rows),
    shape: d.shape,
    background: { kind: d.bgKind, color: d.bgKind === "color" ? d.bgColor : "", url: d.bgKind === "image" ? d.bgUrl : "" },
    layers: list(d.layers).map((s) => {
      const [id, ...name] = s.split(":");

      return { id: id.trim(), name: (name.join(":") || id).trim() };
    }),
    allowedKinds: list(d.kinds),
    format: d.format,
    schema: d.schema.trim(),
    exportLayers: list(d.exportLayers),
    dest: d.destKind === "none" ? { kind: "none" } : { kind: d.destKind, path: d.destPath.trim() },
    importPath: d.importPath.trim(),
  };
}

export default function LayoutConfigForm({ config, busy, onSave }: { config: LayoutConfig | null; busy: boolean; onSave: (layoutConfig: Record<string, unknown> | null) => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(config ?? DEFAULT_CONFIG));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <fieldset className="min-w-0 space-y-2 rounded border border-default-300 p-2" data-layout-config>
      <legend className="fx-label px-1">배치 설정 {config ? "" : "(아직 없음)"}</legend>
      <p className="text-xs fx-muted">공용 배치 편집기(스튜디오 [제작] &gt; [배치])가 이 프로젝트에서 어떻게 동작할지 정해요. 층은 &apos;id:이름&apos;을 쉼표로 이어 적어요(아래층이 먼저).</p>
      <div className="flex flex-wrap gap-2">
        <button className="rounded border border-default-300 px-2 py-1 text-sm" data-layout-preset="hub" disabled={busy} type="button" onClick={() => setDraft(toDraft(HUB_PRESET))}>
          새싹 허브 값 채우기
        </button>
        <button className="rounded border border-default-300 px-2 py-1 text-sm" data-layout-preset="default" disabled={busy} type="button" onClick={() => setDraft(toDraft(DEFAULT_CONFIG))}>
          기본값으로
        </button>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-4">
        <label className="block text-sm">
          <span className="fx-label">칸 크기(px)</span>
          <input className={FIELD} data-layout-field="cell" inputMode="numeric" type="text" value={draft.cell} onChange={(e) => set({ cell: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="fx-label">가로 칸</span>
          <input className={FIELD} data-layout-field="cols" inputMode="numeric" type="text" value={draft.cols} onChange={(e) => set({ cols: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="fx-label">세로 칸</span>
          <input className={FIELD} data-layout-field="rows" inputMode="numeric" type="text" value={draft.rows} onChange={(e) => set({ rows: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="fx-label">맵 형태</span>
          <select className={FIELD} data-layout-field="shape" value={draft.shape} onChange={(e) => set({ shape: e.target.value })}>
            {LAYOUT_SHAPES.map((s) => (
              <option key={s} value={s}>
                {SHAPE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="fx-label">맵 배경</span>
          <select className={FIELD} data-layout-field="bgKind" value={draft.bgKind} onChange={(e) => set({ bgKind: e.target.value })}>
            <option value="none">없음</option>
            <option value="color">색(타일 바탕)</option>
            <option value="image">그림 주소</option>
          </select>
        </label>
        {draft.bgKind === "color" ? (
          <label className="block text-sm">
            <span className="fx-label">배경 색</span>
            <input className={FIELD} data-layout-field="bgColor" type="text" value={draft.bgColor} onChange={(e) => set({ bgColor: e.target.value })} />
          </label>
        ) : null}
        {draft.bgKind === "image" ? (
          <label className="block text-sm sm:col-span-2">
            <span className="fx-label">배경 그림 주소(https:// 또는 /경로)</span>
            <input className={FIELD} data-layout-field="bgUrl" type="text" value={draft.bgUrl} onChange={(e) => set({ bgUrl: e.target.value })} />
          </label>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="fx-label">층 목록</span>
          <input className={FIELD} data-layout-field="layers" type="text" value={draft.layers} onChange={(e) => set({ layers: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="fx-label">놓을 수 있는 그림 종류(비우면 모두)</span>
          <input className={FIELD} data-layout-field="kinds" placeholder="예: image-prop" type="text" value={draft.kinds} onChange={(e) => set({ kinds: e.target.value })} />
        </label>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="fx-label">내보내기 형식</span>
          <select className={FIELD} data-layout-field="format" value={draft.format} onChange={(e) => set({ format: e.target.value })}>
            {LAYOUT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="fx-label">스키마 이름</span>
          <input className={FIELD} data-layout-field="schema" type="text" value={draft.schema} onChange={(e) => set({ schema: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="fx-label">내보낼 층(비우면 모두)</span>
          <input className={FIELD} data-layout-field="exportLayers" placeholder="예: decor" type="text" value={draft.exportLayers} onChange={(e) => set({ exportLayers: e.target.value })} />
        </label>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="fx-label">내보낼 곳</span>
          <select className={FIELD} data-layout-field="destKind" value={draft.destKind} onChange={(e) => set({ destKind: e.target.value })}>
            <option value="none">정하지 않음</option>
            <option value="folder">앱 폴더 안 파일 경로</option>
            <option value="service">서비스 API</option>
          </select>
        </label>
        {draft.destKind !== "none" ? (
          <label className="block text-sm">
            <span className="fx-label">{draft.destKind === "folder" ? "파일 경로" : "API 경로"}</span>
            <input className={FIELD} data-layout-field="destPath" placeholder={draft.destKind === "folder" ? "assets/layout/hub_layout.json" : "/p/hub/api/studio-layout"} type="text" value={draft.destPath} onChange={(e) => set({ destPath: e.target.value })} />
          </label>
        ) : null}
        <label className="block text-sm">
          <span className="fx-label">기존 배치 불러올 서비스 API(GET, 선택)</span>
          <input className={FIELD} data-layout-field="importPath" placeholder="/p/hub/api/studio-layout" type="text" value={draft.importPath} onChange={(e) => set({ importPath: e.target.value })} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="rounded border border-default-300 px-3 py-1 font-semibold" data-layout-config-save disabled={busy} type="button" onClick={() => onSave(draftToConfig(draft))}>
          [배치 설정 저장]
        </button>
        {config ? (
          <button className="rounded border border-default-300 px-3 py-1" data-layout-config-clear disabled={busy} type="button" onClick={() => onSave(null)}>
            [설정 지우기]
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}
