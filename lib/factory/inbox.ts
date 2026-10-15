// lib/factory/inbox.ts
// 통제실 [현황] '할 일' 목록의 새 항목들(4-1). 기존 승인 목록(일감·정비 지시·배포·비용 확인)은 approvals.ts 가 그대로 주고,
// 여기서는 거기에 없던 결정을 모은다: 막힘, 다시 시작 필요, 키 부족, 묶음 승인 대기, 업데이트 일시 중지·묶는 중, 스튜디오 검수 대기.
//  - buildInboxItems: 읽은 재료 → 항목 목록(순수 함수, 시험이 직접 부른다)
//  - readInboxItems: DB 에서 재료를 읽어 buildInboxItems 로 만든다
//  - flattenInbox: 기존 승인 목록 + 새 항목을 하나의 우선순위 목록으로(채팅 커넥터 get_inbox 가 쓴다)
//  - syncInboxNotices: 텔레그램에 없던 알림(키 부족·묶음 승인)을 한 번만 보내고, 사라진 할 일의 알림 기록을 지운다
// 우선순위: 막힘·실패(blocked) > 승인(approval) > 정보(info).
import prisma from "@/lib/prisma";
import { readCardData } from "@/lib/factory/cards";
import { PARALLEL_KIND } from "@/lib/factory/parallel";
import { knownSecretNames } from "@/lib/factory/secretEntries";
import { readManifestTools } from "@/lib/factory/toolManifestDb";
import { methodSecrets } from "@/lib/factory/toolManifest";
import { notifyOnce } from "@/lib/factory/telegram";
import { releaseNotices } from "@/lib/factory/inboxNotice";

export type InboxTier = "blocked" | "approval" | "info";
export const TIER_RANK: Record<InboxTier, number> = { blocked: 0, approval: 1, info: 2 };
export const TIER_LABEL: Record<InboxTier, string> = { blocked: "막힘·실패", approval: "승인", info: "정보" };

/** 화면 단추 하나. retry·approve_group 은 통제실 API 를 부르고, link 는 이동한다 */
export interface InboxAction {
  id: "retry" | "approve_group" | "link";
  label: string;
  jobId?: string;
  href?: string;
}

export interface InboxItem {
  key: string; // 화면 key 이자 시험용 이름. 같은 할 일이면 늘 같다
  kind: "stuck" | "resume" | "keys" | "group" | "update_paused" | "update_bundle" | "studio_review";
  tier: InboxTier;
  title: string;
  detail: string;
  appSlug?: string;
  actions: InboxAction[];
  noticeKey?: string; // 텔레그램 알림 이름(있으면 알림 대상)
}

const RECENT_FAIL_DAYS = 14; // 막힘·다시 시작 필요는 이 기간 안의 것만(오래된 실패가 목록을 막지 않게)
const MAX_PER_KIND = 30;

const cut = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();

  return t.length > max ? `${t.slice(0, max)}…` : t;
};

export const jobLink = (id: string) => `/admin/factory?tab=jobs&job=${encodeURIComponent(id)}`;
export const keysLink = () => "/admin/factory?tab=settings";
export const supervisorLink = () => "/admin/factory?tab=supervisor";
export const studioOpsLink = (appSlug: string) => `/studio/${encodeURIComponent(appSlug)}?tab=ops`;

// ───────── 재료 → 항목 (순수) ─────────

