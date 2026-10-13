import { Metadata } from "next";
import moment from "moment";
import Hero from "@/components/home/hero";
import FeaturedProjects from "@/components/home/FeaturedProjects";
import RecentNotes from "@/components/home/RecentNotes";
import CTASection from "@/components/home/CTASection";
import { fetchAllProjects } from "@/serverActions/projects";
import { getTodayVisitorCount, getTotalVisitorCount } from "@/serverActions/visitor";
import { siteConfig } from "@/config/site";
import prisma from "@/lib/prisma";
import type { Note, NoteCategory, SubCategory } from "@/types";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${siteConfig.name} | 앱·웹 개발과 외주 제작`,
  description: siteConfig.description,
  keywords: [
    "앱 개발", "웹 개발", "앱 외주", "앱 제작 의뢰", "Flutter 앱 개발",
    "Next.js", "AI 개발", "부영실", "코딩천재"
  ],
  alternates: { canonical: "/" },
};

const HOME_PROJECTS = 3;
const HOME_NOTES = 6;

// 홈에 필요한 노트만 읽는다: 최신 공개 노트 몇 개(본문 제외) + 공개 노트 수.
// DB 를 못 읽어도 홈은 빈 목록으로 그린다.
async function fetchHomeNotes(): Promise<{ notes: Note[]; total: number }> {
  try {
    const [rows, total] = await Promise.all([
      prisma.developNote.findMany({
        where: { isPublished: true },
        orderBy: { createdAt: 'desc' },
        take: HOME_NOTES,
        select: { noteId: true, title: true, mainCategory: true, subCategory: true },
      }),
      prisma.developNote.count({ where: { isPublished: true } }),
    ]);

    const notes = rows.map(note => {
      let subCategory: SubCategory | null = null;
      if (note.subCategory) {
        try {
          subCategory = typeof note.subCategory === 'string'
            ? JSON.parse(note.subCategory)
            : (note.subCategory as unknown as SubCategory);
        } catch {
          subCategory = null;
        }
      }
      return {
        noteId: note.noteId,
        title: note.title || null,
        mainCategory: note.mainCategory as NoteCategory,
        subCategory,
      };
    });

    return { notes, total };
  } catch (error) {
    console.error("홈 개발노트 조회 실패:", error);
    return { notes: [], total: 0 };
  }
}

// 한국 시간(Asia/Seoul) 기준 오늘 날짜 "YYYY-MM-DD"
function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// 운영 시작일을 1일째로 센 오늘까지의 날수 (둘 다 한국 날짜)
function daysSinceStart(startedAt: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${startedAt}T00:00:00Z`);
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
}

// 방문자 수 조회가 실패하면 null (그 카드만 숨기고 홈은 그린다).
// 오늘 방문자의 '오늘'은 recordVisit 과 같은 서버 시간대 날짜(컨테이너 TZ=Asia/Seoul)다.
async function safeCount(read: () => Promise<number>, what: string): Promise<number | null> {
  try {
    return await read();
  } catch (error) {
    console.error(`홈 ${what} 조회 실패:`, error);
    return null;
  }
}

export default async function Home() {
  // 프로젝트(실패 시 빈 목록)·노트·방문자 수를 한꺼번에 읽는다
  const [rawProjects, { notes: recentNotes, total: totalNotes }, todayVisitors, totalVisitors] =
    await Promise.all([
      fetchAllProjects(),
      fetchHomeNotes(),
      safeCount(getTodayVisitorCount, "오늘 방문자"),
      safeCount(getTotalVisitorCount, "총 방문자"),
    ]);

  const daysRunning = daysSinceStart(siteConfig.startedAt, kstToday());

  // 🔥 Date를 string으로 변환
  const projects = rawProjects.map(project => ({
    ...project,
    createdAt: moment(project.createdAt).format("YYYY-MM-DD"),
    updatedAt: moment(project.updatedAt).format("YYYY-MM-DD")
  }));

  // 최근 출시 프로젝트 먼저, 모자라면 개발 중인 프로젝트로 채운다 (각각 최신순)
  const featuredProjects = [
    ...projects.filter(p => p.status === 'released'),
    ...projects.filter(p => p.status === 'in-progress'),
  ].slice(0, HOME_PROJECTS);

  return (
    <div className="flex flex-col w-full overflow-x-hidden">
      <Hero
        totalProjects={projects.length}
        totalNotes={totalNotes}
        daysRunning={daysRunning}
        todayVisitors={todayVisitors}
        totalVisitors={totalVisitors}
      />
      <FeaturedProjects projects={featuredProjects} />
      <RecentNotes notes={recentNotes} />
      <CTASection />
    </div>
  );
}
