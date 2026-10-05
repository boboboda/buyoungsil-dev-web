export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: "코딩천재 부영실",
  description:
    "코딩천재 부영실의 개발한 앱 소개, 개발노트 정보 교환, 제작의뢰 등 정보 교환을 위한 홈페이지 입니다.",
  url: "https://www.buyoungsilcoding.com",
  // 🔥 사이트 문의/개인정보 담당 메일. 블로그 전용 메일로 바꾸는 것을 권장합니다.
  contactEmail: "kju9038@gmail.com",
  navItems: [
     {
      label: "홈",
      href: "/",
    },
    {
      label: "📚 개발노트",
      href: "/note",
    },
    {
      label: "💼 프로젝트",
      href: "/project",
    },
    {
      label: "😅 비개발자 이야기",
      href: "/stories",
    },
    {
      label: "💻 외주 신청",
      href: "/work-request",
    },
  ],
  links: {
    github: "https://github.com/boboboda",
    youtube: "https://www.youtube.com/channel/UCRBQ2NAcJPVx2YMbhMywNKw",
    discord: "https://discord.gg/hFA8TMng",
    kakao: "https://open.kakao.com/o/ss0BBmVb", // 🔥 카카오톡 링크 추가
  },
};