// components/admin/factory/fx.tsx
// 통제실 디자인 조각(겉모양만): 상태 점 ●, 얇은 진행 막대, 일감 단계 표시 ●──●──○.
// 색은 factory.css 의 토큰을 쓴다: 진행=청록(run) · 완료=초록(ok) · 대기·승인 필요=노랑(warn) · 실패·중단=빨강(bad).

export type Tone = "run" | "ok" | "warn" | "bad" | "idle";

// 일감 상태 → 색 (상태 값 자체는 서버 그대로)
export const JOB_TONE: Record<string, Tone> = {
  pending: "warn",
  approved: "warn",
  running: "run",
  review: "warn",
  linkwait: "warn",
  done: "ok",
  failed: "bad",
  cancelled: "bad",
};

export const jobTone = (status: string): Tone => JOB_TONE[status] ?? "idle";

export function StatusDot({
  tone,
  hollow = false,
}: {
  tone: Tone;
  hollow?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={`fx-dot fx-${tone}${hollow ? " fx-hollow" : ""}`}
    />
  );
}

/** 얇은 진행 막대. value(0~1)가 없으면 오가는 막대(움직임 줄이기 설정이면 멈춤) */
export function ProgressBar({
  tone = "run",
  value,
  label,
}: {
  tone?: Tone;
  value?: number;
  label: string;
}) {
  const pct =
    value === undefined
      ? undefined
      : Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={pct}
      className={`fx-bar fx-${tone}${pct === undefined ? " fx-indeterminate" : ""}`}
      role="progressbar"
    >
      <span style={pct === undefined ? undefined : { width: `${pct}%` }} />
    </div>
  );
}

export const JOB_STEPS = ["등록", "승인", "제작", "완료"] as const;

/**
 * 일감 단계: reached = 끝난 마지막 단계, current = 지금 머문 단계(없으면 null), tone = 지금 단계 색.
 * 상태 값과 시각(approvedAt·startedAt)만 보고 계산한다.
 */
export function jobStepState(job: {
  status: string;
  approvedAt?: string | null;
  startedAt?: string | null;
}): { reached: number; current: number | null; tone: Tone } {
  switch (job.status) {
    case "pending":
      return { reached: 0, current: 1, tone: "warn" };
    case "approved":
      return { reached: 1, current: 2, tone: "warn" };
    case "running":
      return { reached: 1, current: 2, tone: "run" };
    case "review":
    case "linkwait":
      return { reached: 2, current: 3, tone: "warn" };
    case "done":
      return { reached: 3, current: null, tone: "ok" };
    default: {
      // failed·cancelled: 어디까지 갔다가 멈췄는지
      const reached = job.startedAt || job.approvedAt ? 1 : 0;

      return { reached, current: reached + 1, tone: "bad" };
    }
  }
}

