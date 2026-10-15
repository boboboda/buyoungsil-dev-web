// components/admin/factory/CommandPalette.tsx
// 명령 팔레트(5-3): ⌘K / Ctrl+K. 통제실과 스튜디오(관리자일 때)에서 열린다.
// 검색: 앱·일감·정비·카드·템플릿·설정 항목·탭. 바로 실행: "한 컷 싹이 단독 짤 2장"(카드로 생성), "감독 상태", "지금 업데이트", "<앱> 스튜디오 열기".
// 위험한 동작(배포·되돌리기·재시작)은 확인 창을 한 번 더 띄운다(항목의 confirm 글). 항목 만들기·검색·명령 풀이는 lib/factory/palette.ts.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { paletteResults, PALETTE_GROUP_ORDER, supervisorSummary, type PaletteAction, type PaletteData, type PaletteItem } from "@/lib/factory/palette";

interface Loaded {
  items: PaletteItem[];
  apps: PaletteData["apps"];
  cards: PaletteData["cards"];
}

async function runAction(action: PaletteAction): Promise<string> {
  if (action.type === "supervisor") {
    if (action.op === "status") {
      const res = await fetch("/api/admin/factory/control", { cache: "no-store" });

      return res.ok ? supervisorSummary((await res.json()) as Record<string, unknown>) : "감독 상태를 읽지 못했어요.";
    }
    const body = action.op === "update_now" ? { updateNow: true } : action.op === "restart" ? { restart: true } : { enabled: action.op === "resume" };
    const res = await fetch("/api/admin/factory/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { message?: string };

    return data.message ?? (res.ok ? "요청했어요." : "요청하지 못했어요.");
  }
  if (action.type === "generate") {
    const res = await fetch("/api/admin/factory/tool-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", appSlug: action.appSlug, card: action.card, subject: action.subject, count: action.count }) });
    const data = (await res.json().catch(() => ({}))) as { message?: string };

    return data.message ?? (res.ok ? "도구 일감을 등록했어요." : "등록하지 못했어요.");
  }

  return "";
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  const [confirming, setConfirming] = useState<PaletteItem | null>(null);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [mac, setMac] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setConfirming(null);
    setResult("");
    setError("");
    setTimeout(() => input.current?.focus(), 0);
    let cancelled = false;

    fetch("/api/admin/factory/palette", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("load");
        if (!cancelled) setData((await res.json()) as Loaded);
      })
      .catch(() => {
        if (!cancelled) setError("검색 자료를 읽지 못했어요. 명령과 탭은 그대로 쓸 수 있어요.");
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const results = useMemo(() => paletteResults(data?.items ?? [], query, { apps: data?.apps ?? [], cards: data?.cards ?? [] }), [data, query]);

  useEffect(() => setActive(0), [query]);

  const execute = useCallback(
    async (item: PaletteItem) => {
      setConfirming(null);
      if (item.action.type === "navigate") {
        setOpen(false);
        router.push(item.action.href);

        return;
      }
      setBusy(true);
      setResult("");
      try {
        setResult(await runAction(item.action));
      } catch {
        setResult("서버에 연결하지 못했어요.");
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const choose = (item: PaletteItem) => {
    if (item.confirm) setConfirming(item);
    else void execute(item);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (confirming) setConfirming(null);
      else setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && !confirming && results[active] && !busy) {
      e.preventDefault();
      choose(results[active]);
    }
  };

  let lastGroup = "";

  return (
    <>
      <button aria-label="명령 팔레트 열기" className="fixed bottom-3 right-3 z-40 rounded-full border border-default-300 bg-content1 px-3 py-1.5 text-xs shadow" data-palette-open type="button" onClick={() => setOpen(true)}>
        {mac ? "⌘K" : "Ctrl+K"} 검색·명령
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-3 pt-[10vh]" data-palette role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div aria-label="명령 팔레트" aria-modal="true" className="fx-panel flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-default-300 bg-content1 shadow-xl" role="dialog">
            <input
              ref={input}
              aria-controls="palette-list"
              aria-label="검색 또는 명령"
              className="w-full border-b border-default-200 bg-transparent px-4 py-3 text-base outline-none"
              data-palette-input
              placeholder="앱·일감·카드·설정 검색, 또는 명령 (예: 감독 상태, 한 컷 싹이 단독 짤 2장)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
            />
            {confirming ? (
              <div className="space-y-3 p-4" data-palette-confirm role="alertdialog">
                <p className="text-sm font-semibold">{confirming.label}</p>
                <p className="text-sm">{confirming.confirm}</p>
                <div className="flex gap-2">
                  <button className="rounded bg-danger px-3 py-1.5 text-sm text-white" data-palette-confirm-yes type="button" onClick={() => void execute(confirming)}>
                    확인
                  </button>
                  <button className="rounded border border-default-300 px-3 py-1.5 text-sm" data-palette-confirm-no type="button" onClick={() => setConfirming(null)}>
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto py-1" id="palette-list" role="listbox">
                {results.length === 0 ? <li className="px-4 py-3 text-sm text-default-500">{data || error ? "맞는 항목이 없어요." : "불러오는 중…"}</li> : null}
                {results.map((item, i) => {
                  const header = item.group !== lastGroup ? item.group : "";

                  lastGroup = item.group;

                  return (
                    <li key={item.id} role="presentation">
                      {header && PALETTE_GROUP_ORDER.includes(item.group) ? <div className="px-4 pt-2 text-xs font-semibold text-default-500">{header}</div> : null}
                      <button
                        aria-selected={i === active}
                        className={`flex w-full flex-col items-start px-4 py-2 text-left text-sm ${i === active ? "bg-default-100" : ""}`}
                        data-palette-item={item.id}
                        role="option"
                        type="button"
                        onClick={() => choose(item)}
                        onMouseEnter={() => setActive(i)}
                      >
                        <span>{item.label}{item.confirm ? " ⚠" : ""}</span>
                        {item.hint ? <span className="text-xs text-default-500">{item.hint}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {error ? <p className="border-t border-default-200 px-4 py-2 text-xs text-warning-700">{error}</p> : null}
            {result || busy ? (
              <p className="border-t border-default-200 px-4 py-2 text-sm" data-palette-result role="status">
                {busy ? "처리하는 중…" : result}
              </p>
            ) : null}
            <p className="border-t border-default-200 px-4 py-1.5 text-xs text-default-500">↑↓ 고르기 · Enter 실행 · Esc 닫기 · 배포·되돌리기·재시작은 확인 창이 한 번 더 떠요</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
