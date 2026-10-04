// app/project/[name]/privacy/page.tsx
// 스토어(Google Play / App Store) 등록용 개인정보처리방침 독립 URL
// 예: https://www.buyoungsilcoding.com/project/{name}/privacy
import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import PrivacyPolicyView from "@/components/project/PrivacyPolicyView";

export const dynamic = "force-dynamic";

interface PrivacyPageProps {
  params: Promise<{ name: string }>;
}

export async function generateMetadata({ params }: PrivacyPageProps): Promise<Metadata> {
  const { name } = await params;

  const project = await prisma.project.findUnique({
    where: { name },
    select: { title: true, privacyPolicy: true },
  });

  if (!project?.privacyPolicy) {
    return { title: "개인정보처리방침을 찾을 수 없습니다" };
  }

  return {
    title: `${project.title} 개인정보처리방침 | 코딩천재 부영실`,
    description: `${project.title} 앱의 개인정보처리방침입니다.`,
  };
}

export default async function ProjectPrivacyPage({ params }: PrivacyPageProps) {
  const { name } = await params;

  const project = await prisma.project.findUnique({
    where: { name },
    select: {
      name: true,
      title: true,
      privacyPolicy: true,
      privacyUpdatedAt: true,
    },
  });

  if (!project || !project.privacyPolicy) {
    notFound();
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <Link
        href={`/project/${project.name}`}
        className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-6"
      >
        ← {project.title} 소개로 돌아가기
      </Link>

      <PrivacyPolicyView
        policy={project.privacyPolicy}
        updatedAt={project.privacyUpdatedAt?.toISOString() ?? null}
      />
    </div>
  );
}