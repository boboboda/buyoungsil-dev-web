import { Metadata } from "next";
import Link from "next/link";

import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "문의하기 | 코딩천재 부영실",
  description:
    "코딩천재 부영실 사이트와 앱에 대한 문의, 제보, 제휴, 외주 요청을 받는 방법을 안내합니다.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <h1 className="text-3xl font-bold mb-3">문의하기</h1>
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
            <Link className="text-blue-600 hover:underline" href="/work-request">
              외주 신청 페이지
            </Link>
            에서 내용을 남겨 주세요.
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