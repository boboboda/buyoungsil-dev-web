// app/admin/factory/release/page.tsx
// 앱 공장 "출시 패키지": 앱별 출시 상태와 출시 준비 일감이 만든 자료. 배포 계정은 설정 화면에서.
import { Metadata } from "next";
import Link from "next/link";

import ReleasePanel from "@/components/admin/factory/ReleasePanel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "출시 패키지 | 앱 공장",
};

export default function AdminFactoryReleasePage() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-4 sm:py-8">
      <div className="mb-6">
        <Link className="text-sm text-default-500 hover:underline" href="/admin/factory">
          ← 통제실로 돌아가기
        </Link>
        <h1 className="mb-2 mt-2 text-2xl font-bold sm:text-3xl">📦 출시 패키지</h1>
        <p className="text-gray-600 dark:text-gray-400">
          앱마다 배포 계정을 고르고 종류(첫 출시·스토어 자료 수정·프로젝트 업데이트)를 골라 승인하면, 스토어 문구·데이터 보안·콘텐츠 등급·체크리스트·개인정보처리방침 초안과 AAB 정보가
          여기 모여요. 최초 업로드와 프로덕션 출시는 사람이 Play Console 에서 해요.
        </p>
      </div>
      <ReleasePanel />
    </div>
  );
}
