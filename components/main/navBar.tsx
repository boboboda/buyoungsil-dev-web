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

import { YouTubeIcon, DiscordIcon, GithubIcon } from "@/components/icons";
import { siteConfig } from "@/config/site";
import { ThemeSwitch } from "@/components/theme-switch";
import { useModalStore } from "@/store/sponsorStore";
import { useCachedSession } from "@/app/hooks/user/useCachedSession";

export default function NavBar() {
  // 🔥 캐시된 세션 사용
  const { session, isLoading, isAuthenticated, user, isSessionComplete } =
    useCachedSession();

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

  // 🔥 role이 로드되지 않았으면 로딩 표시
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
      {/* 데스크톱: 한 줄, 모바일: 두 줄 */}
      <div className="w-full">
        {/* 첫 번째 줄: 브랜드 + 네비게이션 메뉴 */}
        <div className="flex flex-row items-center justify-between w-full mb-2 md:mb-0 pr-4">
          {/* 브랜드 로고 + PC에서 네비게이션 메뉴 */}
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

            {/* PC에서만 브랜드 옆에 네비게이션 메뉴 표시 */}
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

          {/* 모바일에서만 네비게이션 메뉴 표시 */}
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

          {/* 데스크톱: 로그인 + 아이콘 영역 */}
          <div className="hidden md:flex md:items-center md:gap-8 md:flex-row">
            <div className="hidden md:flex md:items-center md:gap-5">
              {/* 🔥 수정된 로그인 영역 */}
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
                          <p className="inline-block max-w-[100px] px-1 py-1 text-black dark:text-white bg-transparent truncate">
                            {user?.name}
                          </p>
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
                        {/* 🔥 role 체크 개선 */}
                        {user?.role === "admin" ? (
                          <>
                            <DropdownItem
                              key="resister"
                              textValue="resister"
                              onClick={() => router.push("/admin/register")}
                            >
                              <p>앱 등록</p>
                            </DropdownItem>
                            <DropdownItem
                              key="adminWrite"
                              textValue="adminWrite"
                              onClick={() => router.push("/admin/write")}
                            >
                              <p>개발노트 쓰기</p>
                            </DropdownItem>
                            <DropdownItem
                              key="adminNoteList"
                              textValue="adminNoteList"
                              onClick={() => router.push("/admin/list")}
                            >
                              <p>개발노트 리스트 관리</p>
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

              {/* 소셜 아이콘들 */}
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
                <ThemeSwitch />
              </div>
            </div>
          </div>
        </div>

        {/* 두 번째 줄: 모바일에서만 표시되는 로그인 + 아이콘 영역 */}
        <div className="flex md:hidden flex-row items-center justify-between w-full pt-2 border-t border-gray-200 dark:border-gray-700 pr-4">
          {/* 🔥 모바일 로그인 영역 */}
          <div className="flex flex-row gap-2">
            {shouldShowLoading ? (
              <div>
                <Skeleton className="flex rounded-[5px] w-[80px] h-8" />
              </div>
            ) : !isAuthenticated ? (
              <div className="flex flex-row gap-2 pl-3">
                {path !== "/signup" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => router.push("/signup")}
                  >
                    Sign Up
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => router.push("/signin")}
                >
                  Sign In
                </Button>
              </div>
            ) : (
              <div>
                <Dropdown placement="bottom-end">
                  <DropdownTrigger>
                    <div className="flex w-[120px] items-center justify-center bg-transparent cursor-pointer">
                      <UserCircleIcon className="w-5 h-5" />
                      <p className="inline-block max-w-[80px] px-1 py-1 text-black dark:text-white bg-transparent truncate text-sm">
                        {user?.name}
                      </p>
                    </div>
                  </DropdownTrigger>
                  <DropdownMenu aria-label="Profile Actions" variant="flat">
                    <DropdownItem key="profile" textValue={`${user?.email}`}>
                      <p>로그인 정보</p>
                      <p>{user?.email}</p>
                    </DropdownItem>
                    {/* 🔥 role 체크 개선 */}
                    {user?.role === "admin" ? (
                      <>
                        <DropdownItem
                          key="resister"
                          textValue="resister"
                          onClick={() => router.push("/admin/register")}
                        >
                          <p>앱 등록</p>
                        </DropdownItem>
                        <DropdownItem
                          key="adminWrite"
                          textValue="adminWrite"
                          onClick={() => router.push("/admin/write")}
                        >
                          <p>개발노트 쓰기</p>
                        </DropdownItem>
                        <DropdownItem
                          key="adminNoteList"
                          textValue="adminNoteList"
                          onClick={() => router.push("/admin/list")}
                        >
                          <p>개발노트 리스트 관리</p>
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
              </div>
            )}
          </div>

          {/* 소셜 아이콘들 */}
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
            <ThemeSwitch />
          </div>
        </div>
      </div>
    </div>
  );
}
