// app/studio/page.tsx
// 공용 스튜디오 첫 화면: 프로젝트 목록(분류별). 관리자만(Studio 접근 키는 앱 하나만 열 수 있어서 목록은 못 본다).
import { readStudioOverview, type StudioOverview } from "@/lib/studio/data";
import { resolveViewer } from "@/lib/studio/pageAccess";
import ProjectList from "@/components/studio/ProjectList";
import StudioDenied from "@/components/studio/StudioDenied";

export const dynamic = "force-dynamic";

export default async function StudioHome() {
  const viewer = await resolveViewer();

  if (!viewer) return <StudioDenied />;
  let overview: StudioOverview | null = null;

  try {
    overview = await readStudioOverview();
  } catch (error) {
    console.error("[studio] 프로젝트 목록 읽기 실패:", error instanceof Error ? error.name : "unknown");
  }

  return (
    <main className="mx-auto w-full max-w-6xl min-w-0 space-y-4 p-3 sm:p-4">
      <header className="space-y-1">
        <h1 className="text-lg font-bold">공용 스튜디오</h1>
        <p className="text-sm fx-muted">모든 프로젝트가 같이 쓰는 스튜디오예요. 관리는 여기서, 실행과 키는 공장(통제실)에서 해요. 키 값은 이 화면에 나오지 않아요.</p>
      </header>
      {overview ? (
        <ProjectList rows={overview.rows} toolApps={overview.toolApps} />
      ) : (
        <p className="fx-panel p-3 text-sm fx-muted" role="status">
          ○ 확인 못 함 — 프로젝트 목록을 읽지 못했어요. 잠시 뒤 다시 열어 주세요.
        </p>
      )}
    </main>
  );
}