export interface InboxFacts {
  /** 막힘·다시 시작 필요로 끝난 일감(failStage = stuck | resume) */
  failedJobs: { id: string; appSlug: string; title: string; failStage: string | null; failReason: string | null }[];
  /** 아직 시작 안 한 일감(승인 대기·승인됨)과 그 일감이 요구하는 키 이름 */
  jobsWithKeys: { id: string; appSlug: string; title: string; requiredSecrets: string[] }[];
  /** 켜진 카드와 그 방법에 필요한 키 이름 */
  cardsWithKeys: { id: string; appSlug: string; name: string; secrets: string[] }[];
  /** 등록된 키 이름(값 아님) */
  registered: ReadonlySet<string>;
  /** 승인 전·승인됨 상태인 묶음 소속 수정 일감 */
  groupJobs: { id: string; appSlug: string; title: string; status: string; parallelGroup: string | null }[];
  /** 프로젝트별 스튜디오 검수 대기(후보 그림) 수 */
  studioReview: { appSlug: string; count: number }[];
  /** 감독 프로그램 상태(supervisorSnapshot 의 일부). 없으면 업데이트 항목은 만들지 않는다 */
  supervisor?: { online?: boolean; pausedJobs?: number; bundleLeftMin?: number | null; drainState?: string | null; drainJobs?: number | null } | null;
}