/** ●──●──◐──○ 단계 표시. 화면 읽기 프로그램에는 단계 이름과 상태를 글로 준다 */
export function JobSteps({
  status,
  approvedAt,
  startedAt,
  labels = true,
}: {
  status: string;
  approvedAt?: string | null;
  startedAt?: string | null;
  labels?: boolean;
}) {
  const { reached, current, tone } = jobStepState({
    status,
    approvedAt,
    startedAt,
  });
  const doneTone: Tone = status === "done" ? "ok" : "run";
  const text = JOB_STEPS.map((s, i) =>
    i <= reached
      ? `${s} 끝`
      : i === current
        ? `${s} ${tone === "bad" ? "멈춤" : "중"}`
        : `${s} 전`,
  ).join(", ");

  return (
    <div className="w-full max-w-sm" data-testid="job-steps">
      <span className="sr-only">단계: {text}</span>
      <div aria-hidden className="fx-steps">
        {JOB_STEPS.map((s, i) => (
          <span key={s} className="contents">
            {i > 0 && (
              <span
                className={`fx-step-line fx-${doneTone}${i <= reached ? " fx-done" : ""}`}
              />
            )}
            {i <= reached ? (
              <StatusDot tone={doneTone} />
            ) : i === current ? (
              <StatusDot tone={tone} />
            ) : (
              <StatusDot hollow tone="idle" />
            )}
          </span>
        ))}
      </div>
      {labels && (
        <div
          aria-hidden
          className="mt-1 flex justify-between text-[11px] fx-muted"
        >
          {JOB_STEPS.map((s, i) => (
            <span key={s} className={i === current ? `fx-${tone}` : undefined}>
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── [현황] 상태 체계(색 + 아이콘 + 글자) ──
// 색만으로 구분하지 않는다: 색약·흑백에서도 아이콘과 글자로 구분. 색은 admin-ui.css 의 .fx-st-* / .fx-row[data-st] 토큰.
export type StatusKind = "run" | "approval" | "wait" | "done" | "fail" | "cancel" | "info";

export const STATUS_KINDS: Record<StatusKind, { icon: string; word: string; name: string }> = {
  run: { icon: "▶", word: "진행 중", name: "청록 채움" },
  approval: { icon: "✋", word: "승인 필요", name: "노랑(호박)" },
  wait: { icon: "◷", word: "대기", name: "회색 점선" },
  done: { icon: "✓", word: "완료", name: "초록" },
  fail: { icon: "✕", word: "실패", name: "빨강" },
  cancel: { icon: "⊘", word: "취소", name: "회색" },
  info: { icon: "•", word: "", name: "회색" },
};

/** 눈에 띄어야 하는 상태: 진행 중·사람이 눌러야 함 ('진행 중만 보기'가 모아 보는 줄) */
export const isLiveKind = (k: StatusKind) => k === "run" || k === "approval";

export interface StatusInfo {
  kind: StatusKind;
  label: string;
}

/** 앱 일감 상태 → 종류·글자 (상태 값 자체는 서버 그대로) */
export function jobStatusInfo(status: string): StatusInfo {
  switch (status) {
    case "pending":
      return { kind: "approval", label: "승인 필요" };
    case "approved":
      return { kind: "wait", label: "대기" };
    case "running":
      return { kind: "run", label: "진행 중" };
    case "review":
      return { kind: "approval", label: "검토 필요" };
    case "linkwait":
      return { kind: "approval", label: "영상 링크 필요" };
    case "done":
      return { kind: "done", label: "완료" };
    case "failed":
      return { kind: "fail", label: "실패" };
    case "cancelled":
      return { kind: "cancel", label: "취소" };
    default:
      return { kind: "info", label: status };
  }
}

/** 정비 지시(턴) 상태 → 종류·글자 */
export function turnStatusInfo(status: string): StatusInfo {
  switch (status) {
    case "awaiting_approval":
      return { kind: "approval", label: "승인 필요" };
    case "queued":
      return { kind: "wait", label: "대기" };
    case "running":
      return { kind: "run", label: "진행 중" };
    case "done":
      return { kind: "done", label: "완료" };
    case "failed":
      return { kind: "fail", label: "실패" };
    case "cancelled":
      return { kind: "cancel", label: "취소" };
    default:
      return { kind: "info", label: status };
  }
}

/** 상태 칩: 아이콘 + 글자 (+ 색). label 을 안 주면 종류의 기본 글자 */
export function StatusChip({ kind, label }: { kind: StatusKind; label?: string }) {
  const s = STATUS_KINDS[kind];

  return (
    <span className={`fx-st fx-st-${kind}`} data-st-chip={kind}>
      <span aria-hidden className="fx-ico">
        {s.icon}
      </span>
      {label ?? s.word}
    </span>
  );
}

/** 종류 칩(정비/일감/배포/감독…): 색 없는 윤곽선 + 작게. kind 를 주면 data-kind 를 붙인다(전체 히스토리 줄 표시) */
export function KindChip({ label, kind }: { label: string; kind?: string }) {
  return (
    <span className="fx-kind" data-kind={kind}>
      {label}
    </span>
  );
}

/** 경과 시간: 59초 이하 "N초", 1시간 미만 "N분 N초", 그 이상 "N시간 N분" */
export function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));

  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분 ${s % 60}초`;

  return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
}
