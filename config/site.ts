export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: "코딩천재 부영실",
  description:
    "코딩천재 부영실의 개발한 앱 소개, 개발노트 정보 교환, 제작의뢰 등 정보 교환을 위한 홈페이지 입니다.",
  url: "https://www.buyoungsilcoding.com",
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
  adminNavItems: [
    { key: "adminDashboard", label: "📊 대시보드", href: "/admin" },
    { key: "adminNotes", label: "📚 노트 관리", href: "/admin/notes" },
    { key: "adminProjects", label: "💼 프로젝트", href: "/admin/projects" },
    { key: "adminStories", label: "😅 이야기", href: "/admin/stories" },
    { key: "adminFactory", label: "🏭 앱 공장", href: "/admin/factory" },
    { key: "adminWorks", label: "💻 외주·문의함", href: "/admin/works" },
    { key: "adminBoards", label: "💬 게시판·공지", href: "/admin/boards" },
    { key: "adminAnalytics", label: "📈 분석", href: "/admin/analytics" },
  ],
  links: {
    github: "https://github.com/boboboda",
    youtube: "https://www.youtube.com/channel/UCRBQ2NAcJPVx2YMbhMywNKw",
    discord: "https://discord.gg/hFA8TMng",
    kakao: "https://open.kakao.com/o/ss0BBmVb", // 🔥 카카오톡 링크 추가
    company: "https://cosysoft.buyoungsilcoding.com",
  },
};