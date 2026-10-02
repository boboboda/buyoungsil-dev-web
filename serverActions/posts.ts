"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { authOptions } from "@/lib/auth/auth";
import { Post } from "@/types";

// ---------------------------------------------------------------------------
// 공통 헬퍼 (이 파일은 "use server" 라서 export 하지 않는 내부 함수만 둡니다)
// ---------------------------------------------------------------------------

type Viewer = {
  name: string;
  email: string;
  isAdmin: boolean;
};

const formatDate = (date: Date | string) => {
  return new Date(date)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
};

// 서버에서 세션을 직접 확인한다. 클라이언트가 보낸 writer/email 은 신뢰하지 않는다.
async function getViewer(): Promise<Viewer | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user;

  if (!user?.email) return null;

  return {
    name: user.name || "익명",
    email: user.email,
    isAdmin: user.role === "admin",
  };
}

async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();

  if (!viewer) {
    throw new Error("로그인이 필요합니다.");
  }

  return viewer;
}

const isOwner = (viewer: Viewer | null, ownerEmail: string) =>
  !!viewer && viewer.email === ownerEmail;

// 삭제는 작성자 본인 또는 관리자
const canDelete = (viewer: Viewer | null, ownerEmail: string) =>
  !!viewer && (viewer.isAdmin || viewer.email === ownerEmail);

const listPath = (appName: string, postType: string) =>
  `/project/${appName}/board/${postType}`;

