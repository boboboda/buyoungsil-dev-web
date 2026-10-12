// lib/factory/storeTarget.ts
// 출시 대상(스토어에 실제로 올릴 앱) 판단. 출시 패키지 목록·출시 일감 등록·커넥터 get_release_status 가 같이 쓴다.
// 다른 모듈을 불러오지 않는 순수 함수만 둔다(시험에서 그대로 불러 쓴다).

/** 스토어 앱이 될 수 없는 종류(웹사이트·서버) */
export const NON_STORE_STACKS = ["nextjs", "nestjs"];

export const NON_STORE_REASON = "웹/서버 앱은 스토어에 올릴 수 없어요";

export const NOT_TARGET_MESSAGE = "출시 대상이 아닌 앱이에요. 먼저 출시 패키지에 추가하세요(통제실 출시 패키지 화면 아래 '출시 대상이 아닌 앱').";

/** 출시 대상으로 만들 수 없는 이유. 만들 수 있으면 null */
export function storeTargetBlockReason(stack: string | null | undefined): string | null {
  return stack && NON_STORE_STACKS.includes(stack) ? NON_STORE_REASON : null;
}

/** 출시 패키지 목록에 보이는 앱인지. 앱 행이 없으면 대상이 아니다 */
export function isStoreTarget(app: { storeTarget?: boolean | null } | null | undefined): boolean {
  return app?.storeTarget === true;
}

export type BackfillApp = {
  releaseAccountId: string | null;
  packageName: string | null;
  firstUploadDone: boolean;
  releaseStatus: string | null;
  releaseRemovedAt: Date | null;
};

export type BackfillJob = { kind: string; stack: string; createdAt: Date };

/**
 * 마이그레이션 백필(20261019090000_add_factory_store_target)과 같은 조건. 이미 출시 작업이 진행된 앱:
 * 배포 계정 / 패키지 이름 / 최초 업로드 완료 / 출시 상태가 preparing 이 아님 / 출시 일감이 있음 중 하나.
 * 마지막 일감의 종류(stack)가 nextjs·nestjs 이면 제외. 예전 [삭제]로 숨긴 앱(지운 뒤 새 일감 없음)도 제외한다
 * (삭제가 출시 데이터를 비웠으니 남는 근거는 지우기 전 출시 일감뿐이고, 사람이 목록에서 뺀 앱이다).
 */
export function shouldBackfillStoreTarget(app: BackfillApp, jobs: BackfillJob[]): boolean {
  if (jobs.length === 0) return false;
  const latest = jobs.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));

  if (storeTargetBlockReason(latest.stack)) return false;
  const removedAt = app.releaseRemovedAt;

  if (removedAt && !jobs.some((j) => j.createdAt > removedAt)) return false;

  return (
    !!app.releaseAccountId ||
    !!app.packageName ||
    app.firstUploadDone ||
    (app.releaseStatus ?? "preparing") !== "preparing" ||
    jobs.some((j) => j.kind === "release")
  );
}
