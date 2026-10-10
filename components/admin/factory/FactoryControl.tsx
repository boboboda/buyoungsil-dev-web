// components/admin/factory/FactoryControl.tsx
// 앱 공장 통제실 화면: 지시 목록(5초마다 갱신) + 선택한 지시의 상세 + 키 이름 목록.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, CardBody, CardHeader, Chip, Input } from "@heroui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Status =
  | "pending"
  | "approved"
  | "running"
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

interface SecretName {
  name: string;
  description: string;
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
  approved: { label: "승인됨·대기열", color: "primary" },
  running: { label: "제작 중", color: "secondary" },
  done: { label: "완료", color: "success" },
  failed: { label: "실패", color: "danger" },
  cancelled: { label: "취소", color: "default" },
};

const FILTERS: { value: "" | Status; label: string }[] = [
  { value: "", label: "전체" },
  { value: "pending", label: "승인 대기" },
  { value: "approved", label: "대기열" },
  { value: "running", label: "제작 중" },
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
  const [secrets, setSecrets] = useState<SecretName[]>([]);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

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

  const loadSecrets = useCallback(async () => {
    const { ok, data } = await call<{ names: SecretName[] }>(
      "/api/admin/factory/secret-names",
    );

    if (ok) setSecrets(data.names);
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

  useEffect(() => {
    loadSecrets();
  }, [loadSecrets]);

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

  const addSecret = async () => {
    const { ok, data } = await call<{ name: SecretName }>(
      "/api/admin/factory/secret-names",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
        }),
      },
    );

    setNotice(
      ok ? "키 이름을 저장했어요." : (data.message ?? "저장하지 못했어요."),
    );
    if (ok) {
      setNewName("");
      setNewDesc("");
      loadSecrets();
    }
  };

  const removeSecret = async (name: string) => {
    if (
      !window.confirm(
        `${name} 이름을 목록에서 지울까요? (키 값은 건드리지 않아요)`,
      )
    )
      return;
    const { ok, data } = await call<unknown>(
      `/api/admin/factory/secret-names?name=${encodeURIComponent(name)}`,
      {
        method: "DELETE",
      },
    );

    setNotice(ok ? "지웠어요." : (data.message ?? "지우지 못했어요."));
    loadSecrets();
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

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value || "all"}
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* 지시 목록 */}
        <div className="space-y-2">
          {listError && (
            <Card>
              <CardBody>
                <p className="text-sm text-default-500">{listError}</p>
              </CardBody>
            </Card>
          )}
          {!listError && jobs?.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-gray-300 p-10 text-center text-gray-500 dark:border-gray-700">
              지시가 없어요. Claude 채팅에서 기획서를 등록하면 여기에 나타나요.
            </div>
          )}
          {jobs?.map((j) => (
            <button
              key={j.id}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                selectedId === j.id
                  ? "border-primary bg-primary-50 dark:bg-primary-50/10"
                  : "border-default-200 hover:bg-default-50"
              }`}
              onClick={() => setSelectedId(j.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{j.title}</span>
                <Chip color={STATUS[j.status].color} size="sm" variant="flat">
                  {STATUS[j.status].label}
                </Chip>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-default-500">
                <span className="font-mono">{j.appSlug}</span>
                <span>{j.kind === "new" ? "새 앱" : "수정"}</span>
                {j.phase && j.status === "running" && (
                  <span>단계: {j.phase}</span>
                )}
                <span>{when(j.createdAt)}</span>
                {j._count.images > 0 && <span>📷 {j._count.images}</span>}
              </div>
            </button>
          ))}
        </div>

        {/* 상세 */}
        <div>
          {!selectedId && (
            <div className="rounded-xl border-2 border-dashed border-gray-300 p-10 text-center text-gray-500 dark:border-gray-700">
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

      {/* 키 이름 */}
      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <h2 className="text-lg font-bold">🔑 사용할 수 있는 키 이름</h2>
          <p className="text-xs text-default-500">
            이름과 설명만 저장해요. 실제 키 값은 이 홈페이지에 두지 않고 내
            PC에만 있어요. 채팅의 Claude가 이 목록을 보고 기획서에 필요한 키를
            골라요.
          </p>
        </CardHeader>
        <CardBody className="space-y-3">
          {secrets.length === 0 && (
            <p className="text-sm text-default-500">등록된 이름이 없어요.</p>
          )}
          {secrets.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <div className="min-w-0">
                <span className="font-mono font-semibold">{s.name}</span>
                <span className="ml-2 text-default-500">{s.description}</span>
              </div>
              <Button
                color="danger"
                size="sm"
                variant="light"
                onPress={() => removeSecret(s.name)}
              >
                삭제
              </Button>
            </div>
          ))}
          <div className="flex flex-col gap-2 border-t border-default-200 pt-3 sm:flex-row">
            <Input
              label="키 이름"
              placeholder="PIXELLAB_TOKEN"
              size="sm"
              value={newName}
              onValueChange={setNewName}
            />
            <Input
              label="어디에 쓰는지"
              placeholder="도트 이미지 생성"
              size="sm"
              value={newDesc}
              onValueChange={setNewDesc}
            />
            <Button
              color="primary"
              isDisabled={!newName.trim() || !newDesc.trim()}
              onPress={addSecret}
            >
              추가
            </Button>
          </div>
        </CardBody>
      </Card>
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
  const editable = job.status === "pending" || job.status === "approved";
  const active =
    job.status === "pending" ||
    job.status === "approved" ||
    job.status === "running";

  useEffect(() => {
    setPriority(String(job.priority));
  }, [job.id, job.priority]);

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-2">
        <div className="flex w-full items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold">{job.title}</h2>
            <p className="font-mono text-xs text-default-500">
              {job.appSlug} · {job.kind === "new" ? "새 앱" : "수정 지시"} ·{" "}
              {job.stack}
            </p>
          </div>
          <Chip color={STATUS[job.status].color} variant="flat">
            {STATUS[job.status].label}
          </Chip>
        </div>

        <div className="flex flex-wrap gap-2">
          {job.status === "pending" && (
            <Button
              color="primary"
              isDisabled={busy}
              size="sm"
              onPress={() => onAct(job.id, { action: "approve" })}
            >
              승인
            </Button>
          )}
          {job.status === "failed" && (
            <Button
              color="primary"
              isDisabled={busy}
              size="sm"
              onPress={() => onAct(job.id, { action: "retry" })}
            >
              다시 시도
            </Button>
          )}
          {active && (
            <Button
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
            <div className="flex items-center gap-1">
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
          <Info label="등록" value={when(job.createdAt)} />
          <Info label="승인" value={when(job.approvedAt)} />
          <Info label="시작" value={when(job.startedAt)} />
          <Info label="끝" value={when(job.finishedAt)} />
          <Info label="작업 PC" value={job.workerId ?? "-"} />
          <Info label="시도" value={`${job.attempts} / ${job.maxAttempts}`} />
          {job.phase && <Info label="현재 단계" value={job.phase} />}
          {job.source && <Info label="등록 경로" value={job.source} />}
          {job.parentJobId && (
            <Info label="원본 지시" value={job.parentJobId} />
          )}
        </dl>

        {job.requiredSecrets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="text-default-500">필요한 키:</span>
            {job.requiredSecrets.map((s) => (
              <Chip key={s} size="sm" variant="flat">
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

        {/* 스크린샷 */}
        {job.images.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold">📷 스크린샷</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {job.images.map((img) => (
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

        {/* 토큰 */}
        <section>
          <h3 className="mb-2 font-semibold">🤖 Claude 사용량</h3>
          {claude.sessions.length === 0 ? (
            <p className="text-sm text-default-500">
              아직 이 앱 이름({job.appSlug})으로 들어온 Claude 세션이 없어요.
            </p>
          ) : (
            <>
              <p className="text-sm">
                입력 {num(claude.totals.input)} · 출력{" "}
                {num(claude.totals.output)} · 캐시 생성{" "}
                {num(claude.totals.cacheCreate)} · 캐시 읽기{" "}
                {num(claude.totals.cacheRead)}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-default-500">
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
          <h3 className="mb-2 font-semibold">📜 진행 로그</h3>
          {job.logs.length === 0 ? (
            <p className="text-sm text-default-500">아직 로그가 없어요.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-lg bg-default-100 p-3 font-mono text-xs leading-relaxed">
              {job.logs.map((l) => (
                <div
                  key={l.id}
                  className={
                    l.level === "error"
                      ? "text-danger"
                      : l.level === "warn"
                        ? "text-warning-600"
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
            className="font-semibold"
            onClick={() => setShowPlan((v) => !v)}
          >
            {showPlan ? "▾" : "▸"} 📄 기획서 보기
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-default-500">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </>
  );
}
