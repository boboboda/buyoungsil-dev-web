"use client";

// 통제실 [스튜디오] 카드 패널 아래 "카드로 바로 만들기"(2-3): AI 없이 카드로 도구 일감을 보내고, 자동 승인·동시 실행·비용 한도 설정과 최근 도구 일감을 본다.
// 승인 규칙은 앱 일감과 같다(설정 '비용 한도 안이면 자동 승인'을 켠 경우만 자동). 키 값은 어디에도 없다.
import { useCallback, useEffect, useState } from "react";

import type { CardView } from "@/lib/factory/cardsDb";
import type { ToolJobInput, ToolResult, ToolSettings } from "@/lib/factory/toolJobs";

interface JobRow {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  failReason: string | null;
  input: ToolJobInput | null;
  result: ToolResult | null;
}
interface Snap {
  settings: ToolSettings;
  usage: { day: number; month: number };
  jobs: JobRow[];
  message?: string;
}

const FIELD = "mt-1 w-full min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm";
const STATUS: Record<string, string> = { pending: "승인 대기", approved: "대기열", running: "만드는 중", needs_confirmation: "확인 필요(비용 한도)", done: "완료", failed: "실패", cancelled: "취소" };

export default function ToolJobsPanel({ appSlug, cards }: { appSlug: string; cards: CardView[] }) {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [card, setCard] = useState("");
  const [subject, setSubject] = useState("");
  const [count, setCount] = useState("2");
  const [extra, setExtra] = useState("");
  const enabled = cards.filter((c) => c.enabled);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/factory/tool-jobs?appSlug=${encodeURIComponent(appSlug)}`);

    if (r.ok) setSnap((await r.json()) as Snap);
  }, [appSlug]);

  useEffect(() => {
    setSnap(null);
    void load().catch(() => {});
    const t = setInterval(() => void load().catch(() => {}), 10_000);

    return () => clearInterval(t);
  }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/admin/factory/tool-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appSlug, ...body }) });
      const d = (await r.json().catch(() => ({}))) as Snap;

      setNotice(d.message ?? (r.ok ? "처리했어요." : "처리하지 못했어요."));
      if (r.ok && d.settings) setSnap(d);
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  const s = snap?.settings;
  const save = (patch: Partial<ToolSettings>) => post({ action: "settings", settings: patch });

  return (
    <section className="space-y-3 rounded-lg border border-default-200 p-3" data-tool-jobs={appSlug}>
      <h4 className="font-semibold">카드로 바로 만들기 (AI 없이)</h4>
      <p className="text-xs fx-muted">감독 프로그램이 카드의 도구·방법·옵션을 그대로 실행하고, 만든 그림을 그림 저장소에 후보로 올려요. 앱 폴더는 열지 않아요.</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="text-sm">
          카드
          <select className={FIELD} data-tool-field="card" value={card} onChange={(e) => setCard(e.target.value)}>
            <option value="">고르기</option>
            {enabled.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (판 {c.version})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          대상 (쉼표로 여러 개)
          <input className={FIELD} data-tool-field="subject" placeholder="예: 싹이" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="text-sm">
          장 수 (대상마다)
          <input className={FIELD} data-tool-field="count" max={8} min={1} type="number" value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        <label className="text-sm sm:col-span-4">
          추가 지시 (선택)
          <input className={FIELD} data-tool-field="extra" maxLength={500} type="text" value={extra} onChange={(e) => setExtra(e.target.value)} />
        </label>
      </div>
      <button
        className="rounded bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50"
        data-tool-create
        disabled={busy || !card || !subject.trim()}
        type="button"
        onClick={() => post({ action: "create", card, subjects: subject.split(",").map((x) => x.trim()).filter(Boolean), count: Number(count) || 1, extra })}
      >
        일감 보내기
      </button>

      {s ? (
        <fieldset className="space-y-2 rounded border border-default-200 p-2" data-tool-settings>
          <legend className="px-1 text-sm font-semibold">도구 일감 설정</legend>
          <label className="flex items-center gap-2 text-sm">
            <input checked={s.autoApprove} data-tool-setting="autoApprove" disabled={busy} type="checkbox" onChange={(e) => void save({ autoApprove: e.target.checked })} />
            비용 한도 안이면 자동 승인 (끄면 늘 승인 대기)
          </label>
          <div className="grid gap-2 sm:grid-cols-4">
            {(
              [
                ["autoApproveMaxCost", "자동 승인 상한(한 일감 호출 수)"],
                ["concurrency", "동시 실행 수(1~4)"],
                ["dailyLimit", "하루 한도(호출 수, 0=제한 없음)"],
                ["monthlyLimit", "한 달 한도(호출 수, 0=제한 없음)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-sm">
                {label}
                <input className={FIELD} data-tool-setting={key} defaultValue={s[key]} disabled={busy} type="number" onBlur={(e) => Number(e.target.value) !== s[key] && void save({ [key]: Number(e.target.value) })} />
              </label>
            ))}
          </div>
          <p className="text-xs fx-muted">
            오늘 {snap?.usage.day ?? 0}회 · 이번 달 {snap?.usage.month ?? 0}회 사용(PixelLab 호출 수, 진행 중 일감은 예상 비용). 한도를 넘는 일감은 확인 대기로 멈추고 통제실 할 일과 텔레그램으로 알려요.
          </p>
        </fieldset>
      ) : null}

      {snap?.jobs.length ? (
        <ul className="space-y-1 text-sm" data-tool-job-list>
          {snap.jobs.map((j) => (
            <li key={j.id} className="rounded border border-default-200 px-2 py-1" data-tool-job={j.id}>
              <span className="font-medium">{j.title}</span> · {STATUS[j.status] ?? j.status}
              {j.result ? ` · 비용 ${j.result.cost}회 · 그림 ${j.result.arts.length}장` : j.input ? ` · 예상 비용 ${j.input.estimatedCost}회` : ""}
              {j.failReason && j.status !== "done" ? <span className="block text-xs fx-muted">{j.failReason.slice(0, 200)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {notice ? (
        <p className="text-sm fx-muted" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
