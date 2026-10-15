// components/admin/ui/AdminTopBar.tsx
// 관리자 콘솔 상단바(모든 /admin 화면, 위에 붙어 따라옴): ● ADMIN · 관리자 메뉴(지금 위치 강조) · 사이트로 · 현재 시각 · 계정/로그아웃.
// 공개 사이트 네비바는 /admin 에서 숨기므로(components/main/PublicChromeOnly) 비활동 자동 로그아웃 훅도 여기서 이어서 건다.
// 좁은 화면: 첫 줄은 로고·시각·계정, 둘째 줄은 메뉴 가로 스크롤.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";

import { useIdleLogout } from "@/app/hooks/auth/useIdleLogout";
import { hhmmKst } from "@/components/admin/ui/meters";
import { siteConfig } from "@/config/site";

export interface AdminNavItem {
  key: string;
  short: string;
  href: string;
  /** 링크 주소와 "지금 위치" 판정 주소가 다를 때(통제실 로그인 넘김 링크) */
  activeHref?: string;
}

/** 상단바 메뉴: adminNavItems + 콘솔 전용 메뉴를 adminConsoleNavOrder 순서로 */
export function adminNavList(): AdminNavItem[] {
  const all = [
    ...siteConfig.adminNavItems,
    ...siteConfig.adminConsoleExtraNavItems,
  ];
  const order: string[] = siteConfig.adminConsoleNavOrder;
  const rank = (k: string) =>
    order.includes(k) ? order.indexOf(k) : order.length;

  return [...all]
    .sort((a, b) => rank(a.key) - rank(b.key))
    .map((item) => ({
      key: item.key,
      short: item.short,
      href: item.href,
      ...("activeHref" in item ? { activeHref: item.activeHref as string } : {}),
    }));
}

/** 지금 화면이 이 메뉴 소속인지. 대시보드(/admin)는 정확히 같을 때만 */
export function isAdminNavActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === "/admin") return pathname === "/admin";

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminTopBarView({
  pathname,
  clock,
  account,
  idleText,
  onLogout,
}: {
  pathname: string | null;
  clock: string;
  account: string | null;
  idleText?: string | null;
  onLogout?: () => void;
}) {
  return (
    <header className="fx-topbar">
      <Link aria-label="관리자 대시보드" className="fx-topbar-brand" href="/admin">
        <span aria-hidden className="fx-ok">
          ●
        </span>
        ADMIN
      </Link>
      <nav aria-label="관리자 메뉴" className="fx-topbar-nav">
        {adminNavList().map((item) =>
          item.href.startsWith("/api/") ? (
            // 통제실로 넘기는 로그인 주소: 페이지가 아니라 서버 리다이렉트라 일반 링크로 연다
            <a
              key={item.key}
              aria-current={isAdminNavActive(pathname, item.activeHref ?? item.href) ? "page" : undefined}
              className="fx-topbar-link"
              href={item.href}
            >
              {item.short}
            </a>
          ) : (
            <Link
              key={item.key}
              aria-current={isAdminNavActive(pathname, item.activeHref ?? item.href) ? "page" : undefined}
              className="fx-topbar-link"
              href={item.href}
            >
              {item.short}
            </Link>
          ),
        )}
      </nav>
      <div className="fx-topbar-right">
        <Link className="fx-topbar-link" href="/">
          ↗ 사이트로
        </Link>
        <span className="fx-topbar-clock font-mono" title="한국 시간">
          {clock}
        </span>
        {idleText ? <span className="fx-warn">▲ {idleText}</span> : null}
        {account ? (
          <span className="fx-topbar-account" title={account}>
            {account}
          </span>
        ) : null}
        <button className="fx-btn fx-btn-sm" type="button" onClick={onLogout}>
          로그아웃
        </button>
      </div>
    </header>
  );
}

export default function AdminTopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { remainingSeconds } = useIdleLogout();
  // 서버 HTML 과 어긋나지 않게 시각은 화면에 붙은 뒤부터
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 10_000);

    return () => clearInterval(id);
  }, []);

  const idleText =
    remainingSeconds !== null
      ? `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(
          remainingSeconds % 60,
        ).padStart(2, "0")} 후 로그아웃`
      : null;

  const logout = async () => {
    await signOut({ redirect: false });
    router.push("/");
  };

  return (
    <AdminTopBarView
      account={session?.user?.name ?? session?.user?.email ?? null}
      clock={now === null ? "--:--" : hhmmKst(now)}
      idleText={idleText}
      pathname={pathname}
      onLogout={logout}
    />
  );
}
