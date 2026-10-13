export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: "코딩천재 부영실",
  description:
    "코딩천재 부영실의 개발한 앱 소개, 개발노트 정보 교환, 제작의뢰 등 정보 교환을 위한 홈페이지 입니다.",
  url: "https://www.buyoungsilcoding.com",
  // 홈페이지 운영 시작일 (홈 히어로의 '운영 N일째' 기준, 한국 날짜)
  startedAt: "2024-01-01",
  // 🔥 사이트 문의/개인정보 담당 메일. 블로그 전용 메일로 바꾸는 것을 권장합니다.
  contactEmail: "kju9038@gmail.com",
  // 상단 메뉴 (PC·모바일 공통). activePaths: 이 메뉴를 켜 둘 다른 주소(첫 경로 기준)
  navItems: [
    {
      label: "홈",
      href: "/",
    },
    {
      label: "📚 개발노트",
      href: "/note",
      activePaths: ["/stories"], // 이야기 상세(/stories/글주소)는 개발노트 '이야기' 탭 소속
    },
    {
      label: "💼 프로젝트",
      href: "/project",
    },
    {
      label: "💬 문의·의뢰",
      href: "/contact",
    },
  ] as { label: string; href: string; activePaths?: string[] }[],
  // 관리자 드롭다운 (PC·모바일 공통). 여기 없는 관리자 화면도 주소는 그대로 살아 있다.
  // short: 관리자 콘솔 상단바(app/admin/layout.tsx)에 쓰는 짧은 이름
  adminNavItems: [
    { key: "adminDashboard", label: "📊 대시보드", short: "대시보드", href: "/admin" },
    { key: "adminNotes", label: "📚 노트 관리", short: "글/노트", href: "/admin/notes" },
    { key: "adminProjects", label: "💼 프로젝트", short: "프로젝트", href: "/admin/projects" },
    { key: "adminStories", label: "😅 이야기", short: "이야기", href: "/admin/stories" },
    { key: "adminFactory", label: "🏭 앱 공장", short: "통제실", href: "/admin/factory" },
    { key: "adminWorks", label: "💻 외주 신청", short: "외주", href: "/admin/works" },
    { key: "adminBoards", label: "💬 앱별 공지/문의 게시판", short: "문의함", href: "/admin/boards" },
    { key: "adminAnalytics", label: "📈 분석", short: "분석", href: "/admin/analytics" },
  ],
  // 관리자 콘솔 상단바에만 더 보이는 메뉴와 순서
  adminConsoleExtraNavItems: [
    { key: "adminDrafts", label: "📥 초안함", short: "초안함", href: "/admin/drafts" },
    { key: "adminCategories", label: "🗂 카테고리", short: "카테고리", href: "/admin/categories" },
  ],
  adminConsoleNavOrder: [
    "adminDashboard",
    "adminFactory",
    "adminNotes",
    "adminProjects",
    "adminStories",
    "adminDrafts",
    "adminBoards",
    "adminWorks",
    "adminAnalytics",
    "adminCategories",
  ],
  links: {
    github: "https://github.com/boboboda",
    youtube: "https://www.youtube.com/channel/UCRBQ2NAcJPVx2YMbhMywNKw",
    discord: "https://discord.gg/hFA8TMng",
    kakao: "https://open.kakao.com/o/ss0BBmVb", // 🔥 카카오톡 링크 추가
    company: "https://cosysoft.buyoungsilcoding.com",
  },
};