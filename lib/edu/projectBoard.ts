// lib/edu/projectBoard.ts
// edu 등 외부 사이트가 홈페이지 프로젝트 게시판(posts)을 API 로 쓰기 위한 공통 도구.
// 주소는 기존 화면 주소 /project/[name]/board/[postType] 과 같은 모양이다.
//   [name]      프로젝트 슬러그 (프로젝트를 만들 때 자동으로 생기는 주소용 이름)
//   [postType]  "post" = 문의 게시판 (읽기·쓰기), "notice" = 공지사항 (읽기만)
import prisma from "@/lib/prisma";

export const INQUIRY_POST_TYPE = "post"; // 문의 게시판
export const NOTICE_POST_TYPE = "notice"; // 공지사항 (관리자만 작성)
export const EDU_GUEST_EMAIL = "edu-guest"; // 로그인 없이 외부 사이트에서 쓴 글의 소유자 표시

export const isReadablePostType = (value: string) =>
  value === INQUIRY_POST_TYPE || value === NOTICE_POST_TYPE;

// 슬러그에 해당하는 프로젝트가 있으면 그 name, 없으면 null.
export async function findProjectName(slug: string): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { name: slug },
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
