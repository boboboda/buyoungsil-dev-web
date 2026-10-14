// app/studio/[app]/page.tsx
// 공용 스튜디오 프로젝트 화면: 탭 [구성] [제작] [운영]. [구성](3-1)·[제작](3-2)·[운영](3-3: 검수함·보관함·생성 일정·서비스 운영·내보내기, 하위 메뉴는 프로젝트 연결 설정의 기능 스위치를 따른다).
// 접근: 관리자 또는 이 앱의 Studio 접근 키(읽기 전용). 안 되면 같은 거부 화면.
import Link from "next/link";

import { readStudioProject, type StudioProjectData } from "@/lib/studio/data";
import { parseStudioTab, STUDIO_TABS, visibleOpsMenu } from "@/lib/studio/dashboard";
import { resolveViewer } from "@/lib/studio/pageAccess";
import { readMakeData, type MakeData } from "@/lib/studio/makeData";
import { readLayoutData, type LayoutData } from "@/lib/studio/layoutData";
import { readOpsData, tickSchedules, type OpsData } from "@/lib/studio/opsData";
import ConfigTab from "@/components/studio/ConfigTab";
import MakeTab from "@/components/studio/MakeTab";
import OpsTab from "@/components/studio/OpsTab";
import StudioDenied from "@/components/studio/StudioDenied";

export const dynamic = "force-dynamic";

type Params = { app: string };
type Search = { tab?: string | string[]; sub?: string | string[]; art?: string | string[] };

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
  let make: MakeData | null = null;

  if (tab === "make") {
    try {
      make = await readMakeData(app);
    } catch (error) {
      console.error("[studio] 제작 자료 읽기 실패:", error instanceof Error ? error.name : "unknown");
    }
  }
  let layout: LayoutData | null = null;

  if (tab === "make" && flags.studioBatch && sub === "batch") {
    try {
      layout = await readLayoutData(app);
    } catch (error) {
      console.error("[studio] 배치 자료 읽기 실패:", error instanceof Error ? error.name : "unknown");
    }
  }
  const opsNow = ops.find((o) => o.key === sub) ?? ops[0];
  const art = Array.isArray(search.art) ? search.art[0] : search.art;
  let opsData: OpsData | null = null;

  if (tab === "ops") {
    if (viewer.kind === "admin") void tickSchedules(); // 열 때도 한 번 확인(1분에 한 번만)
    try {
      opsData = await readOpsData(app);
    } catch (error) {
      console.error("[studio] 운영 자료 읽기 실패:", error instanceof Error ? error.name : "unknown");
    }
  }

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
        make ? (
          <MakeTab canEdit={viewer.kind === "admin"} data={make} layout={layout} showBatch={flags.studioBatch} sub={sub} />
        ) : (
          <p className="fx-panel p-3 text-sm fx-muted" data-make-failed role="status">
            ○ 확인 못 함 — 제작 자료를 읽지 못했어요. 잠시 뒤 다시 열어 주세요.
          </p>
        )
      ) : null}
      {tab === "ops" ? (
        <section className="fx-panel min-w-0 space-y-3 p-4" data-studio-ops>
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
          {opsData && opsNow ? (
            <OpsTab canEdit={viewer.kind === "admin"} data={opsData} focusArt={art} sub={opsNow.key} />
          ) : (
            <p className="text-sm fx-muted" data-ops-failed role="status">
              ○ 확인 못 함 — 운영 자료를 읽지 못했어요. 잠시 뒤 다시 열어 주세요.
            </p>
          )}
          {ops.length < 5 ? <p className="text-xs fx-muted">꺼진 기능의 메뉴는 숨겨요. 켜려면 구성 탭이 아니라 통제실의 프로젝트 연결 설정(스튜디오 기능)에서 바꿔요.</p> : null}
        </section>
      ) : null}
    </main>
  );
}