export function buildInboxItems(f: InboxFacts): InboxItem[] {
  const items: InboxItem[] = [];

  // 1) 막힘·다시 시작 필요
  for (const j of f.failedJobs.slice(0, MAX_PER_KIND)) {
    const stuck = j.failStage === "stuck";
    const resume = j.failStage === "resume";

    if (!stuck && !resume) continue;
    items.push({
      key: `${stuck ? "stuck" : "resume"}:${j.id}`,
      kind: stuck ? "stuck" : "resume",
      tier: "blocked",
      title: j.title,
      detail: stuck
        ? `막힘: 같은 시험·빌드를 계속 반복해서 멈췄어요. 작업 파일은 그대로예요. ${cut(j.failReason, 160)}`
        : `다시 시작 필요: 업데이트로 멈춘 일감을 이어 주지 못했어요. 파일은 그대로예요. ${cut(j.failReason, 160)}`,
      appSlug: j.appSlug,
      actions: [{ id: "retry", label: "다시 시도", jobId: j.id }, { id: "link", label: "일감 보기", href: jobLink(j.id) }],
      noticeKey: `job:${j.id}:${stuck ? "stuck" : "resume"}`,
    });
  }

  // 2) 키 부족: 키 이름마다 한 건(그 키가 필요한 일감·카드를 같이 적는다)
  const need = new Map<string, { jobs: string[]; cards: string[] }>();
  const slot = (name: string) => {
    let s = need.get(name);

    if (!s) need.set(name, (s = { jobs: [], cards: [] }));

    return s;
  };

  for (const j of f.jobsWithKeys) for (const n of j.requiredSecrets) if (!f.registered.has(n)) slot(n).jobs.push(`${j.title}(${j.appSlug})`);
  for (const c of f.cardsWithKeys) for (const n of c.secrets) if (!f.registered.has(n)) slot(n).cards.push(`${c.name}(${c.appSlug})`);
  for (const [name, s] of [...need.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, MAX_PER_KIND)) {
    const where = [s.jobs.length ? `일감 ${s.jobs.length}개: ${s.jobs.slice(0, 3).join(", ")}${s.jobs.length > 3 ? " …" : ""}` : "", s.cards.length ? `카드 ${s.cards.length}개: ${s.cards.slice(0, 3).join(", ")}${s.cards.length > 3 ? " …" : ""}` : ""].filter(Boolean);

    items.push({
      key: `keys:${name}`,
      kind: "keys",
      tier: "blocked",
      title: `키 부족: ${name}`,
      detail: `${name} 키 이름이 등록돼 있지 않아요. 등록하기 전에는 이 키가 필요한 일을 시작해도 실패해요. ${where.join(" · ")}`,
      actions: [{ id: "link", label: "키 등록하러 가기", href: keysLink() }],
      noticeKey: `keys:${name}`,
    });
  }

  // 3) 묶음 승인 대기: 묶음 안에 승인 대기 일감이 남아 있으면 묶음 전체가 시작하지 못한다
  const groups = new Map<string, InboxFacts["groupJobs"]>();

  for (const j of f.groupJobs) if (j.parallelGroup) groups.set(`${j.appSlug}\u0000${j.parallelGroup}`, [...(groups.get(`${j.appSlug}\u0000${j.parallelGroup}`) ?? []), j]);
  for (const [id, list] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, MAX_PER_KIND)) {
    const pending = list.filter((j) => j.status === "pending");

    if (list.length < 2 || !pending.length) continue;
    const [appSlug, group] = id.split("\u0000");

    items.push({
      key: `group:${appSlug}:${group}`,
      kind: "group",
      tier: "approval",
      title: `묶음 승인 대기: ${appSlug}`,
      detail: `같이 돌릴 일감 ${list.length}개 중 ${pending.length}개가 승인 대기예요(${pending.slice(0, 3).map((j) => j.title).join(", ")}${pending.length > 3 ? " …" : ""}). 모두 승인돼야 같이 시작해요.`,
      appSlug,
      actions: [{ id: "approve_group", label: `묶음 승인 (${pending.length}개)`, jobId: pending[0].id }],
      noticeKey: `group:${appSlug}:${group}`,
    });
  }

  // 4) 스튜디오 검수 대기(프로젝트별)
  for (const s of [...f.studioReview].filter((x) => x.count > 0).sort((a, b) => b.count - a.count || a.appSlug.localeCompare(b.appSlug)).slice(0, MAX_PER_KIND)) {
    items.push({
      key: `studio:${s.appSlug}`,
      kind: "studio_review",
      tier: "approval",
      title: `스튜디오 검수 대기: ${s.appSlug}`,
      detail: `검수를 기다리는 후보 그림이 ${s.count}장 있어요.`,
      appSlug: s.appSlug,
      actions: [{ id: "link", label: "검수하러 가기", href: studioOpsLink(s.appSlug) }],
    });
  }

  // 5) 업데이트로 일시 중지 / 업데이트 대기(묶는 중): 정보. 사람이 할 일은 없고 알려 주기만 한다
  const sup = f.supervisor;

  if (sup) {
    const paused = Math.max(0, Math.floor(Number(sup.pausedJobs) || 0));
    const left = Math.floor(Number(sup.bundleLeftMin));

    if (paused > 0 || sup.drainState === "update") {
      items.push({
        key: "update-paused",
        kind: "update_paused",
        tier: "info",
        title: paused > 0 ? `업데이트로 일시 중지 ${paused}개` : "감독 프로그램 업데이트 중",
        detail:
          paused > 0
            ? "감독 프로그램을 새 버전으로 바꾸는 동안 일감을 안전한 지점에서 멈췄어요. 새 버전이 켜지면 같은 세션으로 이어서 해요."
            : `진행 중인 AI 일감 ${Math.max(0, Math.floor(Number(sup.drainJobs) || 0))}개를 멈추고 새 버전으로 다시 켜는 중이에요. 그동안 새 일감은 받지 않아요.`,
        actions: [{ id: "link", label: "감독 탭", href: supervisorLink() }],
      });
    }
    if (Number.isFinite(left) && left > 0) {
      items.push({
        key: "update-bundle",
        kind: "update_bundle",
        tier: "info",
        title: `업데이트 대기(묶는 중, 남은 ${left}분)`,
        detail: "새 감독 프로그램 커밋을 모으는 중이에요. 그동안 일감은 계속 돌아요. 바로 받으려면 감독 탭의 [지금 업데이트]를 누르세요.",
        actions: [{ id: "link", label: "감독 탭", href: supervisorLink() }],
      });
    }
  }

  return sortInbox(items);
}

/** 막힘·실패 > 승인 > 정보. 같은 단계 안에서는 들어온 순서 그대로 */
export function sortInbox<T extends { tier: InboxTier }>(items: T[]): T[] {
  return items.map((it, i) => ({ it, i })).sort((a, b) => TIER_RANK[a.it.tier] - TIER_RANK[b.it.tier] || a.i - b.i).map((x) => x.it);
}

// ───────── DB 에서 읽기 ─────────

