"use client";

import NextLink from "next/link";
import {
  Image,
  Button,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownSection,
  Link,
  Skeleton,
} from "@heroui/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { toast } from "react-toastify";
import { UserCircleIcon } from "@heroicons/react/24/solid";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";

import { YouTubeIcon, DiscordIcon, GithubIcon, KakaoIcon } from "@/components/icons";
import { siteConfig } from "@/config/site";
import { ThemeSwitch } from "@/components/theme-switch";
import { useCachedSession } from "@/app/hooks/user/useCachedSession";
import { useIdleLogout } from "@/app/hooks/auth/useIdleLogout";

export default function NavBar() {
  const { session, isLoading, isAuthenticated, user, isSessionComplete } =
    useCachedSession();

  // 로그인 상태에서 비활동 감지 + 로그아웃까지 남은 시간
  const { remainingSeconds } = useIdleLogout();
  const idleCountdownLabel =
    remainingSeconds !== null
      ? `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(
        remainingSeconds % 60,
      ).padStart(2, "0")} 후 로그아웃`
      : null;

  const [path, setPath] = useState("/");
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setPath(pathname.split("/").slice(0, 2).join("/"));
    setMenuOpen(false); // 페이지 이동 시 모바일 메뉴 닫기
  }, [pathname]);

  const notifySuccessEvent = (msg: string) => toast.success(msg);
  const notifyFailedEvent = (msg: string) => toast.error(msg);

  const shouldShowLoading =
    isLoading || (isAuthenticated && !isSessionComplete);

  const handleLogOut = async () => {
    try {
      await signOut({
        redirect: false,
      });

      notifySuccessEvent("로그아웃 되었습니다.");
      router.push("/");
    } catch (error) {
      notifyFailedEvent("로그아웃 중 오류가 발생했습니다.");
      console.error("Logout error:", error);
    }
  };

  // 다른 컴퓨터에 로그인해 둔 것까지 전부 끊는다 (이 기기도 로그아웃됨)
  const handleLogOutAll = async () => {
    if (!window.confirm("모든 기기에서 로그아웃할까요? 이 기기도 로그아웃됩니다.")) return;
    try {
      const res = await fetch("/api/account/logout-all", { method: "POST" });
      if (!res.ok) throw new Error(`status ${res.status}`);

      await signOut({ redirect: false });
      notifySuccessEvent("모든 기기에서 로그아웃 되었습니다.");
      router.push("/");
    } catch (error) {
      notifyFailedEvent("모든 기기 로그아웃 중 오류가 발생했습니다.");
      console.error("Logout all error:", error);
    }
  };

  // 메뉴 강조: 첫 경로가 메뉴 주소이거나 그 메뉴에 묶인 주소(activePaths)면 켠다
  const isNavActive = (item: (typeof siteConfig.navItems)[number]) =>
    path === item.href || (item.activePaths ?? []).includes(path);

  // 관리자 드롭다운 항목 (PC·모바일 같은 목록: config/site.ts 의 adminNavItems)
  const adminDropdownItems =
    user?.role === "admin" ? (
      <DropdownSection key="admin" showDivider title="관리자">
        {siteConfig.adminNavItems.map((item) => (
          <DropdownItem
            key={item.key}
            textValue={item.label}
            onPress={() =>
              item.href.startsWith("/api/")
                ? window.location.assign(item.href)
                : router.push(item.href)
            }
          >
            <p>{item.label}</p>
          </DropdownItem>
        ))}
      </DropdownSection>
    ) : null;

  return (
    <div className="w-full max-w-[1400px] flex flex-col mt-2 md:mt-[20px] md:items-center justify-end md:justify-center">
      <div className="w-full">
        <div className="flex flex-row items-center justify-between w-full px-3 md:px-0 md:pr-4">
          <div className="flex flex-row items-center gap-6">
            <NextLink className="flex justify-start items-start" href="/">
              <Image
                alt="Branding Image"
                className="object-contain h-[40px] w-[110px] md:h-[50px] md:w-[180px] md:ms-[10px]"
                fallbackSrc="https://via.placeholder.com/300x200"
                height="50%"
                src="/brand.png"
                width="100%"
              />
            </NextLink>

            {/* PC 네비게이션 */}
            <ul className="hidden md:flex gap-6 justify-start items-center">
              {siteConfig.navItems.map((item, index) => (
                <li
                  key={index}
                  className="text-medium whitespace-nowrap box-border list-none"
                >
                  <a
                    className="relative inline-flex items-center tap-highlight-transparent outline-none
                      text-xl text-slate-500 font-semibold
                      hover:opacity-80 hover:text-slate-100
                      active:opacity-disabled transition-opacity
                      data-[active=true]:text-[#0072F5]
                      data-[active=true]:dark:text-[#0072F5]"
                    data-active={isNavActive(item)}
                    href={item.href}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* 모바일: 테마 전환 + 햄버거 */}
          <div className="flex md:hidden items-center gap-1">
            <ThemeSwitch />
            <button
              aria-controls="mobile-menu"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"}
              className="flex items-center justify-center w-11 h-11 rounded-lg bg-transparent border-none cursor-pointer active:bg-gray-100 dark:active:bg-gray-800"
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? (
                <XMarkIcon className="w-6 h-6" />
              ) : (
                <Bars3Icon className="w-6 h-6" />
              )}
            </button>
          </div>

          {/* 데스크톱 로그인 영역 */}
          <div className="hidden md:flex md:items-center md:gap-8 md:flex-row">
            <div className="hidden md:flex md:items-center md:gap-5">
              <div className="flex flex-row gap-3">
                {shouldShowLoading ? (
                  <div>
                    <Skeleton className="flex rounded-[5px] w-[100px] h-12" />
                  </div>
                ) : !isAuthenticated ? (
                  <div className="flex flex-row gap-3">
                    {path !== "/signup" && (
                      <Link
                        className="text-white no-underline font-sans"
                        href="/signup"
                      >
                        <Button variant="ghost">회원가입</Button>
                      </Link>
                    )}
                    <Link
                      className="text-white no-underline font-sans"
                      href="/signin"
                    >
                      <Button variant="ghost">로그인</Button>
                    </Link>
                  </div>
                ) : (
                  <div>
                    <Dropdown placement="bottom-end">
                      <DropdownTrigger>
                        <div className="flex w-[150px] items-center justify-center bg-transparent cursor-pointer">
                          <UserCircleIcon className="w-6 h-6" />
                          <div className="flex flex-col items-start px-1 py-1 max-w-[110px]">
                            <p className="inline-block text-black dark:text-white bg-transparent truncate w-full">
                              {user?.name}
                            </p>
                            {idleCountdownLabel && (
                              <p className="text-[10px] leading-tight text-red-500 whitespace-nowrap">
                                {idleCountdownLabel}
                              </p>
                            )}
                          </div>
                        </div>
                      </DropdownTrigger>
                      <DropdownMenu aria-label="Profile Actions" variant="flat">
                        <DropdownItem
                          key="profile"
                          textValue={`${user?.email}`}
                        >
                          <p>로그인 정보</p>
                          <p>{user?.email}</p>
                        </DropdownItem>

                        {adminDropdownItems}

                        <DropdownItem
                          key="logoutAll"
                          color="danger"
                          textValue="Log Out All"
                          onPress={handleLogOutAll}
                        >
                          모든 기기에서 로그아웃
                        </DropdownItem>

                        <DropdownItem
                          key="logout"
                          color="danger"
                          textValue="Log Out"
                          onPress={handleLogOut}
                        >
                          Log Out
                        </DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  </div>
                )}
              </div>

              {/* 소셜 아이콘들 - 카카오톡 추가 */}
              <div className="flex flex-row gap-3">
                <Link
                  href={siteConfig.links.github}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <GithubIcon className="w-6 h-6 text-gray-500" />
                </Link>
                <Link
                  href={siteConfig.links.youtube}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <YouTubeIcon className="w-6 h-6 text-red-600" />
                </Link>
                <Link
                  href={siteConfig.links.discord}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <DiscordIcon className="w-6 h-6 text-[#5865F2]" />
                </Link>
                {/* 🔥 카카오톡 아이콘 추가 */}
                <Link
                  href={siteConfig.links.kakao}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <KakaoIcon className="w-6 h-6" />
                </Link>
                <ThemeSwitch />
              </div>
            </div>
          </div>
        </div>

        {/* 모바일 드롭다운 메뉴 */}
        {menuOpen && (
          <div
            className="md:hidden border-t border-gray-200 dark:border-gray-700 px-3 pb-3"
            id="mobile-menu"
          >
            <ul className="flex flex-col py-2">
              {siteConfig.navItems.map((item) => (
                <li key={item.href} className="list-none">
                  <NextLink
                    className="flex items-center min-h-[44px] px-2 rounded-lg text-base font-semibold
                      text-slate-600 dark:text-slate-300
                      active:bg-gray-100 dark:active:bg-gray-800
                      data-[active=true]:text-[#0072F5]"
                    data-active={isNavActive(item)}
                    href={item.href}
                  >
                    {item.label}
                  </NextLink>
                </li>
              ))}
            </ul>

            {/* 모바일 로그인 + 소셜 */}
            <div className="flex flex-row items-center justify-between w-full pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex flex-row gap-2">
                {shouldShowLoading ? (
                  <div>
                    <Skeleton className="flex rounded-[5px] w-[80px] h-8" />
                  </div>
                ) : !isAuthenticated ? (
                  <div className="flex flex-row gap-2">
                    {path !== "/signup" && (
                      <Link
                        className="text-white no-underline font-sans"
                        href="/signup"
                      >
                        <Button size="sm" variant="ghost">
                          회원가입
                        </Button>
                      </Link>
                    )}
                    <Link
                      className="text-white no-underline font-sans"
                      href="/signin"
                    >
                      <Button size="sm" variant="ghost">
                        로그인
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <Dropdown placement="bottom-start">
                    <DropdownTrigger>
                      <div className="flex items-center gap-2 bg-transparent cursor-pointer">
                        <UserCircleIcon className="w-5 h-5" />
                        <div className="flex flex-col items-start max-w-[90px]">
                          <p className="text-sm truncate w-full">
                            {user?.name}
                          </p>
                          {idleCountdownLabel && (
                            <p className="text-[10px] leading-tight text-red-500 whitespace-nowrap">
                              {idleCountdownLabel}
                            </p>
                          )}
                        </div>
                      </div>
                    </DropdownTrigger>
                    <DropdownMenu aria-label="Profile Actions" variant="flat">
                      <DropdownItem key="profile" textValue={`${user?.email}`}>
                        <p>로그인 정보</p>
                        <p className="text-xs">{user?.email}</p>
                      </DropdownItem>

                      {adminDropdownItems}

                      <DropdownItem
                        key="logoutAll"
                        color="danger"
                        textValue="Log Out All"
                        onClick={handleLogOutAll}
                      >
                        모든 기기에서 로그아웃
                      </DropdownItem>

                      <DropdownItem
                        key="logout"
                        color="danger"
                        textValue="Log Out"
                        onClick={handleLogOut}
                      >
                        Log Out
                      </DropdownItem>
                    </DropdownMenu>
                  </Dropdown>
                )}
              </div>

              {/* 모바일 소셜 아이콘 - 카카오톡 추가 */}
              <div className="flex flex-row gap-3">
                <Link
                  href={siteConfig.links.github}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <GithubIcon className="w-5 h-5 text-gray-500" />
                </Link>
                <Link
                  href={siteConfig.links.youtube}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <YouTubeIcon className="w-5 h-5 text-red-600" />
                </Link>
                <Link
                  href={siteConfig.links.discord}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <DiscordIcon className="w-5 h-5 text-[#5865F2]" />
                </Link>
                {/* 🔥 카카오톡 아이콘 추가 */}
                <Link
                  href={siteConfig.links.kakao}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <KakaoIcon className="w-5 h-5" />
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}