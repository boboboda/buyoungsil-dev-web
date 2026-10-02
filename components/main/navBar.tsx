"use client";

import NextLink from "next/link";
import {
  Image,
  Button,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Link,
  Skeleton,
} from "@heroui/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { toast } from "react-toastify";
import { UserCircleIcon } from "@heroicons/react/24/solid";

import { YouTubeIcon, DiscordIcon, GithubIcon, KakaoIcon } from "@/components/icons";
import { siteConfig } from "@/config/site";
import { ThemeSwitch } from "@/components/theme-switch";
import { useModalStore } from "@/store/sponsorStore";
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
  const pathname = usePathname();
  const router = useRouter();

  const { openSponsorModal } = useModalStore((state) => state);

  useEffect(() => {
    console.log("Current pathname:", pathname);
    setPath(pathname.split("/").slice(0, 2).join("/"));
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

  return (
    <div className="w-full max-w-[1400px] flex flex-col mt-[20px] md:items-center justify-end md:justify-center">
      <div className="w-full">
        <div className="flex flex-row items-center justify-between w-full mb-2 md:mb-0 pr-4">
          <div className="flex flex-row items-center gap-6">
            <NextLink className="flex justify-start items-start" href="/">
              <Image
                alt="Branding Image"
                className="object-contain h-[50px] md:w-[180px] ms-[10px] w-[120px]"
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
                    data-active={path === item.href ? true : false}
                    href={item.href}
                  >
                    {item.label}
                  </a>
                </li>
              ))}

              <button
                className="relative inline-flex items-center tap-highlight-transparent outline-none
                  text-xl text-slate-500 font-semibold
                  hover:opacity-80 hover:text-slate-100
                  active:opacity-disabled transition-opacity cursor-pointer
                  bg-transparent border-none p-0 font-inherit"
                onClick={openSponsorModal}
              >
                후원
              </button>
            </ul>
          </div>

          {/* 모바일 네비게이션 */}
          <div className="md:hidden">
            <ul className="flex gap-4 justify-start items-center">
              {siteConfig.navItems.map((item, index) => (
                <li
                  key={index}
                  className="text-medium whitespace-nowrap box-border list-none"
                >
                  <a
                    className="relative inline-flex items-center tap-highlight-transparent outline-none
                      text-[13px] text-slate-500 font-semibold
                      hover:opacity-80 hover:text-slate-100
                      active:opacity-disabled transition-opacity
                      data-[active=true]:text-[#0072F5]
                      data-[active=true]:dark:text-[#0072F5]"
                    data-active={path === item.href ? true : false}
                    href={item.href}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
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
                        <Button variant="ghost">Sign Up</Button>
                      </Link>
                    )}
                    <Link
                      className="text-white no-underline font-sans"
                      href="/signin"
                    >
                      <Button variant="ghost">Sign In</Button>
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

                        {user?.role === "admin" ? (
                          <>
                            <DropdownItem
                              key="adminDashboard"
                              textValue="adminDashboard"
                              onClick={() => router.push("/admin")}
                            >
                              <p>📊 관리자 대시보드</p>
                            </DropdownItem>

                            <DropdownItem
                              key="adminProjects"
                              textValue="adminProjects"
                              onClick={() => router.push("/admin/projects")}
                            >
                              <p>💼 프로젝트 관리</p>
                            </DropdownItem>

                            <DropdownItem
                              key="adminNotes"
                              textValue="adminNotes"
                              onClick={() => router.push("/admin/notes")}
                            >
                              <p>📚 개발노트 관리</p>
                            </DropdownItem>

                            <DropdownItem
                              key="adminCategories"
                              textValue="adminCategories"
                              onClick={() => router.push("/admin/categories")}
                            >
                              <p>🏷️ 카테고리 관리</p>
                            </DropdownItem>

                            <DropdownItem
                              key="adminStories"
                              textValue="adminStories"
                              onClick={() => router.push("/admin/stories")}
                            >
                              <p>😅 스토리 관리</p>
                            </DropdownItem>

                            {/* 🔥 외주 관리 추가 */}
                            <DropdownItem
                              key="adminWorks"
                              textValue="adminWorks"
                              onClick={() => router.push("/admin/works")}
                            >
                              <p>💻 외주 신청 관리</p>
                            </DropdownItem>

                            <DropdownItem
                              key="adminLogs"
                              textValue="adminLogs"
                              onClick={() => router.push("/admin/logs/create")}
                            >
                              <p>📋 개발 로그 작성</p>
                            </DropdownItem>

                            <DropdownItem
                              key="adminRevenues"
                              textValue="adminRevenues"
                              onClick={() => router.push("/admin/revenues/create")}
                            >
                              <p>💰 수익 데이터 입력</p>
                            </DropdownItem>
                          </>
                        ) : null}

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
                  <DiscordIcon className="w-6 h-6" />
                </Link>
                {/* 🔥 카카오톡 아이콘 추가 */}
                <Link
                  href={siteConfig.links.kakao}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <KakaoIcon className="w-6 h-6 text-yellow-500" />
                </Link>
                <ThemeSwitch />
              </div>
            </div>
          </div>
        </div>

        {/* 모바일 로그인 영역 */}
        <div className="flex md:hidden flex-row items-center justify-between w-full pt-2 border-t border-gray-200 dark:border-gray-700 pr-4">
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
                      Sign Up
                    </Button>
                  </Link>
                )}
                <Link
                  className="text-white no-underline font-sans"
                  href="/signin"
                >
                  <Button size="sm" variant="ghost">
                    Sign In
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

                  {user?.role === "admin" ? (
                    <>
                      <DropdownItem
                        key="adminDashboard"
                        textValue="adminDashboard"
                        onClick={() => router.push("/admin")}
                      >
                        <p>📊 대시보드</p>
                      </DropdownItem>

                      <DropdownItem
                        key="adminAnalytics"
                        textValue="adminAnalytics"
                        onClick={() => router.push("/admin/analytics")}
                      >
                        <p>📈 앱 분석</p>
                      </DropdownItem>

                      {/* 🔥 외주 관리 추가 */}
                      <DropdownItem
                        key="adminWorks"
                        textValue="adminWorks"
                        onClick={() => router.push("/admin/works")}
                      >
                        <p>💻 외주 관리</p>
                      </DropdownItem>

                      <DropdownItem
                        key="adminWrite"
                        textValue="adminWrite"
                        onClick={() => router.push("/admin/write")}
                      >
                        <p>개발노트 쓰기</p>
                      </DropdownItem>
                    </>
                  ) : null}

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
              <DiscordIcon className="w-5 h-5" />
            </Link>
            {/* 🔥 카카오톡 아이콘 추가 */}
            <Link
              href={siteConfig.links.kakao}
              rel="noopener noreferrer"
              target="_blank"
            >
              <KakaoIcon className="w-5 h-5 text-yellow-500" />
            </Link>
            <ThemeSwitch />
          </div>
        </div>
      </div>
    </div>
  );
}