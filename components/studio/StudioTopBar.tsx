// components/studio/StudioTopBar.tsx
// 공용 스튜디오 상단바(서버 컴포넌트): 로고 · 프로젝트 목록 · (관리자만) 통제실 · 사이트로. 통제실 상단바와 같은 모양(.fx-topbar).
import Link from "next/link";

import { resolveViewer } from "@/lib/studio/pageAccess";

export default async function StudioTopBar() {
  const viewer = await resolveViewer().catch(() => null);

  return (
    <header className="fx-topbar" data-studio-topbar>
      <Link aria-label="공용 스튜디오 프로젝트 목록" className="fx-topbar-brand" href="/studio">
        <span aria-hidden className="fx-ok">
          ●
        </span>
        STUDIO
      </Link>
      <nav aria-label="스튜디오 메뉴" className="fx-topbar-nav">
        <Link className="fx-topbar-link" href="/studio">
          프로젝트
        </Link>
        {viewer?.kind === "admin" ? (
          <Link className="fx-topbar-link" href="/admin/factory?tab=studio">
            통제실
          </Link>
        ) : null}
      </nav>
      <div className="fx-topbar-right">
        <Link className="fx-topbar-link" href="/">
          ↗ 사이트로
        </Link>
        {viewer?.kind === "admin" ? <span className="fx-topbar-account">{viewer.name}</span> : null}
      </div>
    </header>
  );
}
