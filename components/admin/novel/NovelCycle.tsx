// components/admin/novel/NovelCycle.tsx
// 통제실 [작품] 탭 → 화 상세 안의 '원고·검수·실행' 영역(7-1, 관리자 전용, 모바일에서도 읽기 편하게).
// 줄 번호 붙은 원고 읽기(글자 크기 조절)·줄을 탭하면 메모(필수/권장)·검수 표(필수가 위)·열린 메모·[검수만]/[메모 반영해 수정]/[처음부터 새로 쓰기](승인 대기→[승인])·
// 진행 로그(15초마다 갱신)·[취소]·하루 비용 한도·[검수만] 자동 승인 설정. API: /api/admin/novel/... (lib/novel/jobStore.ts)
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, CardBody, Chip, Switch, Textarea } from "@heroui/react";

import { JOB_MODE_LABELS, JOB_STATUS_LABELS, VERDICT_LABELS, type JobMode } from "@/lib/novel/jobRules";

const REFRESH_MS = 15_000;
const FONT_KEY = "novel.reader.fontPx";
const FONT_MIN = 13;
const FONT_MAX = 26;

type Color = "default" | "primary" | "secondary" | "success" | "warning" | "danger";

interface Line {
  line: number;
  text: string;
}
interface ReviewItem {
  grade: "필수" | "권장";
  type: string;
  where: string;
  lines: number[];
  text: string;
  fix: string;
}
interface Note {
  id: string;
  line: number | null;
  kind: string;
  text: string;
  createdBy: string;
}
interface Job {
  id: string;
  mode: string;
  status: string;
  requestedBy: string;
  autoApproved: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  verdict: string | null;
  mustCount: number | null;
  recCount: number | null;
  charCount: number | null;
  costUsd: number;
  summary: string | null;
}
interface Cost {
  episodeTotalUsd: number;
  capUsd: number;
  capIsDefault: boolean;
  spentUsd: number;
  over: boolean;
}
interface Draft {
  work: { slug: string; title: string };
  episode: { number: number; title: string | null; status: string; source: string; syncedAt: string | null; chars: number | null };
  totalLines: number;
  lines: Line[];
  review: { verdict: string | null; verdictLabel: string | null; must: number | null; rec: number | null; items: ReviewItem[] } | null;
  notes: Note[];
  jobs: Job[];
  cost: Cost;
}

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const data = await res.json().catch(() => ({}));

    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { message: "서버에 연결하지 못했어요." } };
  }
}

const money = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");

const STATUS_COLOR: Record<string, Color> = { pending_approval: "warning", approved: "primary", running: "secondary", done: "success", failed: "danger", cancelled: "default" };
const OPEN = ["pending_approval", "approved", "running"];

