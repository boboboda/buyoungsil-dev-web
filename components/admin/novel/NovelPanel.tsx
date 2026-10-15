// components/admin/novel/NovelPanel.tsx
// 통제실 [작품] 탭(?tab=novels): 소설 공장. 작품 목록(일시정지·승인 방식·발행 속도), 설정 승인, 화 목록, 화 상세(읽기·승인·수정 요청·보류 해제),
// 대기 화 일괄 승인, 화별 지표(최근 30일). API 는 /api/admin/novel/... (lib/novel/)
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, Chip, Switch, Textarea } from "@heroui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import NovelCycle from "@/components/admin/novel/NovelCycle";
import {
  APPROVAL_MODES,
  APPROVAL_MODE_LABELS,
  EPISODE_STATUS_LABELS,
  type EpisodeStatus,
  WORK_STATUS_LABELS,
  type WorkStatus,
} from "@/lib/novel/rules";

const REFRESH_MS = 15_000; // 10초 이상
const PER_DAY_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24];

type Color =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger";

interface WorkRow {
  slug: string;
  title: string;
  genre: string | null;
  status: WorkStatus;
  paused: boolean;
  approvalMode: string;
  publishPerDay: number;
  written: number;
  published: number;
  counts: Record<string, number>;
  latest: { number: number; status: string } | null;
}

interface EpisodeRow {
  number: number;
  title: string | null;
  status: string;
  attempts: number;
  revisionNote: string | null;
  publishAt: string | null;
  published: boolean;
  checkPass: boolean | null;
  tokenTotal: number;
}

interface WorkDetail {
  slug: string;
  title: string;
  genre: string | null;
  logline: string | null;
  setupSummary: string | null;
  status: WorkStatus;
  episodes: EpisodeRow[];
}

interface Metrics {
  available: boolean;
  rows: { ep: number; view: number; complete: number; next: number }[];
}

interface EpisodeDetail {
  work: { slug: string; title: string; approvalMode: string };
  episode: {
    number: number;
    title: string | null;
    body: string | null;
    summary: string | null;
    status: string;
    attempts: number;
    checkResult: {
      pass: boolean;
      issues: { type: string; detail: string }[];
    } | null;
    tokens: Record<string, { model: string; in: number; out: number }> | null;
    revisionNote: string | null;
    publishAt: string | null;
    published: boolean;
  };
  logs: { level: string; message: string; at: string }[];
  pendingCount: number;
}

const ISSUE_LABELS: Record<string, string> = {
  consistency: "설정 충돌",
  voice: "문체",
  foreshadow: "떡밥",
  quality: "품질",
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

// 상태 칩: 승인 대기·보류는 사람 차례(노랑·빨강), 예약·공개는 초록
function epChip(e: { status: string; published?: boolean }): {
  label: string;
  color: Color;
} {
  if (e.status === "approved")
    return e.published
      ? { label: "공개", color: "success" }
      : { label: "예약", color: "primary" };
  const label = EPISODE_STATUS_LABELS[e.status as EpisodeStatus] ?? e.status;

  if (e.status === "pending_approval") return { label, color: "warning" };
  if (e.status === "held") return { label, color: "danger" };
  if (e.status === "revising") return { label, color: "secondary" };

  return { label, color: "default" };
}

async function call(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const data = await res.json().catch(() => ({}));

    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { message: "서버에 연결하지 못했어요." } };
  }
}

