// app/studio/[app]/page.tsx
// 공용 스튜디오 프로젝트 화면: 탭 [구성] [제작] [운영]. 이번에는 [구성]만 채우고 [제작]·[운영]은 '준비 중' 자리(운영 하위 메뉴는 프로젝트 연결 설정의 기능 스위치를 따른다).
// 접근: 관리자 또는 이 앱의 Studio 접근 키(읽기 전용). 안 되면 같은 거부 화면.
import Link from "next/link";

import { readStudioProject, type StudioProjectData } from "@/lib/studio/data";
import { parseStudioTab, STUDIO_TABS, visibleOpsMenu } from "@/lib/studio/dashboard";
import { resolveViewer } from "@/lib/studio/pageAccess";
import ConfigTab from "@/components/studio/ConfigTab";
import StudioDenied from "@/components/studio/StudioDenied";

export const dynamic = "force-dynamic";

type Params = { app: string };
type Search = { tab?: string | string[]; sub?: string | string[] };

export default async function StudioProjectPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const { app } = await params;
  const search = await searchParams;
  const viewer = await resolveViewer(app);

  if (!viewer) return <StudioDenied app={app} />;
  const tab = parseStudioTab(search.tab);
  let data: StudioProjectData | null = null;
  let failed = false;

  try {
    data = await readStudioProject(app);
  } catch (error) {
    failed = true;
    console.error("[studio] 프로젝트 자료 읽기 실패:", error instanceof Error ? error.name : "unknown");
  }
  if (!data) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-3 p-4">
        <p className="fx-panel p-3 text-sm fx-muted" role="status">
          {failed ? "○ 확인 못 함 — 프로젝트 자료를 읽지 못했어요. 잠시 뒤 다시 열어 주세요." : "홈페이지가 모르는 프로젝트예요."}
        </p>
        {viewer.kind === "admin" ? (
          <Link className="fx-btn fx-btn-sm inline-block" href="/studio">
            프로젝트 목록
          </Link>
        ) : null}
      </main>
    );
  }
  const flags = { studioBatch: data.link?.studioBatch ?? false, studioService: data.link?.studioService ?? false };
  const ops = visibleOpsMenu(flags);
  const sub = Array.isArray(search.sub) ? search.sub[0] : search.sub;
  const opsNow = ops.find((o) => o.key === sub) ?? ops[0];

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 space-y-3 p-3 sm:p-4" data-studio-app={data.appSlug}>
      <header className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        {viewer.kind === "admin" ? (
          <Link className="text-sm fx-muted" href="/studio">
            ← 프로젝트
          </Link>
        ) : null}
        <h1 className="min-w-0 text-lg font-bold">{data.title}</h1>
        <span className="text-sm fx-muted font-mono">
          {data.appSlug} · {data.kindLabel}
        </span>
        {viewer.kind === "key" ? <span className="fx-st fx-st-info">읽기 전용</span> : null}
      </header>
      <nav aria-label="스튜디오 탭" className="flex gap-1 border-b border-default-300" data-studio-tabs>
        {STUDIO_TABS.map((t) => (
          <Link
            key={t.key}
            aria-current={t.key === tab ? "page" : undefined}
            className={`px-4 py-2 text-sm ${t.key === tab ? "border-b-2 border-default-700 font-bold" : "fx-muted"}`}
            data-studio-tab={t.key}
            href={`/studio/${data.appSlug}?tab=${t.key}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "config" ? <ConfigTab canEdit={viewer.kind === "admin"} data={data} /> : null}
      {tab === "make" ? (
        <section className="fx-panel space-y-1 p-4" data-studio-pending="make">
          <h2 className="fx-label">제작</h2>
          <p className="text-sm fx-muted">준비 중이에요. 카드를 골라 생성하는 화면이 여기에 들어와요. 지금은 통제실의 &quot;카드로 바로 만들기&quot;를 쓰세요.</p>
        </section>
      ) : null}
      {tab === "ops" ? (
        <section className="fx-panel min-w-0 space-y-2 p-4" data-studio-pending="ops">
          <h2 className="fx-label">운영</h2>
          <ul aria-label="운영 하위 메뉴" className="flex flex-wrap gap-2" data-ops-menu>
            {ops.map((o) => (
              <li key={o.key}>
                <Link
                  aria-current={o.key === opsNow?.key ? "page" : undefined}
                  className={`rounded border px-3 py-1 text-sm ${o.key === opsNow?.key ? "border-default-700 font-bold" : "border-default-300"}`}
                  data-ops-item={o.key}
                  href={`/studio/${data.appSlug}?tab=ops&sub=${o.key}`}
                >
                  {o.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-sm fx-muted">{opsNow?.label} — 준비 중이에요.</p>
          {ops.length < 4 ? <p className="text-xs fx-muted">꺼진 기능의 메뉴는 숨겨요. 켜려면 구성 탭이 아니라 통제실의 프로젝트 연결 설정(스튜디오 기능)에서 바꿔요.</p> : null}
        </section>
      ) : null}
    </main>
  );
}
