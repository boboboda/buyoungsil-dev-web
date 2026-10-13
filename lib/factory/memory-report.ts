// lib/factory/memory-report.ts
// 감독 프로그램이 /next 로 알려 주는 작업 메모리 상태(폴더별 "폴더|갱신시각|KB|푸시|정리필요" 를 ; 로 이은 글)를 통제실 표시용으로 푼다.
// 크기·시각·상태만 있다(요약 본문은 오지 않는다).
export type MemoryPush = "ok" | "failed" | "none" | "blocked";

export interface MemoryRow {
  folder: string;
  updatedAt: string;
  kb: number;
  push: MemoryPush;
  needsCompact: boolean;
}

export const MEMORY_PUSH_LABEL: Record<MemoryPush, string> = {
  ok: "서버2 푸시 성공",
  failed: "서버2 푸시 실패(다음 일감 때 다시 시도)",
  none: "원격 미설정(로컬에만 저장)",
  blocked: "푸시 거부(GitHub 주소는 쓸 수 없어요)",
};

export function parseMemoryReport(v: unknown): MemoryRow[] {
  if (typeof v !== "string") return [];

  return v
    .split(";")
    .flatMap((row): MemoryRow[] => {
      const [folder, updatedAt, kb, push, compact] = row.split("|");

      if (!folder || !updatedAt || !(push === "ok" || push === "failed" || push === "none" || push === "blocked")) return [];

      return [{ folder, updatedAt, kb: Number(kb) || 0, push, needsCompact: compact === "1" }];
    })
    .slice(0, 12);
}
