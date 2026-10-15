// components/admin/factory/TemplateSender.tsx
// 통제실 [일감] 탭과 앱별 대기열의 [템플릿으로 보내기](5-3). 템플릿을 고르고 빈칸을 채워 등록한다. 내 템플릿 만들기·지우기도 여기서 한다.
// 기본 템플릿 문구에는 일감 작성 규칙(측정은 실험 일감으로, e2e 는 마지막에 한 번만)이 들어 있다. 빈칸 채우기는 lib/factory/jobTemplates.ts 와 같은 함수를 쓴다.
"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

import AiEngineSelect from "./AiEngineSelect";
import type { TaskAiEngine } from "@/lib/factory/ai";
import { APPROVAL_MODE_LABELS, APPROVAL_MODES, fillTemplate, JOB_WRITING_RULES, TEMPLATE_KIND_LABELS, TEMPLATE_KINDS, type TemplateDef, type TemplateVar } from "@/lib/factory/jobTemplates";

export type TemplateRow = TemplateDef & { vars: TemplateVar[] };

interface Snapshot {
  templates: TemplateRow[];
  apps: { appSlug: string; title: string }[];
  cards: { appSlug: string; name: string }[];
  message?: string;
}

const URL = "/api/admin/factory/templates";
const INPUT = "w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm";

async function call(body: Record<string, unknown>) {
  const res = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Partial<Snapshot> & { message?: string; jobId?: string };

  return { ok: res.ok, data };
}

export function useTemplateSnapshot() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetch(URL, { cache: "no-store" });

      if (res.ok) setSnap((await res.json()) as Snapshot);
    } catch {
      /* 못 읽어도 화면은 그대로 */
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { snap, setSnap, reload };
}

/** 앱별 대기열 안에서 쓰는 접힌 버튼: 누르면 그 앱 고정으로 펼쳐진다 */
export function TemplateSendButton({ appSlug }: { appSlug: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-w-0" data-template-toggle={appSlug}>
      <button aria-expanded={open} className="rounded border border-default-300 px-2 py-0.5 text-xs" type="button" onClick={() => setOpen((v) => !v)}>
        📋 템플릿으로 보내기
      </button>
      {open ? <TemplateSender appSlug={appSlug} compact /> : null}
    </div>
  );
}

