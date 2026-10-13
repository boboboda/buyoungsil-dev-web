// components/admin/factory/FactoryControl.tsx
// 앱 공장 통제실 화면: 지시 목록(5초마다 갱신) + 선택한 지시의 상세. (통제실 [일감] 탭. 토큰 발급·키 이름은 [설정] 탭)
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, CardBody, CardHeader, Chip, Input } from "@heroui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import AiEngineSelect from "./AiEngineSelect";
import ClaudeModelSelect, { ModelTag } from "./ClaudeModelSelect";
import { JobSteps, ProgressBar, StatusDot, jobTone } from "./fx";
import { AI_LABELS, isClaudeModel, type AiEngine, type TaskModel } from "@/lib/factory/ai";
import type { ToolRequestRecord } from "@/lib/factory/toolBroker";

type Status =
  | "pending"
  | "approved"
  | "running"
  | "review"
  | "linkwait"
  | "done"
  | "failed"
  | "cancelled";

interface JobRow {
  id: string;
  appSlug: string;
  title: string;
  kind: string;
  parentJobId: string | null;
  stack: string;
  aiEngine: AiEngine;
  aiModel?: string | null; // Claude Code 모델(승인 때 고름). 없으면 기본 설정
  requiredSecrets: string[];
  priority: number;
  status: Status;
  phase: string | null;
  summary: string | null;
  failReason: string | null;
  attempts: number;
  maxAttempts: number;
  workerId: string | null;
  leaseUntil: string | null;
  source: string | null;
  createdAt: string;
  approvedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  _count: { images: number };
}

interface JobDetail extends JobRow {
  planMarkdown: string;
  images: { id: string; label: string; url: string; createdAt: string }[];
  logs: { id: number; at: string; level: string; message: string }[];
  toolRequests?: ToolRequestRecord[] | null; // 도구 요청 중계 목록(예전 서버면 없음)
}

interface Usage {
  sessions: {
    id: string;
    device: string;
    status: string;
    lastEvent: string | null;
    lastTool: string | null;
    lastEventAt: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreateTokens: number;
    cacheReadTokens: number;
  }[];
  totals: {
    input: number;
    output: number;
    cacheCreate: number;
    cacheRead: number;
  };
}

const STATUS: Record<
  Status,
  {
    label: string;
    color:
      | "warning"
      | "primary"
      | "secondary"
      | "success"
      | "danger"
      | "default";
  }
> = {
  pending: { label: "승인 대기", color: "warning" },
  approved: { label: "승인됨·대기열", color: "warning" },
  running: { label: "제작 중", color: "primary" },
  review: { label: "검토 대기", color: "warning" },
  linkwait: { label: "영상 링크 대기", color: "warning" },
  done: { label: "완료", color: "success" },
  failed: { label: "실패", color: "danger" },
  cancelled: { label: "취소", color: "danger" },
};

const FILTERS: { value: "" | Status; label: string }[] = [
  { value: "", label: "전체" },
  { value: "pending", label: "승인 대기" },
  { value: "approved", label: "대기열" },
  { value: "running", label: "제작 중" },
  { value: "review", label: "검토 대기" },
  { value: "linkwait", label: "영상 링크 대기" },
  { value: "done", label: "완료" },
  { value: "failed", label: "실패" },
  { value: "cancelled", label: "취소" },
];

const REFRESH_MS = 5_000;

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "-";

const hhmmss = (iso: string) =>
  new Date(iso).toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

const num = (n: number) => n.toLocaleString("ko-KR");

async function call<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; data: T & { message?: string } }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const data = await res.json().catch(() => ({}));

    return { ok: res.ok, data };
  } catch {
    return {
      ok: false,
      data: { message: "서버에 연결하지 못했어요." } as T & {
        message?: string;
      },
    };
  }
}

