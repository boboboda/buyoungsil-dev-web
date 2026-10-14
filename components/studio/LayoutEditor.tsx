// components/studio/LayoutEditor.tsx
// /studio/<앱> [제작] > [배치] 공용 배치 편집기(3-4). 게임마다 다른 부분(칸 크기·맵 형태·층·그림 종류·내보내기)은 프로젝트 연결 설정의 '배치 설정'이 정한다.
// 보관함의 승인 그림을 끌어다 놓거나(터치는 그림을 누른 뒤 맵을 누름) 이름으로 놓는다. 칸 맞춤·회전·겹침 순서·층 전환·지우기·되돌리기/다시. 저장할 때마다 판 번호가 오른다.
// 규칙 계산은 lib/studio/layout.ts(순수). 이 파일은 화면과 서버 호출만 한다. 관리자가 아니면(접근 키) 보기만 된다.
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { FORMAT_LABELS, SHAPE_LABELS, createUndo, emptyBoard, exportBoard, firstFreeCell, flipItem, footprint, lockItem, moveItem, moveZ, overlappingIds, placeItem, pushUndo, redo, removeItem, renameItem, rotateItem, setItemLayer, stepOf, undo, type LayoutBoard, type LayoutItem, type UndoState, type ZMove } from "@/lib/studio/layout";
import type { LayoutData, LayoutPaletteArt } from "@/lib/studio/layoutData";

const FIELD = "mt-1 w-full min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm";
const BTN = "rounded border border-default-300 px-2 py-1 text-sm disabled:opacity-40";
const PIXELATED = { imageRendering: "pixelated" } as const;
const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const SOURCE_LABELS: Record<string, string> = { editor: "저장", import: "불러옴", restore: "되돌림" };
const EXPORT_LABELS: Record<string, string> = { requested: "일감 등록됨", done: "보냄", failed: "실패", unsupported: "서비스 API 미지원" };

interface Drag {
  id: string;
  offX: number;
  offY: number;
  x: number;
  y: number;
}

export default function LayoutEditor({ data, canEdit }: { data: LayoutData; canEdit: boolean }) {
  const router = useRouter();
  const [notice, setNotice] = useState(""); // 판이 바뀌어 편집기가 다시 열려도 안내 문구는 남긴다
  const config = data.config;
  const start = useMemo(() => data.board ?? (config ? emptyBoard(config) : null), [data.board, config]);

  if (!config || !start) {
    return (
      <section className="fx-panel space-y-1 p-4" data-layout-noconfig>
        <h2 className="fx-label">배치</h2>
        <p className="text-sm fx-muted">배치 설정이 아직 없어요. 통제실의 프로젝트 연결 설정에서 &apos;배치 설정&apos;(칸 크기·맵 형태·층·내보내기)을 먼저 정해 주세요.</p>
      </section>
    );
  }

  return <Editor key={`${data.appSlug}-${data.version}`} canEdit={canEdit} data={data} initial={start} notice={notice} router={router} setNotice={setNotice} />;
}