export default function TemplateSender({ appSlug, compact = false }: { appSlug?: string; compact?: boolean }) {
  const { snap, setSnap, reload } = useTemplateSnapshot();
  const params = useSearchParams();
  const [tplId, setTplId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [app, setApp] = useState(appSlug ?? "");
  const [priority, setPriority] = useState("");
  const [aiEngine, setAiEngine] = useState<TaskAiEngine>("default");
  const [approve, setApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [manage, setManage] = useState(false);

  const wanted = params?.get("template") ?? "";
  const list = snap?.templates ?? [];
  const tpl = list.find((t) => t.id === tplId) ?? null;

  useEffect(() => {
    if (!list.length) return;
    setTplId((cur) => (list.some((t) => t.id === wanted) && !appSlug ? wanted : list.some((t) => t.id === cur) ? cur : list[0].id));
  }, [list, wanted, appSlug]);

  useEffect(() => {
    if (!appSlug && snap?.apps.length) setApp((cur) => cur || snap.apps[0].appSlug);
  }, [snap, appSlug]);

  const needsApp = !!tpl && tpl.kind !== "lab";
  const filled = tpl ? fillTemplate(tpl.body, values) : null;
  const missing = filled && filled.ok === false ? filled.missing : [];

  const send = async () => {
    if (!tpl) return;
    setBusy(true);
    setNotice(null);
    try {
      const { ok, data } = await call({ action: "enqueue", template: tpl.id, values, appSlug: needsApp ? app : undefined, priority: priority.trim() === "" ? undefined : Number(priority), aiEngine: aiEngine === "default" ? undefined : aiEngine, approve });

      setNotice(data.message ?? (ok ? "보냈어요." : "보내지 못했어요."));
      if (ok) setValues({});
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  const body = (
    <div className="space-y-3">
      {!snap ? (
        <p className="text-sm text-default-500">템플릿을 읽는 중…</p>
      ) : (
        <>
          <select aria-label="템플릿" className={INPUT} data-template-select value={tplId} onChange={(e) => { setTplId(e.target.value); setValues({}); }}>
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                [{TEMPLATE_KIND_LABELS[t.kind]}] {t.name}{t.builtin ? "" : " (내 템플릿)"}
              </option>
            ))}
          </select>
          {tpl ? (
            <>
              {tpl.description ? <p className="text-xs text-default-500">{tpl.description}</p> : null}
              {needsApp && !appSlug ? (
                <select aria-label="앱" className={INPUT} value={app} onChange={(e) => setApp(e.target.value)}>
                  {(snap.apps ?? []).map((a) => (
                    <option key={a.appSlug} value={a.appSlug}>
                      {a.title} ({a.appSlug})
                    </option>
                  ))}
                </select>
              ) : null}
              {tpl.vars.map((v) => (
                <label key={v.name} className="block space-y-1 text-sm">
                  <span className="font-medium">{v.name}{v.fallback === null ? <b className="text-danger"> *</b> : <span className="text-default-500"> (비우면: {v.fallback})</span>}</span>
                  <textarea className={`${INPUT} min-h-[44px]`} data-template-var={v.name} maxLength={2000} value={values[v.name] ?? ""} onChange={(e) => setValues((cur) => ({ ...cur, [v.name]: e.target.value }))} />
                </label>
              ))}
              <details className="text-xs text-default-500">
                <summary className="cursor-pointer">지시문 미리보기</summary>
                <pre className="mt-1 whitespace-pre-wrap" data-template-preview>
                  {filled && filled.ok ? filled.text : tpl.body}
                </pre>
              </details>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1">
                  우선순위
                  <input className="w-20 rounded border border-default-200 bg-transparent px-2 py-1" inputMode="numeric" placeholder={String(tpl.priority)} value={priority} onChange={(e) => setPriority(e.target.value)} />
                </label>
                <span className="text-xs text-default-500">승인 방식: {APPROVAL_MODE_LABELS[tpl.approvalMode]}</span>
                {tpl.requiredSecrets.length ? <span className="text-xs text-default-500">필요한 키: {tpl.requiredSecrets.join(", ")}</span> : null}
              </div>
              <AiEngineSelect allowDefault disabled={busy} value={aiEngine} onChange={setAiEngine} />
              <label className="flex items-center gap-2 text-sm">
                <input checked={approve} type="checkbox" onChange={(e) => setApprove(e.target.checked)} />
                보내면 바로 승인해서 시작하기
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <Button className="min-h-11 sm:min-h-0" color="primary" data-template-send isDisabled={busy || missing.length > 0 || (needsApp && !(appSlug || app))} size="sm" onPress={send}>
                  {busy ? "보내는 중…" : "템플릿으로 보내기"}
                </Button>
                {missing.length ? <span className="text-xs text-default-500">채워야 할 빈칸: {missing.join(", ")}</span> : null}
                {notice ? <span className="text-sm text-default-600" role="status">{notice}</span> : null}
              </div>
            </>
          ) : null}
          {compact ? null : (
            <>
              <button aria-expanded={manage} className="text-xs underline" type="button" onClick={() => setManage((v) => !v)}>
                {manage ? "내 템플릿 관리 닫기" : "내 템플릿 만들기·지우기"}
              </button>
              {manage ? <TemplateManager cards={snap.cards} rows={list} onChange={(s) => { setSnap(s); void reload(); }} /> : null}
            </>
          )}
        </>
      )}
    </div>
  );

  if (compact) return <div className="mt-2 rounded-lg border border-default-200 p-3" data-template-sender>{body}</div>;

  return (
    <Card className="mb-6" id="job-templates">
      <CardHeader className="flex flex-col items-start gap-1">
        <span className="font-semibold">📋 템플릿으로 보내기</span>
        <span className="text-xs text-default-500">자주 쓰는 지시를 고르고 빈칸만 채우세요. 보낸 일감은 평소처럼 승인 대기에 쌓여요(자동 승인 규칙에 맞으면 바로 대기열로).</span>
      </CardHeader>
      <CardBody className="space-y-3" data-template-sender>
        {body}
        <details className="text-xs text-default-500">
          <summary className="cursor-pointer">일감 작성 규칙</summary>
          <pre className="mt-1 whitespace-pre-wrap">{JOB_WRITING_RULES}</pre>
        </details>
      </CardBody>
    </Card>
  );
}

function TemplateManager({ rows, cards, onChange }: { rows: TemplateRow[]; cards: { appSlug: string; name: string }[]; onChange: (s: Snapshot) => void }) {
  const [form, setForm] = useState({ name: "", kind: "revision", body: "", description: "", priority: "0", approvalMode: "default", cardName: "", toolCount: "1", requiredSecrets: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = rows.filter((r) => !r.builtin);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const { ok, data } = await call(body);

      setMsg(data.message ?? (ok ? "저장했어요." : "저장하지 못했어요."));
      if (ok && data.templates) onChange(data as Snapshot);
      return ok;
    } catch {
      setMsg("서버에 연결하지 못했어요.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const ok = await run({ action: "save", template: { ...form, priority: Number(form.priority || 0), toolCount: Number(form.toolCount || 1), requiredSecrets: form.requiredSecrets.split(/[,\s]+/).filter(Boolean) } });

    if (ok) setForm((f) => ({ ...f, name: "", body: "", description: "" }));
  };

  return (
    <div className="space-y-3 rounded-lg border border-default-200 p-3" data-template-manager>
      <p className="text-xs text-default-500">지시문 틀의 빈칸은 {"{{이름}}"}(꼭 채움) 또는 {"{{이름=기본값}}"}(비우면 기본값)으로 적어요. 도구 템플릿은 틀이 「대상」 한 줄이고 카드 이름이 필요해요. 출시 일감은 템플릿으로 만들 수 없어요.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={INPUT} maxLength={40} placeholder="이름" value={form.name} onChange={(e) => set("name", e.target.value)} />
        <select aria-label="종류" className={INPUT} value={form.kind} onChange={(e) => set("kind", e.target.value)}>
          {TEMPLATE_KINDS.map((k) => (
            <option key={k} value={k}>{TEMPLATE_KIND_LABELS[k]}</option>
          ))}
        </select>
      </div>
      <textarea className={`${INPUT} min-h-[96px]`} maxLength={5000} placeholder="지시문 틀. 예: 화면 {{화면}} 의 {{문제}} 를 고쳐 주세요." value={form.body} onChange={(e) => set("body", e.target.value)} />
      <input className={INPUT} maxLength={200} placeholder="설명 (선택)" value={form.description} onChange={(e) => set("description", e.target.value)} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1">우선순위<input className="w-20 rounded border border-default-200 bg-transparent px-2 py-1" value={form.priority} onChange={(e) => set("priority", e.target.value)} /></label>
        <label className="flex items-center gap-1">승인 방식
          <select className="rounded border border-default-200 bg-transparent px-2 py-1" value={form.approvalMode} onChange={(e) => set("approvalMode", e.target.value)}>
            {APPROVAL_MODES.map((m) => (
              <option key={m} value={m}>{APPROVAL_MODE_LABELS[m]}</option>
            ))}
          </select>
        </label>
        <input className="min-w-[10rem] flex-1 rounded border border-default-200 bg-transparent px-2 py-1" placeholder="필요한 키 이름 (쉼표로)" value={form.requiredSecrets} onChange={(e) => set("requiredSecrets", e.target.value)} />
      </div>
      {form.kind === "tool" ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <input className="min-w-[10rem] flex-1 rounded border border-default-200 bg-transparent px-2 py-1" list="template-card-names" placeholder="카드 이름" value={form.cardName} onChange={(e) => set("cardName", e.target.value)} />
          <datalist id="template-card-names">{[...new Set(cards.map((c) => c.name))].map((n) => <option key={n} value={n} />)}</datalist>
          <label className="flex items-center gap-1">장 수<input className="w-16 rounded border border-default-200 bg-transparent px-2 py-1" value={form.toolCount} onChange={(e) => set("toolCount", e.target.value)} /></label>
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <Button color="primary" data-template-save isDisabled={busy || !form.name.trim() || !form.body.trim()} size="sm" onPress={save}>템플릿 저장</Button>
        {msg ? <span className="text-sm text-default-600" role="status">{msg}</span> : null}
      </div>
      {mine.length ? (
        <ul className="space-y-1 text-sm">
          {mine.map((t) => (
            <li key={t.id} className="flex items-center gap-2" data-template-mine={t.id}>
              <span className="min-w-0 flex-1 truncate">[{TEMPLATE_KIND_LABELS[t.kind]}] {t.name}</span>
              <button className="rounded border border-default-300 px-2 text-xs" disabled={busy} type="button" onClick={() => { if (window.confirm(`"${t.name}" 템플릿을 지울까요?`)) void run({ action: "delete", id: t.id }); }}>지우기</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-default-500">아직 내 템플릿이 없어요.</p>
      )}
    </div>
  );
}
