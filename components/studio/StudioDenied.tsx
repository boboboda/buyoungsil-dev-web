// components/studio/StudioDenied.tsx
// 공용 스튜디오 접근 거부 화면. 이유(로그인 없음/키 틀림 등)는 구별해 알려 주지 않는다.
import Link from "next/link";

export default function StudioDenied({ app }: { app?: string }) {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-3 p-4" data-studio-denied>
      <section className="fx-panel space-y-2 p-4" role="alert">
        <h1 className="fx-label">접근할 수 없어요</h1>
        <p className="text-sm">공용 스튜디오는 관리자 로그인 또는 Studio 접근 키가 있어야 열려요{app ? ` (이 화면은 ${app} 키만 열 수 있어요)` : " (프로젝트 목록은 관리자만 열 수 있어요)"}.</p>
        <p className="text-sm fx-muted">키는 통제실 설정의 &apos;Studio 접근 키&apos;에서 발급해요. 키 값은 이 화면에 나오지 않아요.</p>
        <Link className="fx-btn fx-btn-sm inline-block" href="/signin">
          로그인
        </Link>
      </section>
    </main>
  );
}
