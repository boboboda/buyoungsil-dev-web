import prisma from "@/lib/prisma";
import Link from "next/link";
import moment from "moment";

export default async function RecentActivity() {
  // 최근 생성된 항목들 가져오기
  const [recentProjects, recentNotes, recentStories] = await Promise.all([
    prisma.project.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        name: true
      }
    }),
    prisma.developNote.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' },
      select: {
        noteId: true,
        title: true,
        createdAt: true,
      }
    }),
    prisma.story.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        slug: true
      }
    }),
  ]);

  const activities = [
    ...recentProjects.map(p => ({
      type: '💼 프로젝트',
      title: p.title,
      time: moment(p.createdAt).fromNow(),
      link: `/project/${p.name}`
    })),
    ...recentNotes.map(n => ({
      type: '📚 개발노트',
      title: n.title || '제목 없음',
      time: moment(n.createdAt).fromNow(),
      link: `/note/detail/${n.noteId}`
    })),
    ...recentStories.map(s => ({
      type: '😅 스토리',
      title: s.title,
      time: moment(s.createdAt).fromNow(),
      link: `/stories/${s.slug}`
    })),
  ].sort((a, b) => {
    // 시간순 정렬 (최신순)
    const timeA = moment(a.time, 'fromNow');
    const timeB = moment(b.time, 'fromNow');
    return timeB.valueOf() - timeA.valueOf();
  }).slice(0, 8);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
      <h2 className="text-2xl font-bold mb-6">📊 최근 활동</h2>
      <div className="space-y-4">
        {activities.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            최근 활동이 없습니다
          </p>
        ) : (
          activities.map((activity, index) => (
            <Link 
              key={index} 
              href={activity.link}
              className="block p-4 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                    {activity.type}
                  </p>
                  <p className="font-medium line-clamp-1">
                    {activity.title}
                  </p>
                </div>
                <span className="text-xs text-gray-400 ml-4">
                  {activity.time}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}