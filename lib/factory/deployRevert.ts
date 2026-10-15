// lib/factory/deployRevert.ts
// 배포 되돌리기 (5-2). 홈페이지 배포 기록(커밋별)의 [이전 버전으로]: 그 배포 커밋의 상태로 다시 배포한다.
//   - 기존 배포 경로를 그대로 쓴다: 감독 프로그램이 정비 폴더에서 "되돌리기 커밋"(부모 = 지금 main, 내용 = 그 배포 커밋의 내용)을
//     만들어 GitHub main 에 보통 push 하고(force push 없음), 그 커밋을 평소처럼 서버 배포 저장소로 push 한다.
//     감독 프로그램 코드(tools/factory-supervisor)와 DB 마이그레이션은 되돌리지 않고 지금 것을 그대로 둔다.
//   - DB 마이그레이션이 들어 있는 배포가 대상과 지금 사이에 있으면 막고 이유를 보여 준다. 마이그레이션은 되돌리지 않는다.
//     서버는 배포마다 감독 프로그램이 알려 준 마이그레이션 여부(FactoryDeploy.migrations)로 미리 판단하고(null = 모름은 통과),
//     감독 프로그램이 실제 git 차이로 한 번 더 막는다(권위 있는 검사).
//   - 진행 중인 배포가 없고, 정비 대기열이 비었고, 배포 안 된 정비 변경이 없을 때만(되돌리면 그 변경도 같이 사라지므로).
//   - 시작할 때와 결과가 나왔을 때 텔레그램에 알린다(결과는 maintenance.ts 의 deployFinished 가 알린다).
// 앱 배포(prod 원격 등)는 이번 범위가 아니다. 1-6 연결 정보(projectLinks)로 같은 방식을 쓸 수 있는지는 docs/deploy-revert.md 에 적었다.
import prisma from "@/lib/prisma";
import { notifyText } from "@/lib/factory/telegram";

const short = (c: string | null | undefined) => (c ? c.slice(0, 7) : "?");

export interface RevertRow {
  id: string;
  commit: string;
  ok: boolean | null;
  kind?: string | null;
  requestedAt: Date | string;
  migrations?: boolean | null;
}

export interface RevertBlockers {
  inProgress: boolean; // 배포가 진행 중
  queueLeft: number; // 정비 대기열(승인 대기·대기·진행)
  pending: number; // 배포 안 된 정비 변경 수
}

export interface RevertInfo {
  allowed: boolean;
  reason: string | null; // 막혔으면 이유
}

const time = (v: Date | string) => new Date(v).getTime();

/**
 * 이 배포 기록으로 되돌릴 수 있나. okDeploys = 성공한 배포 전체(순서 상관없음).
 * 대상보다 나중에 성공한 배포 중 마이그레이션이 들어 있는(migrations === true) 것이 있으면 막는다.
 */
export function revertCheck(target: RevertRow, okDeploys: RevertRow[], blockers: RevertBlockers): RevertInfo {
  const no = (reason: string): RevertInfo => ({ allowed: false, reason });

  if (target.ok !== true) return no("성공한 배포만 되돌릴 수 있어요.");
  const sorted = [...okDeploys].sort((a, b) => time(b.requestedAt) - time(a.requestedAt) || (a.id < b.id ? 1 : -1));
  const latest = sorted[0];

  if (!latest || latest.id === target.id || latest.commit === target.commit) return no("지금 서버에 올라가 있는 버전이에요.");
  if (blockers.inProgress) return no("배포가 진행 중이에요. 끝난 뒤에 되돌릴 수 있어요.");
  if (blockers.queueLeft > 0) return no(`정비 대기열 ${blockers.queueLeft}개가 남아 있어요. 대기열이 끝난 뒤에 되돌릴 수 있어요.`);
  if (blockers.pending > 0) return no(`아직 배포하지 않은 정비 변경 ${blockers.pending}개가 있어요. 되돌리면 그 변경도 같이 사라지니 먼저 [배포]하거나 정리해 주세요.`);
  const between = sorted.filter((d) => time(d.requestedAt) > time(target.requestedAt) || (time(d.requestedAt) === time(target.requestedAt) && d.id > target.id));
  const withMigration = between.filter((d) => d.migrations === true);

  if (withMigration.length) {
    return no(`그 사이 배포(${withMigration.map((d) => short(d.commit)).join(", ")})에 DB 마이그레이션이 들어 있어서 되돌릴 수 없어요. 마이그레이션은 되돌리지 않아요. 고칠 점을 새 정비 지시로 보내 주세요.`);
  }

  return { allowed: true, reason: null };
}

