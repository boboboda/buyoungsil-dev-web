// components/studio/ProjectList.tsx
// /studio 첫 화면의 프로젝트 목록(서버 컴포넌트). 스튜디오 분류(게임·앱·미분류)별로 묶고, 프로젝트마다 카드 수·검수 대기·최근 생성·비용(최근 30일 PixelLab 호출 수)을 보여 준다.
import Link from "next/link";

import { shortDate, USAGE_DAYS, type OverviewRow } from "@/lib/studio/dashboard";

const GROUPS = [
  { kind: "game", label: "게임" },
  { kind: "app", label: "앱" },
  { kind: "none", label: "미분류" },
] as const;

export default function ProjectList({ rows, toolApps }: { rows: readonly OverviewRow[]; toolApps: readonly string[] }) {
  return (
    <div className="space-y-4" data-studio-projects>
      {GROUPS.map((g) => {
        const list = rows.filter((r) => r.kind === g.kind);

        if (!list.length) return null;

        return (
          <section key={g.kind} className="fx-panel min-w-0 space-y-2 p-3" data-studio-group={g.kind}>
            <h2 className="fx-label">
              {g.label} ({list.length})
            </h2>
            <ul className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((r) => (
                <li key={r.appSlug} className="min-w-0">
                  <Link className="block min-w-0 rounded border border-default-300 p-3 hover:border-default-600" data-studio-project={r.appSlug} href={`/studio/${r.appSlug}`}>
                    <span className="block font-semibold">{r.title}</span>
                    <span className="block text-xs fx-muted font-mono">{r.appSlug}</span>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      <dt className="fx-muted">카드</dt>
                      <dd data-field="cards">
                        {r.cardCount}장{r.cardCount !== r.enabledCards ? ` (켜짐 ${r.enabledCards})` : ""}
                      </dd>
                      <dt className="fx-muted">검수 대기</dt>
                      <dd className={r.pendingReview ? "fx-warn" : ""} data-field="pending">
                        {r.pendingReview}장
                      </dd>
                      <dt className="fx-muted">최근 생성</dt>
                      <dd data-field="last">{shortDate(r.lastGeneratedAt)}</dd>
                      <dt className="fx-muted">비용({USAGE_DAYS}일)</dt>
                      <dd data-field="cost">{r.cost30d ? `PixelLab ${r.cost30d}회` : "없음"}</dd>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!rows.length ? (
        <p className="fx-panel p-3 text-sm fx-muted" role="status">
          아직 프로젝트가 없어요. 통제실에서 앱 일감을 만들면 여기에 나와요.
        </p>
      ) : null}
      {toolApps.length ? (
        <p className="text-sm fx-muted" data-studio-toolapps>
          도구·플랫폼(목록에서 접음): {toolApps.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