// 게시글 + 댓글(최신순) + 답글(오래된순) 을 항상 같은 정렬로 읽는다.
async function loadPost(where: {
  id: string;
  appName?: string;
  postType?: string;
}) {
  return prisma.post.findFirst({
    where,
    include: {
      comments: {
        include: {
          replies: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

type PostRow = NonNullable<Awaited<ReturnType<typeof loadPost>>>;

// DB 행 → 클라이언트 응답. 이메일은 내려보내지 않고 isMine 만 계산해서 준다.
function toPost(post: PostRow, viewer: Viewer | null): Post {
  return {
    id: post.id,
    listNumber: post.listNumber.toString(),
    writer: post.writer,
    isMine: isOwner(viewer, post.email),
    title: post.title,
    content: post.content,
    created_at: formatDate(post.createdAt),
    comments: post.comments.map((comment) => ({
      id: comment.id,
      writer: comment.writer,
      isMine: isOwner(viewer, comment.email),
      content: comment.content,
      created_at: formatDate(comment.createdAt),
      replys: comment.replies.map((reply) => ({
        id: reply.id,
        writer: reply.writer,
        isMine: isOwner(viewer, reply.email),
        content: reply.content,
        mentionTo: reply.mentionTo,
        created_at: formatDate(reply.createdAt),
      })),
    })),
  };
}

async function respondWithPost(postId: string, viewer: Viewer): Promise<Post> {
  const updatedPost = await loadPost({ id: postId });

  if (!updatedPost) {
    throw new Error("게시글을 찾을 수 없습니다.");
  }

  return toPost(updatedPost, viewer);
}

// ---------------------------------------------------------------------------
// 게시글
// ---------------------------------------------------------------------------

// 게시글 추가하기
export async function addAPost({
  appName,
  postType,
  title,
  content,
}: {
  appName: string;
  postType: string;
  title: string;
  content: string;
}) {
  try {
    const viewer = await requireViewer();

    // 공지사항은 관리자만 작성할 수 있다.
    if (postType === "notice" && !viewer.isAdmin) {
      throw new Error("공지사항은 관리자만 작성할 수 있습니다.");
    }

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle || !trimmedContent) {
      throw new Error("제목과 내용을 입력해주세요.");
    }

    // 가장 큰 listNumber 를 찾아서 +1 (예전에는 asc 정렬이라 가장 작은 번호를 읽고 있었음)
    const last = await prisma.post.aggregate({
      where: { appName, postType },
      _max: { listNumber: true },
    });
    const newListNumber = (last._max.listNumber ?? 0) + 1;

    const newPost = await prisma.post.create({
      data: {
        title: trimmedTitle,
        listNumber: newListNumber,
        writer: viewer.name,
        email: viewer.email,
        content: trimmedContent,
        appName,
        postType,
      },
    });

    revalidatePath(listPath(appName, postType));

    return {
      id: newPost.id,
      title: newPost.title,
      listNumber: newPost.listNumber,
      writer: newPost.writer,
      content: newPost.content,
      created_at: newPost.createdAt,
      comments: [],
    };
  } catch (error) {
    console.error("게시글 추가 실패:", error);
    throw new Error("게시글을 추가하는 중 오류가 발생했습니다.");
  }
}

// 모든 게시글 가져오기 (목록용: 댓글은 개수만, 이메일은 내려보내지 않음)
export async function fetchPosts(appName: string, postType: string) {
  const posts = await prisma.post.findMany({
    where: { appName, postType },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { comments: true },
      },
    },
  });

  const formattedPosts = posts.map((post) => ({
    id: post.id,
    listNumber: post.listNumber.toString(),
    writer: post.writer,
    title: post.title,
    content: post.content,
    commentCount: post._count.comments,
    created_at: formatDate(post.createdAt),
  }));

  return { posts: formattedPosts };
}

// 단일 게시글 조회
export async function fetchAPost(
  appName: string,
  id: string,
  postType: string,
): Promise<Post | null> {
  try {
    if (!id) {
      return null;
    }

    const post = await loadPost({ id, appName, postType });

    if (!post) {
      return null;
    }

    const viewer = await getViewer();

    return toPost(post, viewer);
  } catch (error) {
    console.error("게시글 조회 실패:", error);

    return null;
  }
}

// 단일 게시글 삭제 (작성자 본인 또는 관리자)
export async function deleteAPost({
  appName,
  postType,
  id,
}: {
  appName: string;
  postType: string;
  id: string;
}) {
  try {
    const viewer = await requireViewer();

    const post = await prisma.post.findFirst({
      where: { id, appName, postType },
    });

    if (!post) {
      return null;
    }

    if (!canDelete(viewer, post.email)) {
      console.warn("게시글 삭제 권한 없음:", { id, by: viewer.email });

      return null;
    }

    // 관계된 댓글과 답글은 cascade 로 자동 삭제
    await prisma.post.delete({
      where: { id },
    });

    revalidatePath(listPath(appName, postType));

    return {
      id: post.id,
      appName: post.appName,
      postType: post.postType,
    };
  } catch (error) {
    console.error("게시글 삭제 실패:", error);

    return null;
  }
}

// 단일 게시글 수정 (작성자 본인만)
export async function editAPost({
  appName,
  postType,
  id,
  title,
  content,
}: {
  appName: string;
  postType: string;
  id: string;
  title: string;
  content: string;
}) {
  try {
    const viewer = await requireViewer();

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle || !trimmedContent) {
      return null;
    }

    const existingPost = await prisma.post.findFirst({
      where: { id, appName, postType },
    });

    if (!existingPost) {
      return null;
    }

    if (!isOwner(viewer, existingPost.email)) {
      console.warn("게시글 수정 권한 없음:", { id, by: viewer.email });

      return null;
    }

    const updatedPost = await prisma.post.update({
      where: { id },
      data: {
        title: trimmedTitle,
        content: trimmedContent,
      },
    });

    revalidatePath(listPath(appName, postType));
    revalidatePath(`${listPath(appName, postType)}/detail/${id}`);

    return {
      id,
      created_at: updatedPost.createdAt,
      title: trimmedTitle,
      content: trimmedContent,
    };
  } catch (error) {
    console.error("게시글 수정 실패:", error);

    return null;
  }
}

// ---------------------------------------------------------------------------
// 댓글
// ---------------------------------------------------------------------------

// 댓글 추가하기
export async function addAComment({
  appName,
  postType,
  postId,
  commentContent,
}: {
  appName: string;
  postType: string;
  postId: string;
  commentContent: string;
}): Promise<Post> {
  try {
    const viewer = await requireViewer();

    const content = commentContent.trim();

    if (!content) {
      throw new Error("댓글 내용을 입력해주세요.");
    }

    // 요청한 appName/postType 에 속한 게시글에만 댓글을 달 수 있다.
    const post = await prisma.post.findFirst({
      where: { id: postId, appName, postType },
      select: { id: true },
    });

    if (!post) {
      throw new Error("게시글을 찾을 수 없습니다.");
    }

    await prisma.comment.create({
      data: {
        writer: viewer.name,
        content,
        email: viewer.email,
        postId,
      },
    });

    return await respondWithPost(postId, viewer);
  } catch (error) {
    console.error("댓글 추가 실패:", error);
    throw new Error("댓글을 추가하는 중 오류가 발생했습니다.");
  }
}

// 댓글 삭제 (작성자 본인 또는 관리자)
export async function deleteAComment({
  postId,
  commentId,
}: {
  appName: string;
  postType: string;
  postId: string;
  commentId: string;
}): Promise<Post> {
  try {
    const viewer = await requireViewer();

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });

    // 다른 게시글의 댓글을 postId 만 바꿔서 지우는 것을 막는다.
    if (!comment || comment.postId !== postId) {
      throw new Error("댓글을 찾을 수 없습니다.");
    }

    if (!canDelete(viewer, comment.email)) {
      throw new Error("삭제 권한이 없습니다.");
    }

    await prisma.comment.delete({
      where: { id: commentId },
    });

    return await respondWithPost(postId, viewer);
  } catch (error) {
    console.error("댓글 삭제 실패:", error);
    throw new Error("댓글을 삭제하는 중 오류가 발생했습니다.");
  }
}

