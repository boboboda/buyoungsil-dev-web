import Link from "next/link";

import { siteConfig } from "@/config/site";

// 홈 마지막 섹션: 외주 의뢰 안내 (GitHub 등 다른 링크는 푸터에 있다)
export default function CTASection() {
  return (
    <section className="w-full py-16 md:py-20 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
      <div className="container mx-auto px-4 max-w-4xl text-center">
        <h2 className="text-3xl md:text-5xl font-bold mb-6">
          앱·웹 제작 의뢰 받습니다
        </h2>
        <p className="text-lg md:text-2xl mb-10 opacity-90">
          모바일 앱, 웹사이트, 관리자 페이지까지 기획부터 출시까지 함께 만듭니다.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/contact?type=work"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-blue-600 rounded-lg hover:bg-gray-100 transition-colors font-semibold text-lg shadow-lg"
          >
            💻 의뢰하기
          </Link>
          <Link
            href={siteConfig.links.kakao}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 border-2 border-white text-white rounded-lg hover:bg-white hover:text-blue-600 transition-colors font-semibold text-lg"
          >
            💬 카카오톡 오픈채팅
          </Link>
        </div>
      </div>
    </section>
  );
}