export default function NovelCycle({ slug, epNumber }: { slug: string; epNumber: number }) {
  const [data, setData] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fontPx, setFontPx] = useState(17);
  const [selected, setSelected] = useState<number | null>(null);
  const [noteKind, setNoteKind] = useState<"필수" | "권장">("권장");
  const [noteText, setNoteText] = useState("");
  const [logs, setLogs] = useState<Record<string, string>>({});
  const [showSettings, setShowSettings] = useState(false);
  const [capInput, setCapInput] = useState("");
  const [autoCheck, setAutoCheck] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const base = `/api/admin/novel/works/${slug}/episodes/${epNumber}`;

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(FONT_KEY));

    if (saved >= FONT_MIN && saved <= FONT_MAX) setFontPx(saved);
  }, []);

  const load = useCallback(async () => {
    const r = await call(`${base}/draft?from=1&to=100000`);

    if (r.ok) {
      setData(r.data);
      setMessage((m) => (m === "원고를 읽지 못했어요." ? null : m));
    } else if (r.data?.message) setMessage(r.data.message);
  }, [base]);

  const loadLogs = useCallback(async (jobs: Job[]) => {
    for (const j of jobs.filter((x) => x.status === "running")) {
      const r = await call(`/api/admin/novel/jobs/${j.id}`);

      if (r.ok) setLogs((prev) => ({ ...prev, [j.id]: r.data.job?.logTail ?? "" }));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);

    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (data) loadLogs(data.jobs);
  }, [data, loadLogs]);

  const loadSettings = useCallback(async () => {
    const r = await call("/api/admin/novel/job-settings");

    if (r.ok) {
      setCapInput(String(r.data.capUsd));
      setAutoCheck(!!r.data.autoApproveCheck);
    }
  }, []);

  useEffect(() => {
    if (showSettings) loadSettings();
  }, [showSettings, loadSettings]);

  const changeFont = (d: number) => {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, fontPx + d));

    setFontPx(next);
    window.localStorage.setItem(FONT_KEY, String(next));
  };

  const saveNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    const r = await call(`${base}/notes`, { method: "POST", body: JSON.stringify({ line: selected ?? undefined, kind: noteKind, text: noteText }) });

    setBusy(false);
    setMessage(r.ok ? "메모를 남겼어요." : (r.data.message ?? "메모를 저장하지 못했어요."));
    if (r.ok) {
      setNoteText("");
      setSelected(null);
    }
    await load();
  };

  const removeNote = async (id: string) => {
    if (!window.confirm("이 메모를 지울까요?")) return;
    const r = await call(`${base}/notes?id=${id}`, { method: "DELETE" });

    setMessage(r.ok ? "메모를 지웠어요." : (r.data.message ?? "지우지 못했어요."));
    await load();
  };

  const startJob = async (mode: JobMode) => {
    const openNotes = data?.notes.length ?? 0;
    const text =
      mode === "fresh"
        ? "처음부터 새로 씁니다. 지금 원고는 git 기록에만 남아요. 비용이 꽤 들 수 있어요(승인 대기로 들어가요). 계속할까요?"
        : mode === "revise"
          ? `열린 메모 ${openNotes}건을 반영해 수정합니다(최대 재작성 2회). 승인 대기로 들어가요. 계속할까요?`
          : "검수만 합니다(약 $0.4). 승인 대기로 들어가요. 계속할까요?";

    if (!window.confirm(text)) return;
    setBusy(true);
    const r = await call("/api/admin/novel/jobs", { method: "POST", body: JSON.stringify({ workSlug: slug, episode: epNumber, mode }) });

    setBusy(false);
    setMessage(r.ok ? `${JOB_MODE_LABELS[mode]} 작업을 만들었어요. ${r.data.message ?? ""}` : (r.data.message ?? "작업을 만들지 못했어요."));
    await load();
  };

  const jobAct = async (id: string, action: "approve" | "cancel", force = false) => {
    setBusy(true);
    let r = await call(`/api/admin/novel/jobs/${id}`, { method: "POST", body: JSON.stringify({ action, force }) });

    if (!r.ok && r.data?.overCap && action === "approve") {
      setBusy(false);
      if (!window.confirm(`${r.data.message}\n\n한도를 넘겨서 시작할까요?`)) return;
      setBusy(true);
      r = await call(`/api/admin/novel/jobs/${id}`, { method: "POST", body: JSON.stringify({ action, force: true }) });
    }
    setBusy(false);
    setMessage(r.ok ? (r.data.message ?? "처리했어요.") : (r.data.message ?? "처리하지 못했어요."));
    await load();
  };

  const saveSettings = async (patch: { capUsd?: number; autoApproveCheck?: boolean }) => {
    const r = await call("/api/admin/novel/job-settings", { method: "PUT", body: JSON.stringify(patch) });

    setMessage(r.ok ? "설정을 저장했어요." : (r.data.message ?? "저장하지 못했어요."));
    if (r.ok) {
      setCapInput(String(r.data.capUsd));
      setAutoCheck(!!r.data.autoApproveCheck);
    }
    await load();
  };

  const jumpTo = (line: number) => {
    setSelected(line);
    bodyRef.current?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (!data) return <p className="text-sm text-default-500">{message ?? "원고를 읽는 중…"}</p>;

  const flagged = new Map<number, "필수" | "권장">();

  for (const it of data.review?.items ?? []) for (const l of it.lines) if (flagged.get(l) !== "필수") flagged.set(l, it.grade);
  const notesByLine = new Map<number, Note[]>();

  for (const n of data.notes) if (n.line) notesByLine.set(n.line, [...(notesByLine.get(n.line) ?? []), n]);
  const running = data.jobs.find((j) => j.status === "running");
  const openJobs = data.jobs.filter((j) => OPEN.includes(j.status));
  const hasText = data.lines.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">원고·검수·실행</h3>
            {data.review?.verdict && (
              <Chip color={data.review.verdict === "PASS" ? "success" : data.review.verdict === "FAIL" ? "danger" : "default"} size="sm" variant="flat">
                {VERDICT_LABELS[data.review.verdict] ?? data.review.verdict}
              </Chip>
            )}
            {data.review && (
              <span className="text-xs text-default-500">
                필수 {data.review.must ?? "?"}건 · 권장 {data.review.rec ?? "?"}건
              </span>
            )}
            {data.episode.chars != null && <span className="text-xs text-default-500">{data.episode.chars.toLocaleString("en-US")}자</span>}
            <span className="text-xs text-default-500">
              비용: 이 화 {money(data.cost.episodeTotalUsd)} · 오늘 {money(data.cost.spentUsd)} / 한도 {money(data.cost.capUsd)}
              {data.cost.over ? " (한도 초과)" : ""}
            </span>
          </div>
          {data.episode.source === "published-body" && <p className="text-xs text-default-500">작업 PC 원고가 아직 올라오지 않아 게시용 본문을 보여 줘요.</p>}
          {data.episode.syncedAt && <p className="text-xs text-default-500">작업 PC에서 올린 시각: {when(data.episode.syncedAt)}</p>}
          {message && <p className="text-sm text-default-600">{message}</p>}

          <div className="flex flex-wrap gap-2">
            <Button color="primary" isDisabled={busy || !hasText} variant="flat" onPress={() => startJob("check")}>
              검수만
            </Button>
            <Button color="secondary" isDisabled={busy || !hasText} variant="flat" onPress={() => startJob("revise")}>
              메모 반영해 수정{data.notes.length ? ` (${data.notes.length})` : ""}
            </Button>
            <Button color="warning" isDisabled={busy} variant="flat" onPress={() => startJob("fresh")}>
              처음부터 새로 쓰기
            </Button>
            <Button size="sm" variant="light" onPress={() => setShowSettings((v) => !v)}>
              ⚙ 비용 한도·자동 승인
            </Button>
          </div>
          {showSettings && (
            <div className="space-y-2 rounded-md bg-default-100 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span>하루 비용 한도($)</span>
                <input
                  className="w-24 rounded border border-default-300 bg-transparent px-2 py-1"
                  inputMode="decimal"
                  value={capInput}
                  onChange={(e) => setCapInput(e.target.value)}
                />
                <Button size="sm" variant="flat" onPress={() => saveSettings({ capUsd: Number(capInput) })}>
                  저장
                </Button>
                <span className="text-xs text-default-500">넘으면 새 작업은 승인 대기에 두고, 승인할 때 한 번 더 확인해요. 기본 $8</span>
              </div>
              <Switch isSelected={autoCheck} size="sm" onValueChange={(v) => saveSettings({ autoApproveCheck: v })}>
                [검수만]은 한도 안이면 자동 승인(기본 꺼짐. 수정·새로 쓰기는 늘 직접 승인)
              </Switch>
            </div>
          )}
        </CardBody>
      </Card>

      {data.jobs.length > 0 && (
        <Card>
          <CardBody className="space-y-3">
            <h3 className="font-bold">{openJobs.length ? "현재·최근 작업" : "최근 작업"}</h3>
            {data.jobs.map((j) => (
              <div key={j.id} className="space-y-2 rounded-md border border-default-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip color={STATUS_COLOR[j.status] ?? "default"} size="sm" variant="flat">
                    {JOB_STATUS_LABELS[j.status as keyof typeof JOB_STATUS_LABELS] ?? j.status}
                  </Chip>
                  <span className="font-medium">{JOB_MODE_LABELS[j.mode as JobMode] ?? j.mode}</span>
                  <span className="text-xs text-default-500">
                    {j.requestedBy === "chat" ? "채팅 요청" : "웹"}
                    {j.autoApproved ? " · 자동 승인" : ""} · {when(j.createdAt)}
                  </span>
                  {j.costUsd > 0 && <span className="text-xs text-default-500">{money(j.costUsd)}</span>}
                </div>
                {j.summary && <p className="whitespace-pre-wrap break-words text-sm text-default-700">{j.summary}</p>}
                <div className="flex flex-wrap gap-2">
                  {j.status === "pending_approval" && (
                    <Button color="primary" isDisabled={busy} size="sm" onPress={() => jobAct(j.id, "approve")}>
                      승인
                    </Button>
                  )}
                  {OPEN.includes(j.status) && (
                    <Button color="danger" isDisabled={busy} size="sm" variant="flat" onPress={() => window.confirm("이 작업을 취소할까요?") && jobAct(j.id, "cancel")}>
                      취소
                    </Button>
                  )}
                </div>
                {j.status === "running" && (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-default-100 p-2 text-xs">{logs[j.id] || "로그를 기다리는 중…(15초마다 갱신)"}</pre>
                )}
              </div>
            ))}
            {running && <p className="text-xs text-default-500">실행 중: 앱 일감은 이 작업이 끝날 때까지 기다려요. 최대 40분.</p>}
          </CardBody>
        </Card>
      )}

      {data.review && (
        <Card>
          <CardBody className="space-y-3">
            <h3 className="font-bold">검수 결과</h3>
            {data.review.items.length === 0 && <p className="text-sm text-default-500">지적이 없어요.</p>}
            {data.review.items.map((it, i) => (
              <div key={i} className={`space-y-1 rounded-md border p-3 text-sm ${it.grade === "필수" ? "border-danger-300 bg-danger-50/40 dark:bg-danger-50/10" : "border-default-200"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip color={it.grade === "필수" ? "danger" : "warning"} size="sm" variant="flat">
                    {it.grade}
                  </Chip>
                  {it.type && <span className="text-xs text-default-500">{it.type}</span>}
                  {it.lines.length > 0 ? (
                    <button className="text-xs font-medium text-primary underline" type="button" onClick={() => jumpTo(it.lines[0])}>
                      {it.where}
                    </button>
                  ) : (
                    <span className="text-xs text-default-500">{it.where}</span>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words">{it.text}</p>
                {it.fix && <p className="whitespace-pre-wrap break-words text-xs text-default-500">제안: {it.fix}</p>}
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">열린 메모 {data.notes.length}건</h3>
            <span className="text-xs text-default-500">다음 실행 때 reviews 메모 파일에 이어 붙고, 반영되면 사라져요.</span>
          </div>
          {data.notes.length === 0 && <p className="text-sm text-default-500">원고의 줄을 탭하면 메모를 남길 수 있어요.</p>}
          {data.notes.map((n) => (
            <div key={n.id} className="flex items-start gap-2 text-sm">
              <Chip color={n.kind === "필수" ? "danger" : "warning"} size="sm" variant="flat">
                {n.kind}
              </Chip>
              {n.line ? (
                <button className="shrink-0 text-xs font-medium text-primary underline" type="button" onClick={() => jumpTo(n.line!)}>
                  L{n.line}
                </button>
              ) : null}
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{n.text}</span>
              <span className="shrink-0 text-xs text-default-400">{n.createdBy === "chat" ? "채팅" : ""}</span>
              <Button isIconOnly aria-label="메모 지우기" size="sm" variant="light" onPress={() => removeNote(n.id)}>
                ✕
              </Button>
            </div>
          ))}
          {selected === null && (
            <div className="space-y-2">
              <Textarea label="화 전체에 대한 메모" minRows={2} value={noteText} onValueChange={setNoteText} />
              <div className="flex flex-wrap items-center gap-2">
                <NoteKindPick kind={noteKind} onChange={setNoteKind} />
                <Button color="primary" isDisabled={busy || !noteText.trim()} size="sm" onPress={saveNote}>
                  메모 남기기
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">원고</h3>
            <span className="text-xs text-default-500">{data.totalLines}줄 · 줄을 탭하면 메모</span>
            <div className="ml-auto flex items-center gap-1">
              <Button aria-label="글자 작게" isDisabled={fontPx <= FONT_MIN} size="sm" variant="flat" onPress={() => changeFont(-1)}>
                가-
              </Button>
              <span className="w-10 text-center text-xs text-default-500">{fontPx}px</span>
              <Button aria-label="글자 크게" isDisabled={fontPx >= FONT_MAX} size="sm" variant="flat" onPress={() => changeFont(1)}>
                가+
              </Button>
            </div>
          </div>
          {!hasText && <p className="text-sm text-default-500">아직 원고가 올라오지 않았어요. 작업 PC가 켜져 있으면 곧 올라오고, [처음부터 새로 쓰기]로 새로 쓸 수도 있어요.</p>}
          <div ref={bodyRef} className="select-text" style={{ fontSize: fontPx, lineHeight: 1.75 }}>
            {data.lines.map((l) => {
              const flag = flagged.get(l.line);
              const ns = notesByLine.get(l.line);
              const isSel = selected === l.line;

              if (!l.text.trim()) return <div key={l.line} className="h-3" data-line={l.line} />;

              return (
                <div key={l.line} data-line={l.line}>
                  <button
                    className={`flex w-full gap-2 rounded px-1 text-left hover:bg-default-100 ${isSel ? "bg-primary-50 dark:bg-primary-50/10" : ""} ${flag === "필수" ? "border-l-4 border-danger" : flag === "권장" ? "border-l-4 border-warning" : "border-l-4 border-transparent"}`}
                    type="button"
                    onClick={() => setSelected(isSel ? null : l.line)}
                  >
                    <span className="w-9 shrink-0 select-none pt-[0.2em] text-right text-[0.65em] text-default-400">{l.line}</span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                      {l.text}
                      {ns && <span className="ml-1 text-[0.7em]">📝{ns.length}</span>}
                    </span>
                  </button>
                  {isSel && (
                    <div className="my-2 ml-10 space-y-2 rounded-md border border-primary-200 p-3" style={{ fontSize: 14 }}>
                      <p className="text-xs text-default-500">L{l.line}에 메모</p>
                      <Textarea autoFocus minRows={2} placeholder="이 줄을 어떻게 고치면 좋을지" value={noteText} onValueChange={setNoteText} />
                      <div className="flex flex-wrap items-center gap-2">
                        <NoteKindPick kind={noteKind} onChange={setNoteKind} />
                        <Button color="primary" isDisabled={busy || !noteText.trim()} size="sm" onPress={saveNote}>
                          저장
                        </Button>
                        <Button size="sm" variant="light" onPress={() => setSelected(null)}>
                          닫기
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function NoteKindPick({ kind, onChange }: { kind: "필수" | "권장"; onChange: (k: "필수" | "권장") => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="메모 종류">
      {(["필수", "권장"] as const).map((k) => (
        <Button key={k} color={k === "필수" ? "danger" : "warning"} size="sm" variant={kind === k ? "solid" : "flat"} onPress={() => onChange(k)}>
          {k}
        </Button>
      ))}
    </div>
  );
}