// 댓글 수정 (작성자 본인만)
export async function editComment({
  postId,
  commentId,
  content,
}: {
  appName: string;
  postType: string;
  postId: string;
  commentId: string;
  content: string;
}): Promise<Post> {
  try {
    const viewer = await requireViewer();

    const trimmed = content.trim();

    if (!trimmed) {
      throw new Error("댓글 내용을 입력해주세요.");
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.postId !== postId) {
      throw new Error("댓글을 찾을 수 없습니다.");
    }

    if (!isOwner(viewer, comment.email)) {
      throw new Error("수정 권한이 없습니다.");
    }

    await prisma.comment.update({
      where: { id: commentId },
      data: { content: trimmed },
    });

    return await respondWithPost(postId, viewer);
  } catch (error) {
    console.error("댓글 수정 실패:", error);
    throw new Error("댓글을 수정하는 중 오류가 발생했습니다.");
  }
}

// ---------------------------------------------------------------------------
// 답글
// ---------------------------------------------------------------------------

// 답글 추가하기
export async function addAReply({
  postId,
  commentId,
  replyContent,
  mentionTarget,
}: {
  appName: string;
  postType: string;
  postId: string;
  commentId: string;
  replyContent: string;
  mentionTarget: string | null;
}): Promise<Post> {
  try {
    const viewer = await requireViewer();

    const content = replyContent.trim();

    if (!content) {
      throw new Error("답글 내용을 입력해주세요.");
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.postId !== postId) {
      throw new Error("댓글을 찾을 수 없습니다.");
    }

    await prisma.reply.create({
      data: {
        writer: viewer.name,
        content,
        commentId,
        email: viewer.email,
        mentionTo: mentionTarget?.trim() || null,
      },
    });

    return await respondWithPost(postId, viewer);
  } catch (error) {
    console.error("답글 추가 실패:", error);
    throw new Error("답글을 추가하는 중 오류가 발생했습니다.");
  }
}

// 답글 삭제 (작성자 본인 또는 관리자)
export async function deleteAReply({
  postId,
  replyId,
}: {
  appName: string;
  postType: string;
  postId: string;
  replyId: string;
}): Promise<Post> {
  try {
    const viewer = await requireViewer();

    const reply = await prisma.reply.findUnique({
      where: { id: replyId },
      include: { comment: { select: { postId: true } } },
    });

    if (!reply || reply.comment.postId !== postId) {
      throw new Error("답글을 찾을 수 없습니다.");
    }

    if (!canDelete(viewer, reply.email)) {
      throw new Error("삭제 권한이 없습니다.");
    }

    await prisma.reply.delete({
      where: { id: replyId },
    });

    return await respondWithPost(postId, viewer);
  } catch (error) {
    console.error("답글 삭제 실패:", error);
    throw new Error("답글을 삭제하는 중 오류가 발생했습니다.");
  }
}

// 답글 수정 (작성자 본인만)
export async function editReply({
  postId,
  replyId,
  content,
  mentionTarget,
}: {
  appName: string;
  postType: string;
  postId: string;
  replyId: string;
  content: string;
  mentionTarget: string | null;
}): Promise<Post> {
  try {
    const viewer = await requireViewer();

    const trimmed = content.trim();

    if (!trimmed) {
      throw new Error("답글 내용을 입력해주세요.");
    }

    const reply = await prisma.reply.findUnique({
      where: { id: replyId },
      include: { comment: { select: { postId: true } } },
    });

    if (!reply || reply.comment.postId !== postId) {
      throw new Error("답글을 찾을 수 없습니다.");
    }

    if (!isOwner(viewer, reply.email)) {
      throw new Error("수정 권한이 없습니다.");
    }

    await prisma.reply.update({
      where: { id: replyId },
      data: { content: trimmed, mentionTo: mentionTarget?.trim() || null },
    });

    return await respondWithPost(postId, viewer);
  } catch (error) {
    console.error("답글 수정 실패:", error);
    throw new Error("답글을 수정하는 중 오류가 발생했습니다.");
  }
}

// ---------------------------------------------------------------------------
// 기타
// ---------------------------------------------------------------------------

export async function fetchPostsCount(
  appName: string,
  postType: string,
): Promise<number> {
  try {
    const count = await prisma.post.count({
      where: {
        appName,
        postType,
      },
    });

    return count;
  } catch (error) {
    console.error("게시글 개수 조회 실패:", error);

    return 0;
  }
}