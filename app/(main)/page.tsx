import { Metadata } from "next";

import Hero from "@/components/home/hero";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "코딩천재 부영실",
  description:
    "코딩천재 부영실의 개발한 앱 소개, 개발노트 정보 교환, 제작의뢰 등 정보 교환을 위한 홈페이지입니다. NestJS, React, Flutter 등 다양한 개발 기술을 공유합니다.",
  keywords: [
    "부영실",
    "코딩천재",
    "개발자",
    "앱개발",
    "웹개발",
    "개발노트",
    "NestJS",
    "React",
    "Flutter",
    "TypeScript",
    "JavaScript",
    "제작의뢰",
  ],
  openGraph: {
    title: "코딩천재 부영실",
    description:
      "코딩천재 부영실의 개발한 앱 소개, 개발노트 정보 교환, 제작의뢰 등 정보 교환을 위한 홈페이지입니다.",
    url: "https://www.buyoungsilcoding.com",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "코딩천재 부영실 홈페이지",
      },
    ],
  },
  alternates: {
    canonical: "https://www.buyoungsilcoding.com",
  },
};

export default async function Home() {
  console.log("메인페이지로드");

  return (
    <div className="h-full w-full items-center justify-center">
      <Hero />
    </div>
  );
}
