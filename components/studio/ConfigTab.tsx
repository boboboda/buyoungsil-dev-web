// components/studio/ConfigTab.tsx
// /studio/<앱> 의 [구성] 탭: 대시보드 · 블록 그림(프로젝트 → 카드 → 도구 → 방법)과 상세 패널 · 카드 만들기·고치기·끄기 · 키 상태 · 사용량 요약.
// 자료는 서버가 props 로 준다(lib/studio/data.ts). 카드를 저장하면 router.refresh() 로 다시 받는다. 관리자가 아니면(접근 키) 읽기 전용: 고치기 버튼과 이력이 없다.
// 키는 이름과 등록 여부만 나온다(값은 이 화면에 오지 않는다).
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { CardView } from "@/lib/factory/cardsDb";
import { buildBlockGraph, keyBadge, shortDate, USAGE_DAYS, type GraphTool } from "@/lib/studio/dashboard";
import type { StudioProjectData } from "@/lib/studio/data";
import BlockDiagram from "@/components/studio/BlockDiagram";
import CardEditor from "@/components/studio/CardEditor";
import ConfigDetail from "@/components/studio/ConfigDetail";
import ServiceStatusCard from "@/components/studio/ServiceStatus";

export default function ConfigTab({ data, canEdit, initialSelected }: { data: StudioProjectData; canEdit: boolean; initialSelected?: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(initialSelected ?? `project:${data.appSlug}`);
  const [editing, setEditing] = useState<{ card: CardView | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const graphTools: GraphTool[] = useMemo(
    () => data.manifest.tools.map((t) => ({ name: t.name, label: t.label, source: t.source, version: t.version, methods: t.methods.map((m) => ({ id: m.id, label: m.label, secrets: m.secretStates })) })),
    [data.manifest],
  );
  const graph = useMemo(() => {
    const g = buildBlockGraph({
      appSlug: data.appSlug,
      title: data.title,
      kindLabel: data.kindLabel,
      cards: data.cards.map((c) => ({ id: c.id, name: c.name, version: c.version, tool: c.tool, method: c.method, enabled: c.enabled, warnings: c.warnings })),
      tools: graphTools,
      toolkitCommit: data.manifest.commit,
    });

    // 블록마다 최근 7일 요약 한 줄(4-4)
    return data.weekLines ? { ...g, nodes: g.nodes.map((n) => (data.weekLines?.[n.id] ? { ...n, usage: data.weekLines[n.id] } : n)) } : g;
  }, [data, graphTools]);
  const usage = useMemo(() => new Map(data.usage.map((u) => [u.cardId, u])), [data.usage]);

  const warningCount = data.cards.reduce((n, c) => n + c.warnings.length, 0);
  const methodRows = useMemo(() => {
    const seen = new Map<string, { tool: string; method: string; label: string; secrets: { name: string; ready: boolean }[]; known: boolean; cards: string[] }>();

    for (const c of data.cards) {
      const t = data.manifest.tools.find((x) => x.name === c.tool);
      const m = t?.methods.find((x) => x.id.toLowerCase() === c.method.toLowerCase());
      const key = `${c.tool}:${c.method}`;
      const row = seen.get(key) ?? { tool: c.tool, method: c.method, label: m?.label || c.method || "기본 방식", secrets: m?.secretStates ?? c.secrets, known: !!m, cards: [] };

      row.cards.push(c.name);
      seen.set(key, row);
    }

    return [...seen.values()];
  }, [data]);
  const missingKeys = methodRows.filter((r) => r.secrets.some((s) => !s.ready)).length;

  const afterSave = (message: string) => {
    setEditing(null);
    setNotice(message);
    router.refresh();
  };

  const toggle = async (card: CardView) => {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/factory/cards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appSlug: data.appSlug, card: card.id, patch: { enabled: !card.enabled }, note: card.enabled ? "스튜디오 구성에서 끔" : "스튜디오 구성에서 켬" }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; errors?: string[] };

      setNotice(res.ok ? (body.message ?? "저장했어요.") : `${body.message ?? "저장하지 못했어요."}`);
      if (res.ok) router.refresh();
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const tiles: { label: string; value: string; tone?: "warn" | "ok" }[] = [
    { label: "결과물 카드", value: `${data.cards.length}장 (켜짐 ${data.cards.filter((c) => c.enabled).length})` },
    { label: "카드 경고", value: `${warningCount}건`, tone: warningCount ? "warn" : "ok" },
    { label: "키 상태", value: methodRows.length ? (missingKeys ? `없는 키 있음 ${missingKeys}곳` : "모두 등록됨") : "카드 없음", tone: missingKeys ? "warn" : undefined },
    { label: "검수 대기", value: `${data.pendingReview}장`, tone: data.pendingReview ? "warn" : undefined },
    { label: "툴킷 판", value: data.manifest.commit || "미확인", tone: data.manifest.commit ? undefined : "warn" },
  ];

  return (
    <div className="min-w-0 space-y-4" data-config-tab>
      <section aria-label="대시보드" className="fx-panel min-w-0 space-y-2 p-3" data-config-section="dashboard">
        <h2 className="fx-label">대시보드</h2>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="min-w-0 rounded border border-default-300 p-2" data-tile={t.label}>
              <dt className="text-xs fx-muted">{t.label}</dt>
              <dd className={`break-words text-sm font-semibold ${t.tone === "warn" ? "fx-warn" : t.tone === "ok" ? "fx-ok" : ""}`}>{t.value}</dd>
            </div>
          ))}
        </dl>
        {data.service ? (
          <div className="space-y-1" data-config-service>
            <ServiceStatusCard appSlug={data.appSlug} canCheck={canEdit} health={data.service.health} title={`서비스 연결 상태 — ${data.service.name}`} />
            <a className="text-xs underline" href={`/studio/${data.appSlug}?tab=ops&sub=service`}>
              서비스 운영 열기 →
            </a>
          </div>
        ) : null}
        {!canEdit ? <p className="text-xs fx-muted">접근 키로 열었어요. 읽기 전용이라 카드를 고칠 수 없어요(고치려면 관리자 로그인).</p> : null}
      </section>

      <section aria-label="도구 블록 연결" className="min-w-0 space-y-2" data-config-section="blocks">
        <h2 className="fx-label">도구 블록 연결</h2>
        <p className="text-xs fx-muted">프로젝트 → 결과물 카드 → 도구 → 방법. 블록을 누르면 오른쪽(좁은 화면은 아래)에 상세가 나와요.</p>
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="fx-panel min-w-0 p-2">
            {data.cards.length ? <BlockDiagram graph={graph} selected={selected} onSelect={setSelected} /> : <p className="p-2 text-sm fx-muted">아직 카드가 없어요. 아래에서 카드를 만들면 블록이 그려져요.</p>}
          </div>
          <ConfigDetail
            busy={busy}
            canEdit={canEdit}
            data={data}
            selected={selected}
            usage={usage}
            onEdit={(c) => {
              setEditing({ card: c });
              setNotice("");
            }}
            onToggle={(c) => void toggle(c)}
          />
        </div>
      </section>

      <section aria-label="카드 옵션" className="min-w-0 space-y-2" data-config-section="cards">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="fx-label">카드 옵션</h2>
          {canEdit ? (
            <button className="fx-btn fx-btn-sm" data-card-new disabled={busy || !!editing} type="button" onClick={() => setEditing({ card: null })}>
              [+ 새 카드]
            </button>
          ) : null}
        </div>
        {notice ? (
          <p className="text-sm fx-muted" data-config-notice role="status">
            {notice}
          </p>
        ) : null}
        {editing ? <CardEditor key={editing.card?.id ?? "new"} appSlug={data.appSlug} approvedArts={data.approvedArts} card={editing.card} onClose={() => setEditing(null)} onSaved={afterSave} /> : null}
        <ul className="fx-panel min-w-0 divide-y divide-default-300" data-card-list>
          {data.cards.map((c) => (
            <li key={c.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 p-2 text-sm">
              <button className="min-w-0 text-left font-semibold underline-offset-2 hover:underline" type="button" onClick={() => setSelected(`card:${c.id}`)}>
                {c.name}
              </button>
              <span className="fx-muted">
                {c.tool}
                {c.method ? ` · ${c.method}` : ""} · 판 {c.version}
              </span>
              {c.isDefault ? <span className="fx-muted">(기본)</span> : null}
              {!c.enabled ? <span className="fx-muted">(꺼짐)</span> : null}
              {c.warnings.length ? <span className="fx-warn">▲ {c.warnings.length}</span> : null}
            </li>
          ))}
          {!data.cards.length ? <li className="p-2 text-sm fx-muted">아직 카드가 없어요.</li> : null}
        </ul>
      </section>

      <section aria-label="키 상태" className="fx-panel min-w-0 space-y-2 p-3" data-config-section="keys">
        <h2 className="fx-label">키 상태</h2>
        <p className="text-xs fx-muted">카드가 쓰는 방법에 필요한 키의 이름과 등록 여부예요. 값은 보이지 않아요. 등록·바꾸기는 통제실에서 해요.</p>
        <ul className="space-y-1 text-sm" data-key-rows>
          {methodRows.map((r) => {
            const badge = keyBadge(r.secrets);

            return (
              <li key={`${r.tool}:${r.method}`} className="min-w-0 break-words">
                <span className="font-semibold">{r.label}</span> <span className="fx-muted font-mono">{r.tool}</span> — <span className={badge.tone === "ok" ? "fx-ok" : badge.tone === "warn" ? "fx-warn" : "fx-muted"}>{badge.text}</span>
                {r.secrets.length ? <span className="fx-muted"> ({r.secrets.map((s) => `${s.name} ${s.ready ? "등록됨" : "없음"}`).join(", ")})</span> : null}
                <span className="fx-muted"> · 카드 {r.cards.join(", ")}</span>
              </li>
            );
          })}
          {!methodRows.length ? <li className="fx-muted">카드가 없어서 볼 키가 없어요.</li> : null}
        </ul>
      </section>

      <section aria-label="사용량 요약" className="fx-panel min-w-0 space-y-2 p-3" data-config-section="usage">
        <h2 className="fx-label">사용량 요약 (최근 {USAGE_DAYS}일)</h2>
        <p className="text-xs fx-muted">그림 저장소에 올라온 그림 기준이에요. 비용은 그림 요약에 적힌 PixelLab 호출 수의 합이고, 요약이 없는 그림은 0으로 세요.</p>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm" data-usage-table>
            <thead>
              <tr className="text-left fx-muted">
                <th className="py-1 pr-2 font-normal">카드</th>
                <th className="py-1 pr-2 font-normal">생성</th>
                <th className="py-1 pr-2 font-normal">승인</th>
                <th className="py-1 pr-2 font-normal">비용</th>
                <th className="py-1 font-normal">마지막</th>
              </tr>
            </thead>
            <tbody>
              {data.cards.map((c) => {
                const u = usage.get(c.id);

                return (
                  <tr key={c.id} data-usage-row={c.id}>
                    <td className="py-1 pr-2">{c.name}</td>
                    <td className="py-1 pr-2">{u?.recent ?? 0}장</td>
                    <td className="py-1 pr-2">{u?.approved ?? 0}장</td>
                    <td className="py-1 pr-2">{u?.cost ? `${u.cost}회` : "—"}</td>
                    <td className="py-1">{shortDate(u?.lastAt ?? null)}</td>
                  </tr>
                );
              })}
              {!data.cards.length ? (
                <tr>
                  <td className="py-1 fx-muted" colSpan={5}>
                    카드가 없어요.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