export async function readInboxItems(supervisor?: InboxFacts["supervisor"], now = Date.now()): Promise<InboxItem[]> {
  const since = new Date(now - RECENT_FAIL_DAYS * 24 * 3600 * 1000);
  const [failedJobs, jobsWithKeys, groupJobs, studio, names, cardsWithKeys] = await Promise.all([
    prisma.factoryJob.findMany({
      where: { status: "failed", failStage: { in: ["stuck", "resume"] }, updatedAt: { gte: since } },
      orderBy: { updatedAt: "desc" },
      take: MAX_PER_KIND,
      select: { id: true, appSlug: true, title: true, failStage: true, failReason: true },
    }),
    prisma.factoryJob.findMany({
      where: { status: { in: ["pending", "approved"] }, NOT: { requiredSecrets: { isEmpty: true } } },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, appSlug: true, title: true, requiredSecrets: true },
    }),
    prisma.factoryJob.findMany({
      where: { status: { in: ["pending", "approved"] }, kind: PARALLEL_KIND, parallelGroup: { not: null } },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, appSlug: true, title: true, status: true, parallelGroup: true },
    }),
    prisma.factoryArt.groupBy({ by: ["appSlug"], where: { status: "candidate" }, _count: { _all: true } }),
    knownSecretNames().catch(() => [] as { name: string }[]),
    readCardsWithKeys(),
  ]);

  return buildInboxItems({
    failedJobs,
    jobsWithKeys,
    cardsWithKeys,
    registered: new Set(names.map((n) => n.name)),
    groupJobs,
    studioReview: studio.map((s) => ({ appSlug: s.appSlug, count: s._count._all })),
    supervisor,
  });
}

/** 켜진 카드 중 방법이 키를 요구하는 것(설명서가 없거나 못 읽으면 빈 목록) */
async function readCardsWithKeys(): Promise<InboxFacts["cardsWithKeys"]> {
  try {
    const [rows, tools] = await Promise.all([prisma.factoryCard.findMany({ where: { enabled: true }, take: 500 }), readManifestTools()]);

    if (!Object.keys(tools).length) return [];

    return rows.flatMap((r) => {
      const d = readCardData(r);
      const m = tools[d.tool];
      const secrets = m && d.method ? methodSecrets(m, d.method) : [];

      return secrets.length ? [{ id: r.id, appSlug: r.appSlug, name: r.name, secrets }] : [];
    });
  } catch {
    return [];
  }
}

// ───────── 기존 승인 목록과 합치기(채팅 커넥터 get_inbox) ─────────

/** approvalInbox() 가 주는 모양의 필요한 부분 */
export interface InboxLists {
  jobs: { id: string; appSlug: string; title: string; kindLabel: string; createdAt: Date | string }[];
  confirmations: { id: string; appSlug: string; title: string; reason: string; kind?: string }[];
  turns: { id: string; threadTitle: string; text: string }[];
  deploys: { threadId: string; title: string; commit: string | null; inProgress: boolean; canDeploy?: boolean; queueLeft?: number }[];
}

export interface FlatInboxItem {
  key: string;
  tier: InboxTier;
  kind: string;
  title: string;
  detail: string;
  appSlug?: string;
  /** 사람이 하는 일을 한 줄로: 어디서 무엇을 누르는지 */
  how: string;
}