export default function FactoryControl() {
  const [filter, setFilter] = useState<"" | Status>("");
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    job: JobDetail;
    claude: Usage;
  } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    const q = filter ? `?status=${filter}` : "";
    const { ok, data } = await call<{ jobs: JobRow[] }>(
      `/api/admin/factory/jobs${q}`,
    );

    if (ok) {
      setJobs(data.jobs);
      setListError(null);
    } else {
      setListError(
        data.message ??
          "지시 목록을 읽지 못했어요. 마이그레이션(factory_jobs 테이블)이 적용됐는지 확인하세요.",
      );
    }
  }, [filter]);

  const loadDetail = useCallback(async (id: string) => {
    const { ok, data } = await call<{ job: JobDetail; claude: Usage }>(
      `/api/admin/factory/jobs/${id}`,
    );

    if (ok) {
      setDetail({ job: data.job, claude: data.claude });
      setDetailError(null);
    } else {
      setDetailError(data.message ?? "상세를 읽지 못했어요.");
    }
  }, []);

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, REFRESH_MS);

    return () => clearInterval(t);
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);

      return;
    }
    loadDetail(selectedId);
    const t = setInterval(() => loadDetail(selectedId), REFRESH_MS);

    return () => clearInterval(t);
  }, [selectedId, loadDetail]);

  const act = async (
    id: string,
    body: Record<string, unknown>,
    confirmText?: string,
  ) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    const { ok, data } = await call<{ success?: boolean }>(
      `/api/admin/factory/jobs/${id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    setNotice(data.message ?? (ok ? "처리했어요." : "처리하지 못했어요."));
    setBusy(false);
    await Promise.all([loadList(), loadDetail(id)]);
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = {};

    for (const j of jobs ?? []) c[j.status] = (c[j.status] ?? 0) + 1;

    return c;
  }, [jobs]);

  return (
    <div className="space-y-6">
      {notice && (
        <div className="flex items-center justify-between rounded-lg bg-default-100 px-4 py-2 text-sm">
          <span>{notice}</span>
          <button className="text-default-500" onClick={() => setNotice(null)}>
            닫기
          </button>
        </div>
      )}

      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 lg:flex-wrap">
        {FILTERS.map((f) => (
          <Button
            key={f.value || "all"}
            className="shrink-0"
            color={filter === f.value ? "primary" : "default"}
            size="sm"
            variant={filter === f.value ? "solid" : "flat"}
            onPress={() => setFilter(f.value)}
          >
            {f.label}
            {f.value && counts[f.value] ? ` (${counts[f.value]})` : ""}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* 지시 목록 */}
        <div className={`space-y-2 ${selectedId ? "hidden lg:block" : ""}`}>
          {listError && (
            <Card>
              <CardBody>
                <p className="text-sm text-default-500">{listError}</p>
              </CardBody>
            </Card>
          )}
          {!listError && jobs?.length === 0 && (
            <div className="rounded-xl border border-dashed border-default-300 p-10 text-center text-default-500">
              지시가 없어요. Claude 채팅에서 기획서를 등록하면 여기에 나타나요.
            </div>
          )}
          {jobs?.map((j) => (
            <button
              key={j.id}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                selectedId === j.id
                  ? "border-primary bg-primary-50/40"
                  : "border-default-200 bg-content1 hover:bg-default-100"
              }`}
              onClick={() => {
                setSelectedId(j.id);
                window.scrollTo({ top: 0 });
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot tone={jobTone(j.status)} />
                  <span className="truncate font-semibold">{j.title}</span>
                </span>
                <Chip
                  className="shrink-0"
                  color={STATUS[j.status].color}
                  size="sm"
                  variant="flat"
                >
                  {STATUS[j.status].label}
                </Chip>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-default-500">
                <span className="font-mono">{j.appSlug}</span>
                <span>{AI_LABELS[j.aiEngine ?? "claude"]}</span>
                <ModelTag engine={j.aiEngine ?? "claude"} model={j.aiModel} />
                <span>{j.kind === "new" ? "새 앱" : "수정"}</span>
                {j.phase && j.status === "running" && (
                  <span>단계: {j.phase}</span>
                )}
                <span className="font-mono">{when(j.createdAt)}</span>
                {j._count.images > 0 && (
                  <span className="font-mono">이미지 {j._count.images}</span>
                )}
              </div>
              {j.status === "running" && (
                <div className="mt-2">
                  <ProgressBar label={`${j.title} 제작 중`} />
                </div>
              )}
            </button>
          ))}
        </div>

        {/* 상세 */}
        <div>
          {selectedId && (
            <Button
              className="mb-3 lg:hidden"
              size="sm"
              variant="flat"
              onPress={() => setSelectedId(null)}
            >
              ← 목록으로
            </Button>
          )}
          {!selectedId && (
            <div className="hidden rounded-xl border border-dashed border-default-300 p-10 text-center text-default-500 lg:block">
              왼쪽에서 지시를 고르면 기획서와 진행 상황이 보여요.
            </div>
          )}
          {selectedId && detailError && (
            <Card>
              <CardBody>
                <p className="text-sm text-default-500">{detailError}</p>
              </CardBody>
            </Card>
          )}
          {selectedId && detail && detail.job.id === selectedId && (
            <JobDetailView busy={busy} detail={detail} onAct={act} />
          )}
        </div>
      </div>
    </div>
  );
}