/** 배포 기록 화면용: 모든 줄의 되돌리기 가능 여부. 못 읽으면 빈 Map(버튼을 안 보인다) */
export async function revertInfoFor(rows: { id: string }[]): Promise<Map<string, RevertInfo>> {
  const out = new Map<string, RevertInfo>();

  try {
    const [okDeploys, blockers] = await Promise.all([
      prisma.factoryDeploy.findMany({ where: { ok: true }, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], take: 300, select: { id: true, commit: true, ok: true, kind: true, requestedAt: true, migrations: true } }),
      revertBlockers(),
    ]);
    const known = new Map(okDeploys.map((d) => [d.id, d]));

    for (const r of rows) {
      const t = known.get(r.id);

      out.set(r.id, t ? revertCheck(t, okDeploys, blockers) : { allowed: false, reason: "성공한 배포만 되돌릴 수 있어요." });
    }
  } catch {
    /* 못 읽으면 버튼을 안 보이는 쪽으로 */
  }

  return out;
}

async function revertBlockers(): Promise<RevertBlockers> {
  const { deployBundle } = await import("@/lib/factory/maintenance");
  const b = await deployBundle();

  return { inProgress: !!b.inProgress, queueLeft: b.queueLeft, pending: b.items.length };
}

type Result = { ok: boolean; status: number; message: string };
const fail = (status: number, message: string): Result => ({ ok: false, status, message });

/** [이전 버전으로]: 통제실에서만. 조건부 updateMany 라서 두 곳에서 동시에 눌러도 요청은 한 번만 들어간다. */
export async function requestRevert(deployId: string, via: "통제실" = "통제실"): Promise<Result> {
  const target = await prisma.factoryDeploy.findUnique({ where: { id: deployId }, select: { id: true, commit: true, ok: true, kind: true, requestedAt: true, migrations: true, maintenanceId: true } });

  if (!target) return fail(404, "없는 배포 기록이에요.");
  const [okDeploys, blockers] = await Promise.all([
    prisma.factoryDeploy.findMany({ where: { ok: true }, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], take: 300, select: { id: true, commit: true, ok: true, kind: true, requestedAt: true, migrations: true } }),
    revertBlockers(),
  ]);
  const info = revertCheck(target, okDeploys, blockers);

  if (!info.allowed) return fail(409, info.reason ?? "되돌릴 수 없어요.");
  const now = new Date();
  const r = await prisma.factoryMaintenance.updateMany({
    where: { id: target.maintenanceId, OR: [{ deployRequestedAt: null }, { deployedAt: { not: null } }, { deployResult: { not: null } }] },
    data: { deployCommit: target.commit, deployRevertTo: target.commit, deployRequestedAt: now, deployStartedAt: null, deployedAt: null, deployResult: null },
  });

  if (!r.count) return fail(409, "이미 배포를 요청했어요(진행 중). 끝나면 결과가 여기와 텔레그램에 나와요.");
  await prisma.factoryDeploy.create({ data: { maintenanceId: target.maintenanceId, commit: target.commit, kind: "revert", revertTo: target.commit, via, requestedAt: now } });
  await prisma.factoryMaintenanceMessage.create({ data: { maintenanceId: target.maintenanceId, role: "system", text: `배포 되돌리기(${via}): ${short(target.commit)} 버전 상태로 되돌리는 커밋을 만들어 다시 배포해요.` } }).catch(() => undefined);
  await notifyText(`↩️ 배포 되돌리기를 시작해요\n${short(target.commit)} 버전 상태로 돌아가요(되돌리기 커밋을 만들어 배포해요, 빌드 3~4분). DB 마이그레이션은 되돌리지 않아요.\n결과가 나오면 다시 알려 드려요.`, "/admin/factory").catch(() => undefined);

  return { ok: true, status: 200, message: `${short(target.commit)} 버전으로 되돌리기를 요청했어요. 감독 프로그램이 15초 안에 받아서 되돌리기 커밋을 만들고 배포해요(빌드 3~4분). 시작과 결과는 텔레그램으로도 알려 드려요.` };
}

/** 감독 프로그램이 되돌리기 커밋을 GitHub main 에 올렸다고 알림: 이 배포의 커밋을 그 커밋으로 바꾼다(그 뒤는 평소 배포와 같다) */
export async function revertCommitMade(threadId: string, from: string, commit: string): Promise<Result> {
  const t = await prisma.factoryMaintenance.findUnique({ where: { id: threadId } });

  if (!t?.deployStartedAt || t.deployResult || t.deployRevertTo !== from) return fail(409, "되돌리기 요청이 없거나 이미 처리됐어요.");
  const d = await prisma.factoryDeploy.findFirst({ where: { maintenanceId: threadId, ok: null, kind: "revert", commit: from }, orderBy: { requestedAt: "desc" } });
  const r = await prisma.factoryMaintenance.updateMany({ where: { id: threadId, deployRevertTo: from, deployResult: null }, data: { deployCommit: commit, deployRevertTo: null } });

  if (!r.count) return fail(409, "되돌리기 요청이 없거나 이미 처리됐어요.");
  if (d) await prisma.factoryDeploy.update({ where: { id: d.id }, data: { commit, migrations: false } });
  await prisma.factoryMaintenanceMessage.create({ data: { maintenanceId: threadId, role: "system", text: `되돌리기 커밋을 만들어 GitHub main 에 올렸어요(${short(commit)}, 대상 ${short(from)}). 이 커밋을 배포해요.` } }).catch(() => undefined);

  return { ok: true, status: 200, message: "되돌리기 커밋 기록" };
}