/** 기존 승인 목록(일감·정비 지시·배포·비용 확인) + 새 항목을 하나로 합쳐 우선순위순으로. 읽기 전용(처리는 통제실·텔레그램) */
export function flattenInbox(lists: InboxLists, items: InboxItem[]): FlatInboxItem[] {
  const out: FlatInboxItem[] = [];

  for (const c of lists.confirmations)
    out.push({ key: `cost:${c.id}`, tier: "approval", kind: "cost", title: c.title, appSlug: c.appSlug, detail: `비용 한도 초과로 확인을 기다려요. ${c.reason}`.trim(), how: "통제실 [현황] 할 일에서 [그대로 진행] 또는 [취소]" });
  for (const j of lists.jobs)
    out.push({ key: `job:${j.id}`, tier: "approval", kind: "job_approval", title: j.title, appSlug: j.appSlug, detail: `${j.kindLabel} 일감이 승인을 기다려요.`, how: "통제실 [현황] 할 일 또는 텔레그램에서 [승인]" });
  for (const t of lists.turns)
    out.push({ key: `turn:${t.id}`, tier: "approval", kind: "maintenance_approval", title: t.threadTitle, detail: `정비 지시가 승인을 기다려요: ${cut(t.text, 120)}`, how: "통제실 [현황] 할 일 또는 텔레그램에서 [승인]" });
  for (const d of lists.deploys)
    if (!d.inProgress && d.canDeploy !== false) out.push({ key: `deploy:${d.threadId}`, tier: "approval", kind: "deploy", title: d.title, detail: `서버 배포를 기다려요(커밋 ${(d.commit ?? "-").slice(0, 7)}).`, how: "통제실 [현황] 할 일의 [배포] (채팅에서는 배포할 수 없어요)" });
  for (const it of items)
    out.push({
      key: it.key,
      tier: it.tier,
      kind: it.kind,
      title: it.title,
      detail: it.detail,
      ...(it.appSlug ? { appSlug: it.appSlug } : {}),
      how: it.actions.map((a) => (a.id === "link" ? `${a.label}(${a.href})` : a.label)).join(" / ") || "알려 주기만 해요",
    });

  return sortInbox(out);
}

// ───────── 텔레그램: 없던 알림을 한 번만 ─────────

const MIN_SYNC_MS = 30_000;
let lastSync = 0;

/** 키 부족·묶음 승인 알림을 처음 생겼을 때 한 번만 보낸다. 사라진 할 일의 알림 기록은 지워서, 다시 생기면 새로 알린다.
 *  막힘·다시 시작 필요·비용 한도는 일감이 끝났을 때 notifyJobEvent 가 보내고(같은 claim 이름), 여기서는 기록 정리만 한다. 절대 던지지 않는다. */
export async function syncInboxNotices(opts: { force?: boolean; items?: InboxItem[]; confirmIds?: string[] } = {}): Promise<{ sent: string[] }> {
  const sent: string[] = [];

  try {
    const t = Date.now();

    if (!opts.force && t - lastSync < MIN_SYNC_MS) return { sent };
    lastSync = t;
    const items = opts.items ?? (await readInboxItems());
    const confirmIds = opts.confirmIds ?? (await prisma.factoryJob.findMany({ where: { status: "needs_confirmation" }, select: { id: true }, take: 100 })).map((j) => j.id);

    for (const it of items) {
      if (it.kind === "keys" && (await notifyOnce(it.noticeKey!, `🔑 키 부족\n${it.detail}`.slice(0, 600), "/admin/factory?tab=settings"))) sent.push(it.noticeKey!);
      if (it.kind === "group" && (await notifyOnce(it.noticeKey!, `📦 묶음 승인 대기\n${it.title.replace("묶음 승인 대기: ", "")} — ${it.detail}\n통제실 [일감] 탭에서 [묶음 승인]을 눌러 주세요.`.slice(0, 600), "/admin/factory?tab=jobs"))) sent.push(it.noticeKey!);
    }
    // 끝난 할 일의 기록 정리: 지금도 남아 있는 것만 keep
    const keep = new Set([...items.map((i) => i.noticeKey).filter((k): k is string => !!k), ...confirmIds.map((id) => `job:${id}:cost`)]);

    for (const prefix of ["keys:", "group:", "job:"]) await releaseNotices(prefix, keep);
  } catch {
    console.error("[inbox] 알림 정리 실패");
  }

  return { sent };
}

/** 시험용: 알림 정리 간격 초기화 */
export function resetInboxSyncThrottle(): void {
  lastSync = 0;
}
