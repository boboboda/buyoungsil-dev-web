// components/studio/ConfigDetail.tsx
// [구성] 블록 그림 오른쪽 패널: 눌러 둔 블록의 상세. 카드 = 옵션·참고 규칙·이력, 도구 = 설명서 입력 항목과 한계, 방법 = 키 상태(이름과 등록 여부만)·한계·비용.
"use client";

import { useEffect, useState } from "react";

import type { CardHistoryItem, CardView } from "@/lib/factory/cardsDb";
import { limitLines, type ToolManifestView } from "@/lib/factory/toolManifest";
import type { StudioProjectData } from "@/lib/studio/data";
import type { CardUsage } from "@/lib/studio/dashboard";

const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")}(UTC)`;

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-2 text-sm">
      <dt className="fx-muted">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function CardDetail({ card, usage, canEdit, appSlug, onEdit, onToggle, busy }: { card: CardView; usage?: CardUsage; canEdit: boolean; appSlug: string; onEdit: () => void; onToggle: () => void; busy: boolean }) {
  const [history, setHistory] = useState<CardHistoryItem[] | null>(null);

  useEffect(() => {
    let alive = true;

    setHistory(null);
    if (!canEdit) return; // 이력 API 는 관리자만
    fetch(`/api/admin/factory/cards?appSlug=${encodeURIComponent(appSlug)}&cardId=${encodeURIComponent(card.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { history?: CardHistoryItem[] } | null) => alive && setHistory(d?.history ?? []))
      .catch(() => alive && setHistory([]));

    return () => {
      alive = false;
    };
  }, [appSlug, card.id, card.version, canEdit]);
  const options = Object.entries(card.options);

  return (
    <div className="space-y-2" data-detail="card">
      <h3 className="font-semibold">{card.name}</h3>
      {card.description ? <p className="text-sm fx-muted">{card.description}</p> : null}
      <dl className="space-y-1">
        <Row k="판">
          {card.version} · {when(card.updatedAt)} · {card.updatedBy}
        </Row>
        <Row k="도구·방법">
          {card.tool} · {card.method || "설정의 기본 방식"}
        </Row>
        <Row k="상태">{card.enabled ? "사용 중" : "꺼짐"}</Row>
        <Row k="옵션">{options.length ? options.map(([k, v]) => `${k}=${v}`).join(", ") : "기본값"}</Row>
        <Row k="참고 규칙">
          {[
            card.refRules.pinDefault ? (card.pinnedArt ? `기본 그림 고정(${card.pinnedArt.subject})` : "기본 그림 고정(그림 없음)") : "기본 그림 고정 안 함",
            card.refRules.sameSubject ? "같은 대상" : null,
            card.refRules.sameKind ? "같은 종류" : null,
            card.refRules.maxRefs === null ? "최대 장 수는 설정을 따름" : `최대 ${card.refRules.maxRefs}장`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Row>
        {usage ? (
          <Row k="최근 30일">
            {usage.recent}장 생성{usage.cost ? ` · PixelLab ${usage.cost}회` : ""}
          </Row>
        ) : null}
      </dl>
      {card.secrets.length ? (
        <p className="text-sm" data-detail-secrets>
          <span className="fx-muted">필요한 키:</span> {card.secrets.map((s) => `${s.name} (${s.ready ? "등록됨" : "없음"})`).join(", ")}
        </p>
      ) : null}
      {card.warnings.length ? (
        <ul className="space-y-1 text-sm" data-detail-warnings>
          {card.warnings.map((w) => (
            <li key={w} className="fx-warn">
              ▲ {w}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <button className="fx-btn fx-btn-sm" data-card-edit disabled={busy} type="button" onClick={onEdit}>
            [고치기]
          </button>
          <button className="fx-btn fx-btn-sm" data-card-toggle disabled={busy} type="button" onClick={onToggle}>
            {card.enabled ? "[끄기]" : "[켜기]"}
          </button>
        </div>
      ) : null}
      <details data-detail-history>
        <summary className="cursor-pointer text-sm fx-muted">변경 이력{history ? ` (${history.length})` : ""}</summary>
        {!canEdit ? <p className="mt-1 text-sm fx-muted">이력은 관리자 로그인에서만 보여요.</p> : null}
        {canEdit && !history ? <p className="mt-1 text-sm fx-muted">불러오는 중…</p> : null}
        <ul className="mt-1 space-y-1 text-sm">
          {(history ?? []).map((h) => (
            <li key={h.version} className="min-w-0 break-words fx-muted">
              판 {h.version} · {when(h.createdAt)} · <strong>{h.source}</strong>
              {h.who ? ` (${h.who})` : ""} · {h.changed.length ? h.changed.join("·") : "처음"}
              {h.note ? ` — ${h.note}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function ToolDetail({ tool, commit }: { tool: ToolManifestView | undefined; commit: string }) {
  if (!tool) {
    return (
      <p className="text-sm fx-warn" data-detail="tool">
        ▲ 도구 설명서에 이 도구가 없어요(감독 프로그램이 아직 설명서를 보고하지 않았을 수 있어요).
      </p>
    );
  }

  return (
    <div className="space-y-2" data-detail="tool">
      <h3 className="font-semibold">
        {tool.label} <span className="text-sm fx-muted font-mono">{tool.name}</span>
      </h3>
      {tool.description ? <p className="text-sm fx-muted">{tool.description}</p> : null}
      <dl className="space-y-1">
        <Row k="설명서 출처">
          <span className={tool.source === "file" ? "fx-ok" : "fx-warn"}>{tool.source}</span>
          {tool.source === "fallback" ? " (파일이 없어 기본 설명서를 씀)" : ""}
        </Row>
        <Row k="설명서 판">{tool.version}</Row>
        <Row k="툴킷 판">{commit || "미확인"}</Row>
        <Row k="결과">{tool.outputs.formats.length ? tool.outputs.formats.join(", ") : "—"}</Row>
      </dl>
      <div>
        <h4 className="fx-label">입력 항목</h4>
        <ul className="mt-1 space-y-1 text-sm" data-detail-inputs>
          {tool.inputs.map((i) => (
            <li key={i.name} className="min-w-0 break-words">
              <span className="font-mono">{i.name}</span>{" "}
              <span className="fx-muted">
                ({i.type}
                {i.required ? ", 필수" : ""}
                {i.range ? `, ${i.range.min ?? ""}~${i.range.max ?? ""}` : ""}
                {i.choices ? `, ${i.choices.join("/")}` : ""})
              </span>
              {i.description ? <span className="fx-muted"> — {i.description}</span> : null}
            </li>
          ))}
          {!tool.inputs.length ? <li className="fx-muted">입력 항목 정보가 없어요.</li> : null}
        </ul>
      </div>
      <div>
        <h4 className="fx-label">한계 (방법별)</h4>
        <ul className="mt-1 space-y-1 text-sm" data-detail-limits>
          {tool.methods.map((m) => (
            <li key={m.id} className="min-w-0 break-words">
              <span className="font-semibold">{m.label}</span> <span className="fx-muted">{limitLines(m).join(" · ") || "한계 정보 없음"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MethodDetail({ tool, methodId }: { tool: ToolManifestView | undefined; methodId: string }) {
  const m = tool?.methods.find((x) => x.id.toLowerCase() === methodId.toLowerCase());

  if (!m) {
    return (
      <p className="text-sm fx-muted" data-detail="method">
        {methodId ? "설명서에 없는 방법이에요." : "방법을 정하지 않아 프로젝트 도구 설정의 기본 방식을 따라요. 필요한 키도 그 방식을 따라요."}
      </p>
    );
  }

  return (
    <div className="space-y-2" data-detail="method">
      <h3 className="font-semibold">
        {m.label} <span className="text-sm fx-muted font-mono">{m.id}</span>
      </h3>
      <dl className="space-y-1">
        <Row k="필요한 키">
          {m.secretStates.length ? (
            <span data-detail-secrets>
              {m.secretStates.map((s) => (
                <span key={s.name} className="mr-2 inline-block">
                  <span className="font-mono">{s.name}</span> <span className={s.ready ? "fx-ok" : "fx-warn"}>{s.ready ? "등록됨" : "없음"}</span>
                </span>
              ))}
            </span>
          ) : (
            "필요 없음"
          )}
        </Row>
        <Row k="네트워크">{m.network ? "필요" : "필요 없음"}</Row>
        <Row k="한계">{limitLines(m).join(" · ") || "정보 없음"}</Row>
        {m.cost ? <Row k="비용">{`${m.cost.unit}${m.cost.perCall !== undefined ? ` · 호출당 ${m.cost.perCall}` : ""}${m.cost.note ? ` (${m.cost.note})` : ""}`}</Row> : null}
        {m.notes ? <Row k="메모">{m.notes}</Row> : null}
      </dl>
      <p className="text-xs fx-muted">키 값은 이 화면에 나오지 않아요. 등록은 통제실의 키 관리에서 해요.</p>
    </div>
  );
}

function ProjectDetail({ data }: { data: StudioProjectData }) {
  const l = data.link;

  return (
    <div className="space-y-2" data-detail="project">
      <h3 className="font-semibold">{data.title}</h3>
      <dl className="space-y-1">
        <Row k="분류">{data.kindLabel}</Row>
        <Row k="카드">
          {data.cards.length}장 (켜짐 {data.cards.filter((c) => c.enabled).length})
        </Row>
        <Row k="검수 대기">{data.pendingReview}장</Row>
        <Row k="내보낼 곳">{l?.exportKind === "folder" ? `앱 폴더 ${l.exportPath ?? ""}` : l?.exportKind === "upload" ? "서비스 업로드" : "정하지 않음"}</Row>
        <Row k="스튜디오 기능">
          배치 {l?.studioBatch ? "켜짐" : "꺼짐"} · 서비스 운영 {l?.studioService ? "켜짐" : "꺼짐"}
        </Row>
        {l?.deployServer ? (
          <Row k="배포">
            {l.deployServer}
            {l.domain ? ` · ${l.domain}` : ""}
          </Row>
        ) : null}
      </dl>
      {l?.warnings.length ? (
        <ul className="space-y-1 text-sm">
          {l.warnings.map((w) => (
            <li key={w.text} className="fx-warn">
              ▲ {w.text}
            </li>
          ))}
        </ul>
      ) : null}
      {data.studioUrl ? (
        <a className="text-sm underline" href={data.studioUrl} rel="noreferrer" target="_blank">
          기존 스튜디오 열기 ↗
        </a>
      ) : null}
    </div>
  );
}

export default function ConfigDetail({
  data,
  selected,
  canEdit,
  usage,
  busy,
  onEdit,
  onToggle,
}: {
  data: StudioProjectData;
  selected: string | null;
  canEdit: boolean;
  usage: ReadonlyMap<string, CardUsage>;
  busy: boolean;
  onEdit: (c: CardView) => void;
  onToggle: (c: CardView) => void;
}) {
  const manifest = data.manifest;
  let body: React.ReactNode = <p className="text-sm fx-muted">블록을 누르면 상세가 여기에 나와요.</p>;

  if (selected?.startsWith("project:")) body = <ProjectDetail data={data} />;
  else if (selected?.startsWith("card:")) {
    const card = data.cards.find((c) => `card:${c.id}` === selected);

    body = card ? <CardDetail appSlug={data.appSlug} busy={busy} canEdit={canEdit} card={card} usage={usage.get(card.id)} onEdit={() => onEdit(card)} onToggle={() => onToggle(card)} /> : null;
  } else if (selected?.startsWith("tool:")) body = <ToolDetail commit={manifest.commit} tool={manifest.tools.find((t) => `tool:${t.name}` === selected)} />;
  else if (selected?.startsWith("method:")) {
    const [, toolName, methodId] = selected.split(":");

    body = <MethodDetail methodId={methodId === "default" ? "" : methodId} tool={manifest.tools.find((t) => t.name === toolName)} />;
  }

  return (
    <aside aria-label="블록 상세" className="fx-panel min-w-0 space-y-2 p-3" data-config-detail>
      <h2 className="fx-label">상세</h2>
      {body}
    </aside>
  );
}