function Editor({ data, canEdit, initial, router, notice, setNotice }: { data: LayoutData; canEdit: boolean; initial: LayoutBoard; router: ReturnType<typeof useRouter>; notice: string; setNotice: (s: string) => void }) {
  const config = data.config!;
  const [hist, setHist] = useState<UndoState>(() => createUndo(initial));
  const [saved, setSaved] = useState<LayoutBoard>(initial);
  const [version, setVersion] = useState(data.version);
  const [sel, setSel] = useState<string | null>(null);
  const [layer, setLayer] = useState(() => config.layers.find((l) => !config.exportLayers.length || config.exportLayers.includes(l.id))?.id ?? config.layers[0].id);
  const [hidden, setHidden] = useState<string[]>([]);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(() => Math.min(1.5, Math.max(0.25, Math.round((640 / (config.cols * config.cell)) * 20) / 20)));
  const [picked, setPicked] = useState<LayoutPaletteArt | null>(null);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [quarter, setQuarter] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [note, setNote] = useState("");
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const board = hist.present;
  const dirty = JSON.stringify(board) !== JSON.stringify(saved);
  const cs = config.cell * zoom;
  const step = stepOf(config, snap);
  const overlaps = useMemo(() => overlappingIds(board), [board]);
  const selected = board.items.find((i) => i.id === sel) ?? null;
  const exportPreview = useMemo(() => exportBoard(board, config), [board, config]);
  const artOf = (it: LayoutItem) => data.palette.find((a) => a.id === it.artId) ?? data.palette.find((a) => a.subject === it.name);
  const commit = (next: LayoutBoard) => setHist((h) => pushUndo(h, next));
  const sizeOf = (a: LayoutPaletteArt) => {
    const s = sizes[a.id];

    return { w: s ? Math.max(1, Math.ceil(s.w / config.cell)) : 1, h: s ? Math.max(1, Math.ceil(s.h / config.cell)) : 1 };
  };

  const cellAt = (clientX: number, clientY: number) => {
    const r = mapRef.current?.getBoundingClientRect();

    return r ? { x: (clientX - r.left) / cs, y: (clientY - r.top) / cs } : { x: 0, y: 0 };
  };

  const add = (a: { name: string; artId?: string; w?: number; h?: number }, at?: { x: number; y: number }) => {
    const w = a.w ?? 1;
    const h = a.h ?? 1;
    const pos = at ?? firstFreeCell(board, layer, w, h);
    const r = placeItem(board, config, { name: a.name, artId: a.artId, layer, x: pos.x, y: pos.y, w, h }, snap);

    if ("error" in r) return setNotice(r.error);
    commit(r.board);
    setSel(r.id);
    setNotice("");
  };

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/studio/layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appSlug: data.appSlug, ...body }) });
      const d = (await res.json().catch(() => ({}))) as { message?: string; version?: number; currentVersion?: number };

      setNotice(d.message || (res.ok ? "처리했어요." : "처리하지 못했어요."));

      return res.ok ? d : null;
    } catch {
      setNotice("서버에 연결하지 못했어요.");

      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const d = await post({ action: "save", board, baseVersion: version, note });

    if (!d) return;
    if (typeof d.version === "number") setVersion(d.version);
    setSaved(board);
    setNote("");
    router.refresh();
  };

  const act = async (body: Record<string, unknown>) => {
    const d = await post(body);

    if (d) router.refresh(); // 판이 바뀌면 key 가 바뀌어 편집기가 새 판으로 다시 열린다
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!canEdit || (e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      setHist((h) => (e.shiftKey ? redo(h) : undo(h)));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      setHist((h) => redo(h));
    } else if (selected) {
      const arrow: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };

      if (arrow[e.key]) {
        e.preventDefault();
        commit(moveItem(board, config, selected.id, selected.x + arrow[e.key][0], selected.y + arrow[e.key][1], snap));
      } else if (e.key === "Delete" || e.key === "Backspace") commit(removeItem(board, selected.id));
      else if (e.key.toLowerCase() === "r") commit(rotateItem(board, selected.id));
    }
  };

  const onItemDown = (e: React.PointerEvent, it: LayoutItem) => {
    e.stopPropagation();
    setSel(it.id);
    if (!canEdit || quarter || it.fixed || it.layer !== layer) return;
    const p = cellAt(e.clientX, e.clientY);

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: it.id, offX: p.x - it.x, offY: p.y - it.y, x: it.x, y: it.y });
  };

  const onItemMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = cellAt(e.clientX, e.clientY);

    setDrag({ ...drag, x: p.x - drag.offX, y: p.y - drag.offY });
  };

  const onItemUp = () => {
    if (drag) commit(moveItem(board, config, drag.id, drag.x, drag.y, snap));
    setDrag(null);
  };

  const onMapDown = (e: React.PointerEvent) => {
    if (!canEdit || quarter) return;
    if (picked) {
      const p = cellAt(e.clientX, e.clientY);
      const s = sizeOf(picked);

      add({ name: picked.subject, artId: picked.id, ...s }, { x: p.x - s.w / 2 + 0.5, y: p.y - s.h / 2 + 0.5 });
    } else setSel(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    const a = data.palette.find((x) => x.id === id);

    if (!a || !canEdit || quarter) return;
    const p = cellAt(e.clientX, e.clientY);
    const s = sizeOf(a);

    add({ name: a.subject, artId: a.id, ...s }, { x: p.x - s.w / 2, y: p.y - s.h / 2 });
  };

  const bg = config.background;
  const gridLines = config.shape === "free" ? "" : `linear-gradient(to right, rgba(0,0,0,.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,.14) 1px, transparent 1px)`;
  const mapStyle: React.CSSProperties = {
    width: board.cols * cs,
    height: board.rows * cs,
    backgroundColor: bg.kind === "color" ? bg.color : "#f5f5f4",
    backgroundImage: [gridLines, bg.kind === "image" ? `url(${bg.url})` : ""].filter(Boolean).join(", ") || undefined,
    backgroundSize: [gridLines ? `${cs}px ${cs}px, ${cs}px ${cs}px` : "", bg.kind === "image" ? "100% 100%" : ""].filter(Boolean).join(", ") || undefined,
    ...(quarter ? { transform: "rotateX(58deg) rotateZ(45deg)", transformOrigin: "center", margin: "10% auto" } : {}),
    ...PIXELATED,
  };

  const order = [...board.items].sort((p, q) => config.layers.findIndex((l) => l.id === p.layer) - config.layers.findIndex((l) => l.id === q.layer) || p.z - q.z);
  const zBtn = (label: string, move: ZMove) => (
    <button key={move} className={BTN} disabled={!selected || !canEdit || selected.fixed} type="button" onClick={() => selected && commit(moveZ(board, selected.id, move))}>
      {label}
    </button>
  );

  return (
    <div className="min-w-0 space-y-3" data-layout-editor onKeyDown={onKey}>
      <section className="fx-panel min-w-0 space-y-2 p-3" data-layout-head>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="fx-label">배치</h2>
          <span data-layout-version>{version ? `${version}판` : "저장된 판 없음"}</span>
          {dirty ? <span className="fx-st fx-st-warn" data-layout-dirty>저장 안 한 변경</span> : null}
          <span className="text-xs fx-muted">
            {SHAPE_LABELS[config.shape]} · {config.cols}×{config.rows}칸 · 칸 {config.cell}px · {FORMAT_LABELS[config.format]}
          </span>
        </div>
        {notice ? <p className="text-sm" data-layout-notice role="status">{notice}</p> : null}
        {!canEdit ? <p className="text-xs fx-muted">읽기 전용이에요. 편집은 관리자만 해요.</p> : null}
      </section>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[14rem_minmax(0,1fr)_16rem]">
        <section className="fx-panel min-w-0 space-y-2 p-3" data-layout-palette>
          <h3 className="fx-label">승인 그림 ({data.palette.length})</h3>
          {canEdit ? <p className="text-xs fx-muted">끌어다 놓거나, 그림을 누른 뒤 맵을 눌러요.</p> : null}
          <ul className="grid max-h-80 grid-cols-3 gap-1 overflow-auto">
            {data.palette.map((a) => (
              <li key={a.id}>
                <button
                  aria-pressed={picked?.id === a.id}
                  className={`w-full rounded border p-1 ${picked?.id === a.id ? "border-default-700" : "border-default-300"}`}
                  data-layout-art={a.id}
                  draggable={canEdit}
                  title={`${a.subject} (${a.kind})`}
                  type="button"
                  onClick={() => canEdit && setPicked(picked?.id === a.id ? null : a)}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", a.id)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt={a.subject} className="mx-auto h-10 w-10 object-contain" src={a.url} style={PIXELATED} onLoad={(e) => setSizes((s) => ({ ...s, [a.id]: { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight } }))} />
                  <span className="block truncate text-[10px]">{a.subject}</span>
                </button>
              </li>
            ))}
          </ul>
          {!data.palette.length ? <p className="text-xs fx-muted">놓을 수 있는 승인 그림이 없어요{config.allowedKinds.length ? ` (종류: ${config.allowedKinds.join(", ")})` : ""}. 이름으로 놓을 수는 있어요.</p> : null}
          {canEdit ? (
            <div className="flex gap-1" data-layout-name-add>
              <input aria-label="이름으로 놓기" className={FIELD} placeholder="이름으로 놓기" type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
              <button className={BTN} disabled={!nameInput.trim()} type="button" onClick={() => { add({ name: nameInput }); setNameInput(""); }}>
                놓기
              </button>
            </div>
          ) : null}
        </section>

        <section className="fx-panel min-w-0 space-y-2 p-3" data-layout-canvas>
          <div className="flex flex-wrap items-center gap-2" data-layout-toolbar>
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="층">
              {config.layers.map((l) => (
                <span key={l.id} className="flex items-center gap-1 rounded border border-default-300 px-1">
                  <input aria-label={`${l.name} 보이기`} checked={!hidden.includes(l.id)} type="checkbox" onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((x) => x !== l.id) : [...h, l.id]))} />
                  <button aria-selected={l.id === layer} className={`px-1 text-sm ${l.id === layer ? "font-bold underline" : ""}`} data-layout-layer={l.id} role="tab" type="button" onClick={() => setLayer(l.id)}>
                    {l.name}
                  </button>
                </span>
              ))}
            </div>
            <button className={BTN} disabled={!canEdit || !hist.past.length} type="button" onClick={() => setHist(undo)}>되돌리기</button>
            <button className={BTN} disabled={!canEdit || !hist.future.length} type="button" onClick={() => setHist(redo)}>다시</button>
            <label className="flex items-center gap-1 text-sm">
              <input checked={snap && config.shape !== "free"} disabled={config.shape === "free"} type="checkbox" onChange={(e) => setSnap(e.target.checked)} />
              칸 맞춤
            </label>
            <button className={BTN} type="button" onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.25) * 100) / 100))}>−</button>
            <span className="text-xs">{Math.round(zoom * 100)}%</span>
            <button className={BTN} type="button" onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))}>+</button>
            {config.shape === "iso" ? (
              <label className="flex items-center gap-1 text-sm">
                <input checked={quarter} type="checkbox" onChange={(e) => setQuarter(e.target.checked)} />
                쿼터뷰 미리보기(보기만)
              </label>
            ) : null}
          </div>
          <div className="max-h-[70vh] overflow-auto rounded border border-default-300 bg-default-100 p-2" tabIndex={0}>
            <div
              ref={mapRef}
              className="relative"
              data-layout-map
              style={mapStyle}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onPointerDown={onMapDown}
            >
              {order.map((it) => {
                if (hidden.includes(it.layer)) return null;
                const f = footprint(it);
                const art = artOf(it);
                const dragging = drag?.id === it.id;
                const x = dragging ? drag!.x : it.x;
                const y = dragging ? drag!.y : it.y;
                const layerIdx = config.layers.findIndex((l) => l.id === it.layer);
                const active = it.layer === layer;

                return (
                  <div
                    key={it.id}
                    className={`absolute ${it.id === sel ? "outline outline-2 outline-blue-500" : overlaps.has(it.id) ? "outline outline-2 outline-red-500" : "outline outline-1 outline-black/20"}`}
                    data-layout-item={it.id}
                    data-layout-item-name={it.name}
                    style={{ left: x * cs, top: y * cs, width: f.w * cs, height: f.h * cs, zIndex: layerIdx * 1000 + it.z + 500, opacity: active ? 1 : 0.55, cursor: canEdit && active && !it.fixed ? "move" : "default", touchAction: "none" }}
                    onPointerDown={(e) => onItemDown(e, it)}
                    onPointerMove={onItemMove}
                    onPointerUp={onItemUp}
                  >
                    <div style={{ position: "absolute", left: "50%", top: "50%", width: it.w * cs, height: it.h * cs, transform: `translate(-50%, -50%) rotate(${it.rot}deg) scaleX(${it.flip ? -1 : 1})` }}>
                      {art ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={it.name} className="h-full w-full" draggable={false} src={art.url} style={{ objectFit: "contain", ...PIXELATED }} />
                      ) : (
                        <div className="grid h-full w-full place-items-center overflow-hidden border border-dashed border-default-500 bg-white/70 text-[10px] leading-tight">{it.name}</div>
                      )}
                    </div>
                    {it.fixed ? <span className="absolute right-0 top-0 text-[10px]" title="잠금">🔒</span> : null}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-xs fx-muted">
            {board.items.length}개 · 빨간 테두리 = 같은 층에서 겹침{hidden.length ? ` · 숨긴 층 ${hidden.length}개` : ""}
          </p>
        </section>

        <section className="fx-panel min-w-0 space-y-2 p-3" data-layout-props>
          <h3 className="fx-label">선택한 항목</h3>
          {selected ? (
            <div className="space-y-2 text-sm" data-layout-selected={selected.id}>
              <label className="block">
                <span className="fx-label">이름</span>
                <input key={`${selected.id}-${selected.name}`} className={FIELD} defaultValue={selected.name} disabled={!canEdit || selected.fixed} type="text" onBlur={(e) => e.target.value.trim() !== selected.name && commit(renameItem(board, selected.id, e.target.value))} />
              </label>
              <label className="block">
                <span className="fx-label">층</span>
                <select className={FIELD} disabled={!canEdit || selected.fixed} value={selected.layer} onChange={(e) => commit(setItemLayer(board, config, selected.id, e.target.value))}>
                  {config.layers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="fx-muted">
                위치 {selected.x}, {selected.y} · 크기 {selected.w}×{selected.h}칸 · 회전 {selected.rot}° {selected.flip ? "· 뒤집힘" : ""}
              </p>
              <div className="flex flex-wrap gap-1">
                <button className={BTN} disabled={!canEdit || selected.fixed} type="button" onClick={() => commit(rotateItem(board, selected.id))}>회전</button>
                <button className={BTN} disabled={!canEdit || selected.fixed} type="button" onClick={() => commit(flipItem(board, selected.id))}>뒤집기</button>
                <button className={BTN} disabled={!canEdit} type="button" onClick={() => commit(lockItem(board, selected.id, !selected.fixed))}>{selected.fixed ? "잠금 풀기" : "잠그기"}</button>
                <button className={BTN} disabled={!canEdit || selected.fixed} type="button" onClick={() => { commit(removeItem(board, selected.id)); setSel(null); }}>지우기</button>
              </div>
              <div className="flex flex-wrap gap-1" aria-label="겹침 순서">
                {zBtn("맨 위", "front")}
                {zBtn("위로", "forward")}
                {zBtn("아래로", "backward")}
                {zBtn("맨 아래", "back")}
              </div>
            </div>
          ) : (
            <p className="text-xs fx-muted">맵에서 항목을 눌러 고르세요. 방향키로 옮기고, R 은 회전, Delete 는 지우기, Ctrl+Z 는 되돌리기예요.</p>
          )}
        </section>
      </div>

      <section className="fx-panel min-w-0 space-y-2 p-3" data-layout-save>
        <h3 className="fx-label">저장 · 내보내기</h3>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-sm">
              <span className="fx-label">저장 메모(선택)</span>
              <input className={FIELD} maxLength={200} type="text" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="rounded bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50" data-layout-save-btn disabled={busy || !dirty} type="button" onClick={() => void save()}>
              {version ? `${version + 1}판으로 저장` : "첫 판으로 저장"}
            </button>
            <button className={BTN} data-layout-export-btn disabled={busy || dirty || !version || config.dest.kind === "none"} type="button" onClick={() => void act({ action: "export", version })}>
              {version}판 내보내기
            </button>
          </div>
        ) : null}
        <p className="text-xs fx-muted" data-layout-export-info>
          내보낼 곳: {config.dest.kind === "folder" ? `앱 폴더 ${config.dest.path} (앱 수정 일감 1건)` : config.dest.kind === "service" ? `서비스 API ${config.dest.path}` : "정해지지 않음(연결 설정)"} · 형식 {config.schema} · {exportPreview.count}개{dirty ? " · 저장한 뒤에 내보내요" : ""}
        </p>
        {exportPreview.warnings.length ? (
          <ul className="list-disc pl-5 text-xs fx-muted" data-layout-export-warnings>
            {exportPreview.warnings.slice(0, 6).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {canEdit ? (
        <section className="fx-panel min-w-0 space-y-2 p-3" data-layout-import>
          <h3 className="fx-label">기존 배치 불러오기</h3>
          <p className="text-xs fx-muted">{version ? "불러오면 새 판으로 저장돼요(이전 판은 이력에 남아요)." : "처음이라면 서비스의 기존 배치를 불러와 첫 판으로 저장해 두세요."} 서비스 쪽은 읽기만 해요.</p>
          <div className="flex flex-wrap gap-2">
            {config.importPath ? (
              <button className={BTN} data-layout-import-service disabled={busy || dirty} type="button" onClick={() => void act({ action: "import", fromService: true, baseVersion: version })}>
                서비스에서 불러오기 ({config.importPath})
              </button>
            ) : null}
          </div>
          <textarea aria-label="배치 JSON" className={`${FIELD} h-20 font-mono text-xs`} placeholder="배치 JSON 을 붙여 넣어도 돼요(hub_layout.json 같은 파일 내용)" value={importText} onChange={(e) => setImportText(e.target.value)} />
          <button
            className={BTN}
            data-layout-import-json
            disabled={busy || dirty || !importText.trim()}
            type="button"
            onClick={() => {
              try {
                void act({ action: "import", json: JSON.parse(importText), baseVersion: version });
              } catch {
                setNotice("붙여 넣은 내용이 JSON 이 아니에요.");
              }
            }}
          >
            붙여 넣은 JSON 을 새 판으로 저장
          </button>
          {dirty ? <p className="text-xs fx-muted">저장 안 한 변경이 있어서 불러오기는 잠겼어요. 먼저 저장하거나 되돌려 주세요.</p> : null}
        </section>
      ) : null}

      <section className="fx-panel min-w-0 space-y-2 p-3" data-layout-history>
        <h3 className="fx-label">판 이력 ({data.history.length})</h3>
        {!data.history.length ? <p className="text-xs fx-muted">아직 저장한 판이 없어요.</p> : null}
        <ul className="space-y-1 text-sm">
          {data.history.map((h) => (
            <li key={h.version} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-layout-history-row={h.version}>
              <strong>{h.version}판</strong>
              <span className="fx-muted">
                {when(h.createdAt)} · {SOURCE_LABELS[h.source] ?? h.source}
                {h.who ? ` · ${h.who}` : ""} · {h.itemCount}개{h.note ? ` · ${h.note}` : ""}
              </span>
              {h.exportStatus ? (
                <span className="fx-st fx-st-info" title={h.exportNote}>
                  {EXPORT_LABELS[h.exportStatus] ?? h.exportStatus} → {h.exportDest}
                </span>
              ) : null}
              {canEdit && h.version !== version ? (
                <button
                  className={BTN}
                  disabled={busy || dirty}
                  type="button"
                  onClick={() => window.confirm(`${h.version}판 내용을 새 판으로 다시 저장할까요?`) && void act({ action: "restore", version: h.version, baseVersion: version })}
                >
                  이 판으로 되돌리기
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
