export type SiteConfig = typeof siteConfig;

export const siteConfig = {
  name: "코딩천재 부영실",
  description:
    "코딩천재 부영실의 개발한 앱 소개, 개발노트 정보 교환, 제작의뢰 등 정보 교환을 위한 홈페이지 입니다.",
  url: "https://www.buyoungsilcoding.com",
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
      label: "💼 프로젝트",  // 🔥 변경
      href: "/project",      // 🔥 변경
    },
    {
      label: "연락하기",
      href: "https://open.kakao.com/o/ss0BBmVb",
    },
  ],
  links: {
    github: "https://github.com/boboboda",
    youtube: "https://www.youtube.com/channel/UCRBQ2NAcJPVx2YMbhMywNKw",
    discord: "https://discord.gg/hFA8TMng",
  },
};
