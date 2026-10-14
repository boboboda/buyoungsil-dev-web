// lib/factory/supervisorDrain.ts
// 감독 프로그램이 업데이트·서버 배포를 "진행 중 일감이 끝나길 기다리는" 상태(드레인)의 표시 문구.
// 정비가 대기·진행 중이어도 앱·실험 일감은 계속 돌고(병렬화 단계 A), 이 상태일 때만 새 일감을 받지 않는다.

export type DrainKind = "update" | "deploy";

/** 통제실·커넥터에 보여 줄 드레인 문구 */
export function drainNote(kind: DrainKind, jobs: number): string {
  const left = jobs > 0 ? `진행 중 일감 ${jobs}개 끝나면` : "곧";

  return kind === "update"
    ? `업데이트 중(진행 중인 AI 일감 ${jobs}개를 안전한 지점에서 잠깐 멈추고 새 버전으로 다시 켜요. 멈춘 일감은 같은 세션으로 이어 줘요. 그동안 새 일감은 받지 않아요)`
    : `배포 대기(${left} 서버에 배포해요. 그동안 새 일감은 받지 않아요)`;
}

/** 감독 프로그램 업데이트 때문에 일시 중지된 일감 문구("업데이트로 일시 중지 N개"). 없으면 null */
export function pausedNote(n: number): string | null {
  const c = Math.max(0, Math.floor(n) || 0);

  return c > 0 ? `업데이트로 일시 중지 ${c}개(새 버전이 켜지면 같은 세션으로 이어서 해요)` : null;
}

/** 새 감독 프로그램 커밋을 모으는 중(묶기) 문구("업데이트 대기(묶는 중, 남은 n분)"). 모으는 중이 아니면 null.
 *  모으는 동안은 일감을 막지 않는다. 시간이 다 되거나 공장이 비면 바로 받고, 통제실 [지금 업데이트]는 기다리지 않는다. */
export function bundleNote(leftMin: number | null | undefined): string | null {
  const m = Math.floor(Number(leftMin));

  return Number.isFinite(m) && m > 0 ? `업데이트 대기(묶는 중, 남은 ${m}분 · 그동안 일감은 계속 돌아요)` : null;
}

/** 서버 배포 중 표시 문구("배포 중 · 재전송 대기 N개"). 배포 중도 아니고 대기 보고도 없으면 null.
 *  배포 중에는 홈페이지가 3~5분 응답하지 않아, 그동안의 보고·로그·하트비트·완료 보고·스크린샷 등록은 감독 프로그램이 대기열에 쌓았다가
 *  홈페이지가 돌아오면 순서대로 다시 보낸다(N = 아직 못 보낸 개수). */
export function deployNote(deploying: boolean, outbox: number): string | null {
  const n = Math.max(0, Math.floor(outbox) || 0);

  if (deploying) return `배포 중 · 재전송 대기 ${n}개`;

  return n > 0 ? `재전송 대기 ${n}개(홈페이지가 돌아와서 순서대로 다시 보내는 중)` : null;
}
