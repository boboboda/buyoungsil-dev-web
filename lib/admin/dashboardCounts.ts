// 관리자 대시보드(/admin) 숫자 모음.
// count 만 쓰고, 쿼리 하나가 실패해도(DB 없음·테이블 없음) 그 칸만 null 로 두고 나머지는 그대로 보여 준다.
import type { PrismaClient } from "@prisma/client";

// 대시보드에 필요한 모델의 count 만 쓰므로, 시험에서는 이 모양의 가짜 객체를 넣는다.
export type DashboardDb = {
  project: Pick<PrismaClient["project"], "count">;
  developNote: Pick<PrismaClient["developNote"], "count">;
  story: Pick<PrismaClient["story"], "count">;
  workRequest: Pick<PrismaClient["workRequest"], "count">;
  post: Pick<PrismaClient["post"], "count">;
  eduPost: Pick<PrismaClient["eduPost"], "count">;
  draft: Pick<PrismaClient["draft"], "count">;
};

// null = 세지 못함(쿼리 실패)
export type DashboardCounts = {
  // 처리 대기
  pendingWorkRequests: number | null; // 외주 신청: status "pending"
  unansweredBoardPosts: number | null; // 앱별 문의 게시판(postType "post"): 댓글 0개
  unansweredEduPosts: number | null; // 특수교육 도구함 요청: 답변 0개
  pendingDrafts: number | null; // 초안함: status "pending"
  // 전체 현황
  totalProjects: number | null;
  totalNotes: number | null;
  totalStories: number | null;
  totalWorkRequests: number | null;
};

async function safeCount(run: () => PromiseLike<number>): Promise<number | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

export async function getDashboardCounts(db: DashboardDb): Promise<DashboardCounts> {
  const [
    pendingWorkRequests,
    unansweredBoardPosts,
    unansweredEduPosts,
    pendingDrafts,
    totalProjects,
    totalNotes,
    totalStories,
    totalWorkRequests,
  ] = await Promise.all([
    safeCount(() => db.workRequest.count({ where: { status: "pending" } })),
    safeCount(() =>
      db.post.count({ where: { postType: "post", comments: { none: {} } } }),
    ),
    safeCount(() => db.eduPost.count({ where: { replies: { none: {} } } })),
    safeCount(() => db.draft.count({ where: { status: "pending" } })),
    safeCount(() => db.project.count()),
    safeCount(() => db.developNote.count()),
    safeCount(() => db.story.count()),
    safeCount(() => db.workRequest.count()),
  ]);

  return {
    pendingWorkRequests,
    unansweredBoardPosts,
    unansweredEduPosts,
    pendingDrafts,
    totalProjects,
    totalNotes,
    totalStories,
    totalWorkRequests,
  };
}
