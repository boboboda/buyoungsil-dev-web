import { Metadata } from "next";
import Link from "next/link";

import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "소개 | 코딩천재 부영실",
  description:
    "코딩천재 부영실은 비개발자 출신 개발자가 AI를 활용해 앱과 웹을 만들며 겪은 과정과 시행착오를 기록하는 사이트입니다.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <h1 className="text-3xl font-bold mb-3">코딩천재 부영실 소개</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-10">
        {siteConfig.description}
      </p>

      <div className="space-y-10">
        <section>
          <h2 className="text-xl font-semibold mb-2">이 사이트는</h2>
          <p className="leading-relaxed text-gray-700 dark:text-gray-300">
            개인 앱을 만들어 온 개발자가 직접 운영합니다.
            Flutter, Kotlin, Swift, Next.js, NestJS로 앱과 웹 서비스를 만들고,
            그 과정에서 AI(ChatGPT, Claude)를 어떻게 활용했는지, 어디서 막혔고
            어떻게 해결했는지를 있는 그대로 기록합니다.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">무엇을 볼 수 있나요</h2>
          <ul className="space-y-3 text-gray-700 dark:text-gray-300">
            <li>
              <Link className="text-blue-600 hover:underline font-medium" href="/note">
                개발노트
              </Link>
              <span className="block text-sm text-gray-500">
                직접 겪은 문제와 해결 과정을 정리한 기술 노트입니다.
              </span>
            </li>
            <li>
              <Link className="text-blue-600 hover:underline font-medium" href="/project">
                프로젝트
              </Link>
              <span className="block text-sm text-gray-500">
                제가 만든 앱의 소개, 개발 로그, 진행 상황, 개인정보처리방침을
                공개합니다.
              </span>
            </li>
            <li>
              <Link className="text-blue-600 hover:underline font-medium" href="/stories">
                비개발자 이야기
              </Link>
              <span className="block text-sm text-gray-500">
                삽질기와 꿀팁, 개발하며 느낀 점을 이야기로 남깁니다.
              </span>
            </li>
            <li>
              <Link className="text-blue-600 hover:underline font-medium" href="/work-request">
                외주 신청
              </Link>
              <span className="block text-sm text-gray-500">
                앱·웹 제작 의뢰를 받습니다.
              </span>
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">콘텐츠 원칙</h2>
          <ul className="list-disc pl-5 space-y-1 text-gray-700 dark:text-gray-300">
            <li>직접 만들고 겪은 내용만 씁니다.</li>
            <li>AI가 만든 코드도 실제로 실행해 확인한 뒤에 공개합니다.</li>
            <li>오류나 오래된 내용은 확인하는 대로 수정합니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">광고 안내</h2>
          <p className="leading-relaxed text-gray-700 dark:text-gray-300">
            이 사이트는 운영비를 충당하기 위해 Google AdSense 같은 광고를 게재할
            수 있습니다. 광고 및 쿠키 사용에 대한 내용은{" "}
            <Link className="text-blue-600 hover:underline" href="/privacy">
              개인정보처리방침
            </Link>
            에서 확인할 수 있습니다.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">연락</h2>
          <p className="text-gray-700 dark:text-gray-300">
            <Link className="text-blue-600 hover:underline" href="/contact">
              문의하기
            </Link>{" "}
            · {siteConfig.contactEmail}
          </p>
        </section>
      </div>
    </div>
  );
}