function JobDetailView({
  detail,
  busy,
  onAct,
}: {
  detail: { job: JobDetail; claude: Usage };
  busy: boolean;
  onAct: (
    id: string,
    body: Record<string, unknown>,
    confirmText?: string,
  ) => void;
}) {
  const { job, claude } = detail;
  const [showPlan, setShowPlan] = useState(false);
  const [priority, setPriority] = useState(String(job.priority));
  const [aiEngine, setAiEngine] = useState<AiEngine>(job.aiEngine ?? "claude");
  // 승인·다시 시도 때 쓸 Claude Code 모델. 다시 시도는 지난번 모델에서 시작
  const [aiModel, setAiModel] = useState<TaskModel>(isClaudeModel(job.aiModel) ? job.aiModel : "default");
  const editable = job.status === "pending" || job.status === "approved";
  // 감독 프로그램이 도구 중계 결과를 asset-<이름> 으로 올린다. 나머지는 스크린샷
  const assets = job.images.filter((img) => img.label.startsWith("asset-"));
  const shots = job.images.filter((img) => !img.label.startsWith("asset-"));
  const active =
    job.status === "pending" ||
    job.status === "approved" ||
    job.status === "running" ||
    job.status === "review" || // 출시 검토 대기도 취소할 수 있다(결정은 출시 패키지 화면에서)
    job.status === "linkwait";

  useEffect(() => {
    setPriority(String(job.priority));
  }, [job.id, job.priority]);
  useEffect(() => { setAiEngine(job.aiEngine ?? "claude"); }, [job.id, job.aiEngine]);
  useEffect(() => { setAiModel(isClaudeModel(job.aiModel) ? job.aiModel : "default"); }, [job.id, job.aiModel]);
  const modelBody = aiEngine === "claude" ? { aiModel: aiModel === "default" ? null : aiModel } : {};

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2">
        <div className="flex w-full items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold">{job.title}</h2>
            <p className="font-mono text-xs text-default-500">
              {job.appSlug} · {job.kind === "new" ? "새 앱" : "수정 지시"} ·{" "}
              {job.stack} · {AI_LABELS[job.aiEngine ?? "claude"]}
              {(job.aiEngine ?? "claude") === "claude" && <> · <ModelTag engine="claude" model={job.aiModel} /></>}
            </p>
          </div>
          <Chip color={STATUS[job.status].color} variant="flat">
            {STATUS[job.status].label}
          </Chip>
        </div>
        <JobSteps
          approvedAt={job.approvedAt}
          startedAt={job.startedAt}
          status={job.status}
        />
        {job.status === "running" && (
          <div className="w-full">
            <ProgressBar label={`${job.title} 제작 중`} />
          </div>
        )}

        {(editable || job.status === "failed") && (
          <div className="flex flex-wrap items-center gap-2">
            <AiEngineSelect value={aiEngine} onChange={setAiEngine} disabled={busy} />
            <Button size="sm" variant="flat" isDisabled={busy || aiEngine === (job.aiEngine ?? "claude")} onPress={() => onAct(job.id, { action: "set-ai", aiEngine })}>AI 적용</Button>
          </div>
        )}
        {(job.status === "pending" || job.status === "failed") && (
          <ClaudeModelSelect disabled={busy} engine={aiEngine} label={job.status === "failed" ? "다시 시도할 모델" : "승인할 모델"} value={aiModel} onChange={setAiModel} />
        )}
        <div className="flex flex-wrap gap-2">
          {job.status === "pending" && (
            <Button
              className="min-h-11 flex-1 sm:flex-none"
              color="primary"
              isDisabled={busy}
              size="sm"
              onPress={() => onAct(job.id, { action: "approve", aiEngine, ...modelBody })}
            >
              승인
            </Button>
          )}
          {job.status === "failed" && (
            <Button
              className="min-h-11 flex-1 sm:flex-none"
              color="primary"
              isDisabled={busy}
              size="sm"
              onPress={() => onAct(job.id, { action: "retry", aiEngine, ...modelBody })}
            >
              다시 시도
            </Button>
          )}
          {active && (
            <Button
              className="min-h-11 flex-1 sm:flex-none"
              color="danger"
              isDisabled={busy}
              size="sm"
              variant="flat"
              onPress={() =>
                onAct(
                  job.id,
                  { action: "cancel" },
                  job.status === "running"
                    ? "제작 중인 지시를 취소할까요? 감독 프로그램이 다음 보고 때 멈춰요."
                    : "이 지시를 취소할까요?",
                )
              }
            >
              취소
            </Button>
          )}
          {editable && (
            <div className="flex w-full items-center gap-1 sm:w-auto">
              <Input
                className="w-24"
                label="우선순위"
                size="sm"
                type="number"
                value={priority}
                onValueChange={setPriority}
              />
              <Button
                isDisabled={
                  busy ||
                  priority.trim() === "" ||
                  Number(priority) === job.priority
                }
                size="sm"
                variant="flat"
                onPress={() =>
                  onAct(job.id, {
                    action: "set-priority",
                    priority: Number(priority),
                  })
                }
              >
                적용
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardBody className="space-y-5">
        {/* 요약 정보 */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <Info mono label="등록" value={when(job.createdAt)} />
          <Info mono label="승인" value={when(job.approvedAt)} />
          <Info mono label="시작" value={when(job.startedAt)} />
          <Info mono label="끝" value={when(job.finishedAt)} />
          <Info mono label="작업 PC" value={job.workerId ?? "-"} />
          <Info
            mono
            label="시도"
            value={`${job.attempts} / ${job.maxAttempts}`}
          />
          {job.phase && <Info label="현재 단계" value={job.phase} />}
          {job.source && <Info label="등록 경로" value={job.source} />}
          {job.parentJobId && (
            <Info mono label="원본 지시" value={job.parentJobId} />
          )}
        </dl>

        {job.requiredSecrets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="text-default-500">필요한 키:</span>
            {job.requiredSecrets.map((s) => (
              <Chip key={s} className="font-mono" size="sm" variant="flat">
                {s}
              </Chip>
            ))}
          </div>
        )}

        {job.failReason && (
          <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-50/10">
            <b>실패 이유</b>
            <p className="mt-1 whitespace-pre-wrap">{job.failReason}</p>
          </div>
        )}

        {job.summary && (
          <div className="rounded-lg bg-success-50 p-3 text-sm dark:bg-success-50/10">
            <b>결과 요약</b>
            <p className="mt-1 whitespace-pre-wrap">{job.summary}</p>
          </div>
        )}

        {/* 도구 요청 중계 */}
        {Array.isArray(job.toolRequests) && job.toolRequests.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold">도구 요청 <span className="font-mono">({job.toolRequests.length})</span></h3>
            <ul className="space-y-1 text-sm">
              {job.toolRequests.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 break-all">
                  <span className="font-mono text-default-500">{when(t.at)}</span>
                  <code>{t.tool}</code>
                  <Chip
                    color={t.status === "ok" ? "success" : t.status === "denied" ? "warning" : "danger"}
                    size="sm"
                    variant="flat"
                  >
                    {t.status}
                  </Chip>
                  {t.message && t.status !== "ok" && <span className="text-xs text-default-500">{t.message}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 스크린샷 */}
        {shots.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold">스크린샷</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shots.map((img) => (
                <a key={img.id} href={img.url} rel="noreferrer" target="_blank">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={img.label}
                    className="aspect-[9/16] w-full rounded-lg border border-default-200 object-cover"
                    loading="lazy"
                    src={img.url}
                  />
                  <p className="mt-1 truncate text-center text-xs text-default-500">
                    {img.label}
                  </p>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* 도구 중계(toolbroker)가 만든 이미지: label 이 asset- 로 시작 */}
        {assets.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold">도구가 만든 이미지</h3>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {assets.map((img) => (
                <AssetImage key={img.id} label={img.label} url={img.url} />
              ))}
            </div>
          </section>
        )}

        {/* 토큰 */}
        <section>
          <h3 className="mb-2 font-semibold">Claude 사용량</h3>
          {job.aiEngine === "codex" && <p className="mb-2 text-sm text-default-500">아래는 이 앱의 Claude 사용 이력이에요. 현재 Codex 작업의 진행·검증 결과는 진행 로그에서 확인하세요.</p>}
          {claude.sessions.length === 0 ? (
            <p className="text-sm text-default-500">
              아직 이 앱 이름({job.appSlug})으로 들어온 Claude 세션이 없어요.
            </p>
          ) : (
            <>
              <p className="font-mono text-sm">
                입력 {num(claude.totals.input)} · 출력{" "}
                {num(claude.totals.output)} · 캐시 생성{" "}
                {num(claude.totals.cacheCreate)} · 캐시 읽기{" "}
                {num(claude.totals.cacheRead)}
              </p>
              <ul className="mt-2 space-y-1 font-mono text-xs text-default-500">
                {claude.sessions.map((s) => (
                  <li key={s.id}>
                    {s.device} · {s.status}
                    {s.lastTool ? ` · ${s.lastTool}` : ""} ·{" "}
                    {when(s.lastEventAt)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* 로그 */}
        <section>
          <h3 className="mb-2 font-semibold">진행 로그</h3>
          {job.logs.length === 0 ? (
            <p className="text-sm text-default-500">아직 로그가 없어요.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto break-words rounded-lg border border-default-200 bg-background p-3 font-mono text-xs leading-relaxed">
              {job.logs.map((l) => (
                <div
                  key={l.id}
                  className={
                    l.level === "error"
                      ? "text-danger"
                      : l.level === "warn"
                        ? "text-warning"
                        : undefined
                  }
                >
                  <span className="text-default-400">{hhmmss(l.at)}</span>{" "}
                  {l.message}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 기획서 */}
        <section>
          <button
            aria-expanded={showPlan}
            className="font-semibold"
            type="button"
            onClick={() => setShowPlan((v) => !v)}
          >
            {showPlan ? "▾" : "▸"} 기획서 보기
          </button>
          {showPlan && (
            <div className="prose prose-sm mt-2 max-h-[32rem] max-w-none overflow-y-auto rounded-lg border border-default-200 p-4 dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {job.planMarkdown}
              </ReactMarkdown>
            </div>
          )}
        </section>
      </CardBody>
    </Card>
  );
}

// 128px 이하 도트 이미지는 칸에 맞게 확대하고 네모 픽셀이 뭉개지지 않게 pixelated 로 그린다. 누르면 원본(새 탭)
function AssetImage({ label, url }: { label: string; url: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const pixel = size !== null && size.w <= 128 && size.h <= 128;

  return (
    <a href={url} rel="noreferrer" target="_blank">
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-default-200 bg-default-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={label}
          className="h-full w-full object-contain"
          loading="lazy"
          src={url}
          style={pixel ? { imageRendering: "pixelated" } : undefined}
          onLoad={(e) =>
            setSize({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
          }
        />
      </div>
      <p className="mt-1 truncate text-center text-xs text-default-500">
        {label.replace(/^asset-/, "")}
        {size ? ` · ${size.w}×${size.h}` : ""}
      </p>
    </a>
  );
}

function Info({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-default-500">{label}</dt>
      <dd className={`break-all font-medium${mono ? " font-mono" : ""}`}>
        {value}
      </dd>
    </>
  );
}
