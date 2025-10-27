import { Metadata } from "next";
import Hero from "@/components/home/hero";
import AboutSection from "@/components/home/AboutSection";
import FeaturedProjects from "@/components/home/FeaturedProjects";
import RecentNotes from "@/components/home/RecentNotes";
import PhilosophySection from "@/components/home/PhilosophySection";
import CTASection from "@/components/home/CTASection";
import { fetchAllProjects } from "@/serverActions/projects";
import { fetchAllDevelopNotes } from "@/serverActions/editorServerAction";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "코딩천재 부영실 - AI로 앱 만들기",
  description: "비개발자 출신 개발자가 AI(ChatGPT, Claude)를 활용해 모바일/웹 앱을 만드는 과정을 공유합니다.",
  keywords: [
    "AI 개발", "ChatGPT 코딩", "비개발자 개발", "Flutter 앱 개발",
    "Next.js", "앱 개발", "부영실", "코딩천재", "AI 코딩"
  ],
};

export default async function Home() {
  // 프로젝트 & 노트
  const projects = await fetchAllProjects();
  const notes = await fetchAllDevelopNotes();
  
  const featuredProjects = projects.filter(p => p.status === 'released').slice(0, 3);
  const recentNotes = notes.slice(0, 6);

  // 방문자 통계 🔥 수정
  const today = new Date().toISOString().split('T')[0];
  const todayVisitor = await prisma.dailyVisitorCount.findUnique({
    where: { date: today }
  });
  const totalVisitor = await prisma.totalVisitorCount.findFirst();

  // 가입자 수
  const totalUsers = await prisma.user.count();

  // 홈페이지 운영 일수 🔥 수정
  const firstVisitor = await prisma.dailyVisitorCount.findFirst({
    orderBy: { date: 'asc' }
  });
  const startDate = firstVisitor?.date ? new Date(firstVisitor.date) : new Date();
  const daysRunning = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="flex flex-col">
      <Hero 
        todayVisitors={todayVisitor?.count || 0}
        totalVisitors={totalVisitor?.totalCount || 0}
        totalProjects={projects.length}
        totalNotes={notes.length}
        totalUsers={totalUsers}
        daysRunning={daysRunning}
      />
      <AboutSection />
      <FeaturedProjects projects={featuredProjects} />
      <RecentNotes notes={recentNotes} />
      <PhilosophySection />
      <CTASection />
    </div>
  );
}