export default function NovelPanel() {
  const [works, setWorks] = useState<WorkRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [epNumber, setEpNumber] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadWorks = useCallback(async () => {
    const r = await call("/api/admin/novel/works");

    if (r.ok) {
      setWorks(r.data.works);
      setError(null);
    } else setError(r.data.message ?? "작품 목록을 읽지 못했어요.");
  }, []);

  useEffect(() => {
    loadWorks();
    const t = setInterval(loadWorks, REFRESH_MS);

    return () => clearInterval(t);
  }, [loadWorks]);

  const patch = async (s: string, body: Record<string, unknown>) => {
    const r = await call(`/api/admin/novel/works/${s}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    setNotice(r.ok ? null : (r.data.message ?? "바꾸지 못했어요."));
    await loadWorks();
  };

  if (slug && epNumber) {
    return (
      <EpisodeView
        epNumber={epNumber}
        slug={slug}
        onBack={() => setEpNumber(null)}
        onChanged={loadWorks}
      />
    );
  }

  if (slug) {
    return (
      <WorkView
        slug={slug}
        onBack={() => {
          setSlug(null);
          loadWorks();
        }}
        onOpenEpisode={setEpNumber}
      />
    );
  }

  return (
    <div className="space-y-4">
      {notice && <p className="text-sm text-danger-500">{notice}</p>}
      {error && <p className="text-sm text-danger-500">{error}</p>}
      {!works && !error && <p className="text-sm text-default-500">읽는 중…</p>}
      {works && works.length === 0 && (
        <Card>
          <CardBody>
            <p className="text-sm text-default-500">
              작품이 없어요. PC의 글 제작 실행기가 설정을 보고하면 여기에 «설정
              승인 대기»로 나타나요.
            </p>
          </CardBody>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {works?.map((w) => (
          <Card key={w.slug}>
            <CardBody className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <button
                  className="min-w-0 text-left"
                  type="button"
                  onClick={() => setSlug(w.slug)}
                >
                  <div className="truncate text-lg font-semibold hover:underline">
                    {w.title}
                  </div>
                  <div className="text-xs text-default-500">
                    {w.slug}
                    {w.genre ? ` · ${w.genre}` : ""}
                  </div>
                </button>
                <Chip
                  className="shrink-0"
                  color={
                    w.status === "setup"
                      ? "warning"
                      : w.status === "active"
                        ? "primary"
                        : "default"
                  }
                  size="sm"
                  variant="flat"
                >
                  {WORK_STATUS_LABELS[w.status] ?? w.status}
                </Chip>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span>
                  쓴 화 <b>{w.written}</b> / 공개 <b>{w.published}</b>
                </span>
                {w.latest && (
                  <span className="flex items-center gap-1">
                    최근 {w.latest.number}화
                    <Chip
                      color={epChip(w.latest).color}
                      size="sm"
                      variant="flat"
                    >
                      {epChip(w.latest).label}
                    </Chip>
                  </span>
                )}
                {(w.counts.pending_approval ?? 0) > 0 && (
                  <span className="text-warning-600">
                    승인 대기 {w.counts.pending_approval}
                  </span>
                )}
                {(w.counts.held ?? 0) > 0 && (
                  <span className="text-danger-500">보류 {w.counts.held}</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Switch
                  isSelected={w.paused}
                  size="sm"
                  onValueChange={(v) => patch(w.slug, { paused: v })}
                >
                  일시정지
                </Switch>
                <label className="flex items-center gap-1">
                  <span className="text-default-500">승인</span>
                  <select
                    className="rounded-md border border-default-200 bg-transparent px-2 py-1 text-sm"
                    value={w.approvalMode}
                    onChange={(e) =>
                      patch(w.slug, { approvalMode: e.target.value })
                    }
                  >
                    {APPROVAL_MODES.map((m) => (
                      <option key={m} value={m}>
                        {APPROVAL_MODE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-default-500">하루</span>
                  <select
                    className="rounded-md border border-default-200 bg-transparent px-2 py-1 text-sm"
                    value={w.publishPerDay}
                    onChange={(e) =>
                      patch(w.slug, { publishPerDay: Number(e.target.value) })
                    }
                  >
                    {[...new Set([...PER_DAY_OPTIONS, w.publishPerDay])]
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <option key={n} value={n}>
                          {n}화
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              <Button size="sm" variant="flat" onPress={() => setSlug(w.slug)}>
                {w.status === "setup" ? "설정 읽고 승인하기" : "화 목록 보기"}
              </Button>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

function WorkView({
  slug,
  onBack,
  onOpenEpisode,
}: {
  slug: string;
  onBack: () => void;
  onOpenEpisode: (n: number) => void;
}) {
  const [work, setWork] = useState<WorkDetail | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await call(`/api/admin/novel/works/${slug}`);

    if (r.ok) {
      setWork(r.data.work);
      setMetrics(r.data.metrics);
    } else setMessage(r.data.message ?? "작품을 읽지 못했어요.");
  }, [slug]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);

    return () => clearInterval(t);
  }, [load]);

  const act = async (path: string, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    const r = await call(`/api/admin/novel/works/${slug}/${path}`, {
      method: "POST",
      body: "{}",
    });

    setBusy(false);
    setMessage(
      r.ok
        ? r.data.numbers
          ? `${r.data.numbers.join(", ")}화를 승인했어요.`
          : "처리했어요."
        : (r.data.message ?? "처리하지 못했어요."),
    );
    await load();
  };

  const pending =
    work?.episodes.filter((e) => e.status === "pending_approval").length ?? 0;
  const metricsByEp = new Map(metrics?.rows.map((r) => [r.ep, r]) ?? []);

  return (
    <div className="space-y-4">
      <Button size="sm" variant="light" onPress={onBack}>
        ← 작품 목록
      </Button>
      {message && <p className="text-sm text-default-600">{message}</p>}
      {!work && !message && (
        <p className="text-sm text-default-500">읽는 중…</p>
      )}
      {work && (
        <>
          <Card>
            <CardBody className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold">{work.title}</h2>
                <Chip size="sm" variant="flat">
                  {WORK_STATUS_LABELS[work.status] ?? work.status}
                </Chip>
                {work.status !== "setup" && (
                  <a
                    className="text-xs text-primary hover:underline"
                    href={`/novel/${work.slug}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    공개 페이지 ↗
                  </a>
                )}
              </div>
              {work.logline && (
                <p className="text-sm text-default-600">{work.logline}</p>
              )}
              {work.status === "setup" && (
                <>
                  <div className="prose prose-sm max-h-[32rem] max-w-none overflow-y-auto rounded-lg border border-default-200 p-4 dark:prose-invert">
                    {work.setupSummary ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {work.setupSummary}
                      </ReactMarkdown>
                    ) : (
                      <p>설정 요약이 아직 없어요.</p>
                    )}
                  </div>
                  <Button
                    color="primary"
                    isDisabled={busy}
                    onPress={() =>
                      act(
                        "setup-approve",
                        `「${work.title}」의 설정을 승인할까요?\n승인하면 실행기가 화 집필을 시작해요.`,
                      )
                    }
                  >
                    설정 승인
                  </Button>
                </>
              )}
              {work.status !== "setup" && work.setupSummary && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-default-500">
                    설정 요약 보기
                  </summary>
                  <div className="prose prose-sm mt-2 max-h-96 max-w-none overflow-y-auto rounded-lg border border-default-200 p-3 dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {work.setupSummary}
                    </ReactMarkdown>
                  </div>
                </details>
              )}
            </CardBody>
          </Card>

          {work.status !== "setup" && (
            <Card>
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">
                    화 목록 ({work.episodes.length})
                  </div>
                  {pending > 0 && (
                    <Button
                      color="warning"
                      isDisabled={busy}
                      size="sm"
                      variant="flat"
                      onPress={() =>
                        act(
                          "approve-pending",
                          `승인 대기 화를 번호 순으로 최대 5화까지 한 번에 승인할까요?\n(대기 ${pending}화)`,
                        )
                      }
                    >
                      대기 화 일괄 승인 ({Math.min(5, pending)})
                    </Button>
                  )}
                </div>
                {work.episodes.length === 0 && (
                  <p className="text-sm text-default-500">
                    아직 쓴 화가 없어요.
                  </p>
                )}
                <div className="divide-y divide-default-100">
                  {work.episodes.map((e) => {
                    const chip = epChip(e);
                    const m = metricsByEp.get(e.number);

                    return (
                      <button
                        key={e.number}
                        className="flex w-full flex-col gap-1 py-2 text-left text-sm hover:bg-default-50 sm:flex-row sm:items-center sm:justify-between"
                        type="button"
                        onClick={() => onOpenEpisode(e.number)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 font-mono text-default-500">
                            {e.number}화
                          </span>
                          <span className="min-w-0 truncate">
                            {e.title ?? "(제목 없음)"}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-default-500">
                          <Chip color={chip.color} size="sm" variant="flat">
                            {chip.label}
                          </Chip>
                          {e.checkPass !== null && (
                            <span>
                              {e.checkPass ? "검수 통과" : "검수 지적"}
                            </span>
                          )}
                          {e.tokenTotal > 0 && (
                            <span>토큰 {e.tokenTotal.toLocaleString()}</span>
                          )}
                          {e.status === "approved" && (
                            <span>
                              {e.published ? "공개" : "예약"}{" "}
                              {when(e.publishAt)}
                            </span>
                          )}
                          {m && <span>조회 {m.view}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardBody>
            </Card>
          )}

          {work.status !== "setup" && (
            <Card>
              <CardBody className="space-y-2">
                <div className="font-semibold">지표 (최근 30일)</div>
                {!metrics || !metrics.available || metrics.rows.length === 0 ? (
                  <p className="text-sm text-default-500">데이터 없음</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-default-500">
                        <tr>
                          <th className="py-1 pr-3">화</th>
                          <th className="py-1 pr-3 text-right">조회</th>
                          <th className="py-1 pr-3 text-right">끝까지 읽음</th>
                          <th className="py-1 text-right">다음 화 이동</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.rows.map((r) => (
                          <tr
                            key={r.ep}
                            className="border-t border-default-100"
                          >
                            <td className="py-1 pr-3">{r.ep}화</td>
                            <td className="py-1 pr-3 text-right">{r.view}</td>
                            <td className="py-1 pr-3 text-right">
                              {r.complete}
                              {r.view > 0 && (
                                <span className="text-xs text-default-400">
                                  {" "}
                                  ({Math.round((r.complete / r.view) * 100)}%)
                                </span>
                              )}
                            </td>
                            <td className="py-1 text-right">{r.next}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function EpisodeView({
  slug,
  epNumber,
  onBack,
  onChanged,
}: {
  slug: string;
  epNumber: number;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<EpisodeDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/admin/novel/works/${slug}`;

  const load = useCallback(async () => {
    const r = await call(`${base}/episodes/${epNumber}`);

    if (r.ok) setData(r.data);
    else setMessage(r.data.message ?? "화를 읽지 못했어요.");
  }, [base, epNumber]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);

    return () => clearInterval(t);
  }, [load]);

  const act = async (
    path: string,
    body: Record<string, unknown>,
    okText: string,
    confirmText?: string,
  ) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    const r = await call(`${base}/${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    setBusy(false);
    setMessage(r.ok ? okText : (r.data.message ?? "처리하지 못했어요."));
    if (r.ok) setNote("");
    await load();
    onChanged();
  };

  const ep = data?.episode;
  const chip = ep ? epChip(ep) : null;
  const tokens = ep?.tokens ? Object.entries(ep.tokens) : [];

  return (
    <div className="space-y-4">
      <Button size="sm" variant="light" onPress={onBack}>
        ← 화 목록
      </Button>
      {message && <p className="text-sm text-default-600">{message}</p>}
      {!data && !message && (
        <p className="text-sm text-default-500">읽는 중…</p>
      )}
      {data && ep && chip && (
        <>
          <Card>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-default-500">{data.work.title}</span>
                <h2 className="text-xl font-bold">
                  {ep.number}화{ep.title ? ` ${ep.title}` : ""}
                </h2>
                <Chip color={chip.color} size="sm" variant="flat">
                  {chip.label}
                </Chip>
                {ep.attempts > 0 && (
                  <span className="text-xs text-default-500">
                    시도 {ep.attempts}회
                  </span>
                )}
                {ep.status === "approved" && (
                  <span className="text-xs text-default-500">
                    {ep.published ? "공개" : "예약"} {when(ep.publishAt)}
                  </span>
                )}
              </div>
              {ep.revisionNote && (
                <p className="rounded-md bg-secondary-50 p-2 text-sm text-secondary-700 dark:bg-secondary-50/10">
                  수정 요청 메모: {ep.revisionNote}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {ep.status === "pending_approval" && (
                  <Button
                    color="primary"
                    isDisabled={busy}
                    onPress={() =>
                      act(
                        `episodes/${ep.number}/approve`,
                        {},
                        "승인했어요. 예약 시각에 공개돼요.",
                        `${ep.number}화를 승인할까요?`,
                      )
                    }
                  >
                    승인
                  </Button>
                )}
                {data.pendingCount > 0 && (
                  <Button
                    color="warning"
                    isDisabled={busy}
                    variant="flat"
                    onPress={() =>
                      act(
                        "approve-pending",
                        {},
                        "대기 화를 일괄 승인했어요.",
                        `승인 대기 화를 번호 순으로 최대 5화 승인할까요?\n(대기 ${data.pendingCount}화)`,
                      )
                    }
                  >
                    대기 화 일괄 승인 ({Math.min(5, data.pendingCount)})
                  </Button>
                )}
              </div>

              {(ep.status === "pending_approval" || ep.status === "held") && (
                <div className="space-y-2">
                  <Textarea
                    maxLength={2000}
                    minRows={2}
                    placeholder={
                      ep.status === "held"
                        ? "보류 해제 메모(선택): 어떻게 다시 쓸지"
                        : "수정 요청 메모(필수): 무엇을 고칠지"
                    }
                    value={note}
                    onValueChange={setNote}
                  />
                  {ep.status === "pending_approval" ? (
                    <Button
                      isDisabled={busy || !note.trim()}
                      variant="flat"
                      onPress={() =>
                        act(
                          `episodes/${ep.number}/revise`,
                          { note },
                          "수정 요청을 보냈어요. 실행기가 다시 써요.",
                        )
                      }
                    >
                      수정 요청
                    </Button>
                  ) : (
                    <Button
                      isDisabled={busy}
                      variant="flat"
                      onPress={() =>
                        act(
                          `episodes/${ep.number}/release-hold`,
                          { note },
                          "보류를 해제했어요. 실행기가 다시 써요.",
                        )
                      }
                    >
                      보류 해제
                    </Button>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          <NovelCycle epNumber={epNumber} slug={slug} />

          <Card>
            <CardBody>
              {ep.body ? (
                <article className="mx-auto max-w-2xl whitespace-pre-wrap break-words text-base leading-8">
                  {ep.body}
                </article>
              ) : (
                <p className="text-sm text-default-500">본문이 아직 없어요.</p>
              )}
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardBody className="space-y-2 text-sm">
                <div className="font-semibold">요약</div>
                <p className="whitespace-pre-wrap break-words text-default-600">
                  {ep.summary || "없음"}
                </p>
                <div className="pt-2 font-semibold">
                  검수{" "}
                  {ep.checkResult
                    ? ep.checkResult.pass
                      ? "통과"
                      : "지적 있음"
                    : "결과 없음"}
                </div>
                {ep.checkResult?.issues.length ? (
                  <ul className="space-y-1">
                    {ep.checkResult.issues.map((i, n) => (
                      <li key={n} className="break-words">
                        <Chip className="mr-1" size="sm" variant="flat">
                          {ISSUE_LABELS[i.type] ?? i.type}
                        </Chip>
                        {i.detail}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="pt-2 font-semibold">역할별 토큰</div>
                {tokens.length ? (
                  <table className="w-full text-xs">
                    <tbody>
                      {tokens.map(([role, t]) => (
                        <tr key={role} className="border-t border-default-100">
                          <td className="py-1 pr-2">{role}</td>
                          <td className="py-1 pr-2 text-default-500">
                            {t.model}
                          </td>
                          <td className="py-1 text-right">
                            {t.in.toLocaleString()} / {t.out.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-default-500">없음</p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-1 text-xs">
                <div className="text-sm font-semibold">진행 로그</div>
                {data.logs.length === 0 && (
                  <p className="text-default-500">없음</p>
                )}
                <div className="max-h-80 space-y-1 overflow-y-auto">
                  {data.logs.map((l, n) => (
                    <div
                      key={n}
                      className={`break-words ${l.level === "error" ? "text-danger-500" : l.level === "warn" ? "text-warning-600" : "text-default-600"}`}
                    >
                      <span className="mr-1 text-default-400">
                        {when(l.at)}
                      </span>
                      {l.message}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
