// lib/factory/supervisorDrain.ts
// 감독 프로그램이 업데이트·서버 배포를 "진행 중 일감이 끝나길 기다리는" 상태(드레인)의 표시 문구.
// 정비가 대기·진행 중이어도 앱·실험 일감은 계속 돌고(병렬화 단계 A), 이 상태일 때만 새 일감을 받지 않는다.

export type DrainKind = "update" | "deploy";

/** 통제실·커넥터에 보여 줄 드레인 문구 */
export function drainNote(kind: DrainKind, jobs: number): string {
  const left = jobs > 0 ? `진행 중 일감 ${jobs}개 끝나면` : "곧";

  return kind === "update"
    ? `업데이트 대기(${left} 감독 프로그램을 새 버전으로 다시 켜요. 그동안 새 일감은 받지 않아요)`
    : `배포 대기(${left} 서버에 배포해요. 그동안 새 일감은 받지 않아요)`;
}
