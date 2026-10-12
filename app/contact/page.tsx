import { Metadata } from "next";
import Link from "next/link";

import { siteConfig } from "@/config/site";
import { PageTabs } from "@/components/common/PageTabs";
import WorkRequestForm from "@/components/work-request/WorkRequestForm";

// 문의·의뢰 (정식 주소 /contact). 예전 외주 신청(/work-request)은 /contact?type=work 로 301 된다.
const TABS = [
  { key: "general", label: "💬 일반 문의", href: "/contact" },
  { key: "work", label: "💻 외주 의뢰", href: "/contact?type=work" },
];

type ContactPageProps = {
  searchParams: Promise<{ type?: string | string[] }>;
};

async function activeType(searchParams: ContactPageProps["searchParams"]) {
  const { type } = await searchParams;

  return type === "work" ? "work" : "general";
}

export async function generateMetadata({ searchParams }: ContactPageProps): Promise<Metadata> {
  if ((await activeType(searchParams)) === "work") {
    return {
      title: "외주 의뢰 | 문의·의뢰 | 코딩천재 부영실",
      description:
        "모바일/웹 앱 개발 프로젝트를 의뢰하세요. AI 기반 빠른 개발로 합리적인 가격에 제공합니다.",
      keywords: ["프로젝트 의뢰", "앱 개발 외주", "웹 개발 외주", "Flutter 개발", "Next.js 개발"],
      alternates: { canonical: "/contact?type=work" },
    };
  }

  return {
    title: "문의·의뢰 | 코딩천재 부영실",
    description:
      "코딩천재 부영실 사이트와 앱에 대한 문의, 제보, 제휴, 앱·웹 외주 의뢰를 한 곳에서 받습니다.",
    alternates: { canonical: "/contact" },
  };
}

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const type = await activeType(searchParams);

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl">
      <h1 className="text-3xl font-bold mb-3 text-center">문의·의뢰</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8 text-center">
        무엇을 도와드릴까요?
      </p>

      <PageTabs active={type} label="문의 종류" tabs={TABS} />

      {type === "work" ? <WorkRequestSection /> : <GeneralContactSection />}
    </div>
  );
}

function WorkRequestSection() {
  return (
    <div>
      {/* 안내 문구 */}
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-6 mb-8">
        <h2 className="text-xl font-bold mb-3 text-blue-900 dark:text-blue-100">
          💡 프로젝트 의뢰 안내
        </h2>
        <ul className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
          <li>✅ AI를 활용한 빠른 개발 (기존 대비 50% 단축)</li>
          <li>✅ Flutter, React, Next.js 등 최신 기술 스택</li>
          <li>✅ 합리적인 가격과 투명한 견적</li>
          <li>✅ 영업일 기준 2-3일 내 회신</li>
        </ul>
      </div>

      {/* 외주 신청 폼 */}
      <WorkRequestForm />
    </div>
  );
}

function GeneralContactSection() {
  return (
    <div className="max-w-3xl mx-auto">
      <p className="text-gray-600 dark:text-gray-400 mb-10">
        사이트, 개발노트, 앱에 대한 질문이나 제안이 있으면 아래 방법으로 연락해
        주세요. 확인하는 대로 답변드립니다.
      </p>

      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-semibold mb-2">이메일</h2>
          <p className="text-gray-700 dark:text-gray-300">
            <a
              className="text-blue-600 hover:underline"
              href={`mailto:${siteConfig.contactEmail}`}
            >
              {siteConfig.contactEmail}
            </a>
          </p>
          <p className="text-sm text-gray-500 mt-1">
            사이트 오류 제보, 글 정정 요청, 개인정보 관련 요청도 이 주소로 보내
            주세요. 보통 영업일 기준 2~3일 안에 답변합니다.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">외주 · 제작 의뢰</h2>
          <p className="text-gray-700 dark:text-gray-300">
            앱이나 웹 서비스 제작 의뢰는{" "}
            <Link className="text-blue-600 hover:underline" href="/contact?type=work">
              외주 의뢰
            </Link>
            탭에서 내용을 남겨 주세요.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">앱 관련 문의</h2>
          <p className="text-gray-700 dark:text-gray-300">
            제가 만든 앱의 문의는 각 앱의 게시판(공지·문의)에서도 남길 수
            있습니다. 앱 목록은{" "}
            <Link className="text-blue-600 hover:underline" href="/project">
              프로젝트 페이지
            </Link>
            에서 확인하세요.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">기타 채널</h2>
          <ul className="list-disc pl-5 space-y-1 text-gray-700 dark:text-gray-300">
            <li>
              <a
                className="text-blue-600 hover:underline"
                href={siteConfig.links.kakao}
                rel="noopener noreferrer"
                target="_blank"
              >
                카카오톡 오픈채팅
              </a>
            </li>
            <li>
              <a
                className="text-blue-600 hover:underline"
                href={siteConfig.links.github}
                rel="noopener noreferrer"
                target="_blank"
              >
                GitHub
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}