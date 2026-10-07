// lib/edu/projectBoard.ts
// edu(특수교육 도구함) 문의는 홈페이지에 등록한 프로젝트의 기존 문의 게시판(posts, postType "post")을 그대로 쓴다.
// 어느 프로젝트인지는 서버 환경변수 EDU_PROJECT_NAME (프로젝트 name, 주소에 쓰이는 값) 으로 정한다.
import prisma from "@/lib/prisma";

export const INQUIRY_POST_TYPE = "post"; // 문의 게시판
export const EDU_GUEST_EMAIL = "edu-guest"; // 로그인 없이 edu 사이트에서 쓴 글의 소유자 표시

// 설정된 프로젝트 name. 환경변수가 없거나 그 이름의 프로젝트가 없으면 null.
export async function getEduProjectName(): Promise<string | null> {
  const name = process.env.EDU_PROJECT_NAME?.trim();

  if (!name) return null;

  const project = await prisma.project.findUnique({
    where: { name },
    select: { name: true },
  });

  return project?.name ?? null;
}

type CommentRow = {
  id: string;
  writer: string;
  content: string;
  createdAt: Date;
  replies: { id: string; writer: string; content: string; createdAt: Date }[];
};

// 이메일 등 내부 값은 내보내지 않는다.
export function toInquiryComments(comments: CommentRow[]) {
  return comments.map((c) => ({
    id: c.id,
    writer: c.writer,
    content: c.content,
    createdAt: c.createdAt.toISOString(),
    replies: c.replies.map((r) => ({
      id: r.id,
      writer: r.writer,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    })),
  }));
}
