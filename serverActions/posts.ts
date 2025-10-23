"use server";

import { revalidatePath } from "next/cache";

import prisma from "@/lib/prisma";
import { Post } from "@/types";

const formatDate = (date) => {
  return new Date(date)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
};

// 게시글 추가하기
export async function addAPost({
  appName,
  postType,
  title,
  writer,
  email,
  content,
}: {
  appName: string;
  postType: string;
  title: string;
  writer: string;
  email: string;
  content: string;
}) {
  try {
    // 콜렉션에서 가장 높은 listNumber 찾기
    const lastPost = await prisma.post.findFirst({
      where: {
        appName,
        postType,
      },
      orderBy: {
        listNumber: "asc",
      },
    });

    // 새 listNumber 계산 (존재하지 않으면 1로 시작)
    const newListNumber = lastPost ? lastPost.listNumber + 1 : 1;

    // 새 게시글 생성
    const newPost = await prisma.post.create({
      data: {
        title,
        listNumber: newListNumber,
        writer,
        email,
        content,
        appName,
        postType,
      },
    });

    revalidatePath(`/${appName}/${postType}`);

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

// 모든 게시글 가져오기
// fetchPosts - 목록용 (댓글은 개수만)
export async function fetchPosts(appName: string, postType: string) {
  const posts = await prisma.post.findMany({
    where: { appName, postType },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { comments: true }, // 댓글 개수만
      },
    },
  });

  const formattedPosts = posts.map((post) => ({
    id: post.id,
    listNumber: post.listNumber.toString(),
    writer: post.writer,
    email: post.email,
    title: post.title,
    content: post.content,
    commentCount: post._count.comments, // 댓글 개수
    created_at: formatDate(post.createdAt),
  }));

  return { posts: formattedPosts };
}

// 단일 게시글 조회
export async function fetchAPost(appName, id, postType): Promise<Post | null> {
  try {
    if (!id) {
      return null;
    }

    const post = await prisma.post.findFirst({
      where: {
        id,
        appName,
        postType,
      },
      include: {
        comments: {
          include: {
            replies: {
              orderBy: {
                createdAt: "asc", // 답글은 오래된순
              },
            },
          },
          orderBy: {
            createdAt: "desc", // ✅ 댓글은 최신순
          },
        },
      },
    });

    if (!post) {
      return null;
    }

    const formattedPost: Post = {
      id: post.id,
      listNumber: post.listNumber.toString(),
      writer: post.writer,
      email: post.email,
      title: post.title,
      content: post.content,
      comments: post.comments.map((comment) => ({
        id: comment.id,
        content: comment.content,
        writer: comment.writer,
        email: comment.email,
        // 문자열로 변환
        created_at: formatDate(comment.createdAt),
        replys: comment.replies.map((reply) => ({
          id: reply.id,
          writer: reply.writer,
          email: reply.email,
          content: reply.content,
          mentionTo: reply.mentionTo,
          created_at: formatDate(reply.createdAt),
        })),
      })),
      created_at: formatDate(post.createdAt),
    };

    return formattedPost;
  } catch (error) {
    console.error("게시글 조회 실패:", error);

    return null;
  }
}

// 단일 게시글 삭제
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
    // 게시글 찾기
    const post = await prisma.post.findFirst({
      where: {
        id,
        appName,
        postType,
      },
    });

    if (!post) {
      return null;
    }

    // 게시글 삭제 (관계된 댓글과 답글은 cascade로 자동 삭제)
    await prisma.post.delete({
      where: { id },
    });

    revalidatePath(`/${appName}/${postType}`);

    return post;
  } catch (error) {
    console.error("게시글 삭제 실패:", error);

    return null;
  }
}

// 단일 게시글 수정
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
    // 게시글 존재 여부 확인
    const existingPost = await prisma.post.findFirst({
      where: {
        id,
        appName,
        postType,
      },
    });

    if (!existingPost) {
      return null;
    }

    // 게시글 업데이트
    const updatedPost = await prisma.post.update({
      where: { id },
      data: {
        title,
        content,
      },
    });

    revalidatePath(`/${appName}/${postType}`);
    revalidatePath(`/${appName}/${postType}/${id}`);

    return {
      id,
      created_at: updatedPost.createdAt,
      title,
      content,
    };
  } catch (error) {
    console.error("게시글 수정 실패:", error);

    return null;
  }
}

// 댓글 추가하기
export async function addAComment({
  appName, // 추가
  postType, // 추가
  postId,
  commentWriter,
  commentContent,
  email,
}: {
  appName: string; // 추가
  postType: string; // 추가
  postId: string;
  commentWriter: string;
  commentContent: string;
  email: string;
}): Promise<Post> {
  try {
    await prisma.comment.create({
      data: {
        writer: commentWriter,
        content: commentContent,
        email: email,
        postId: postId,
      },
    });

    // 업데이트된 게시글 정보 가져오기
    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        comments: {
          include: {
            replies: true,
          },
          orderBy: {
            createdAt: "desc", // 댓글은 최신순
          },
        },
      },
    });

    if (!updatedPost) {
      throw new Error("게시글을 찾을 수 없습니다.");
    }

    // Post 타입으로 변환
    const formattedPost: Post = {
      id: updatedPost.id,
      listNumber: updatedPost.listNumber.toString(), // int → string 변환
      writer: updatedPost.writer,
      email: updatedPost.email,
      title: updatedPost.title,
      content: updatedPost.content,
      created_at: formatDate(updatedPost.createdAt),
      comments: updatedPost.comments.map((comment) => ({
        id: comment.id,
        writer: comment.writer,
        email: comment.email,
        content: comment.content,
        created_at: formatDate(comment.createdAt),
        replys: comment.replies.map((reply) => ({
          id: reply.id,
          writer: reply.writer,
          email: reply.email,
          content: reply.content,
          mentionTo: reply.mentionTo,
          created_at: formatDate(reply.createdAt),
        })),
      })),
    };

    return formattedPost;
  } catch (error) {
    console.error("댓글 추가 실패:", error);
    throw new Error("댓글을 추가하는 중 오류가 발생했습니다.");
  }
}

// 댓글 삭제
export async function deleteAComment({
  appName,
  postType,
  postId,
  commentId,
}: {
  appName: string;
  postType: string;
  postId: string;
  commentId: string;
}): Promise<Post> {
  try {
    // 댓글 삭제
    await prisma.comment.delete({
      where: { id: commentId },
    });

    // revalidatePath(`/${appName}/${postType}/${postId}`);

    // 업데이트된 게시글 정보 반환
    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        comments: {
          include: {
            replies: true,
          },
          orderBy: {
            createdAt: "desc", // 댓글은 최신 순
          },
        },
      },
    });

    if (!updatedPost) {
      throw new Error("게시글을 찾을 수 없습니다.");
    }

    // Post 타입으로 변환
    return {
      id: updatedPost.id,
      listNumber: updatedPost.listNumber.toString(),
      writer: updatedPost.writer,
      title: updatedPost.title,
      email: updatedPost.email,
      content: updatedPost.content,
      created_at: formatDate(updatedPost.createdAt),
      comments: updatedPost.comments.map((comment) => ({
        id: comment.id,
        writer: comment.writer,
        email: comment.email,
        content: comment.content,
        created_at: formatDate(comment.createdAt),
        replys: comment.replies.map((reply) => ({
          id: reply.id,
          writer: reply.writer,
          email: reply.email,
          content: reply.content,
          mentionTo: reply.mentionTo,
          created_at: formatDate(reply.createdAt),
        })),
      })),
    };
  } catch (error) {
    console.error("댓글 삭제 실패:", error);
    throw new Error("댓글을 삭제하는 중 오류가 발생했습니다.");
  }
}

// 댓글 수정
export async function editComment({
  appName,
  postType,
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
    // 댓글 수정
    await prisma.comment.update({
      where: { id: commentId },
      data: { content },
    });

    // revalidatePath(`/${appName}/${postType}/${postId}`);

    // 업데이트된 게시글 정보 반환
    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        comments: {
          include: {
            replies: true,
          },
          orderBy: {
            createdAt: "asc", // 댓글은 오래된순
          },
        },
      },
    });

    console.log(
      "댓글 순서 확인:",
      updatedPost.comments.map((c) => ({ id: c.id, created: c.createdAt })),
    );

    if (!updatedPost) {
      throw new Error("게시글을 찾을 수 없습니다.");
    }

    return {
      id: updatedPost.id,
      listNumber: updatedPost.listNumber.toString(),
      writer: updatedPost.writer,
      title: updatedPost.title,
      email: updatedPost.email,
      content: updatedPost.content,
      created_at: formatDate(updatedPost.createdAt),
      comments: updatedPost.comments.map((comment) => ({
        id: comment.id,
        writer: comment.writer,
        email: comment.email,
        content: comment.content,
        created_at: formatDate(comment.createdAt),
        replys: comment.replies.map((reply) => ({
          id: reply.id,
          writer: reply.writer,
          email: reply.email,
          content: reply.content,
          mentionTo: reply.mentionTo,
          created_at: formatDate(reply.createdAt),
        })),
      })),
    };
  } catch (error) {
    console.error("댓글 수정 실패:", error);
    throw new Error("댓글을 수정하는 중 오류가 발생했습니다.");
  }
}

// 답글 추가하기
export async function addAReply({
  appName,
  postType,
  postId,
  email,
  commentId,
  replyWriter,
  replyContent,
  mentionTarget,
}: {
  appName: string;
  postType: string;
  postId: string;
  email: string;
  commentId: string;
  replyWriter: string;
  replyContent: string;
  mentionTarget: string | null;
}): Promise<Post> {
  try {
    // 댓글 존재 여부 확인
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new Error("댓글을 찾을 수 없습니다.");
    }

    // 답글 추가
    await prisma.reply.create({
      data: {
        writer: replyWriter,
        content: replyContent,
        commentId: commentId,
        email: email,
        mentionTo: mentionTarget, // 멘션 대상 추가
      },
    });

    // revalidatePath(`/${appName}/${postType}/${postId}`);

    // 업데이트된 게시글 정보 반환
    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        comments: {
          include: {
            replies: {
              orderBy: { createdAt: "asc" }, // 답글은 오래된 순
            },
          },
          orderBy: { createdAt: "desc" }, // 댓글은 최신 순
        },
      },
    });

    return {
      id: updatedPost.id,
      listNumber: updatedPost.listNumber.toString(),
      writer: updatedPost.writer,
      title: updatedPost.title,
      email: updatedPost.email,
      content: updatedPost.content,
      created_at: formatDate(updatedPost.createdAt),
      comments: updatedPost.comments.map((comment) => ({
        id: comment.id,
        writer: comment.writer,
        email: comment.email,
        content: comment.content,
        created_at: formatDate(comment.createdAt),
        replys: comment.replies.map((reply) => ({
          id: reply.id,
          writer: reply.writer,
          email: reply.email,
          content: reply.content,
          mentionTo: reply.mentionTo,
          created_at: formatDate(reply.createdAt),
        })),
      })),
    };
  } catch (error) {
    console.error("답글 추가 실패:", error);
    throw new Error("답글을 추가하는 중 오류가 발생했습니다.");
  }
}

// 답글 삭제
export async function deleteAReply({
  appName,
  postType,
  postId,
  replyId,
}: {
  appName: string;
  postType: string;
  postId: string;
  replyId: string;
}): Promise<Post> {
  try {
    // 답글 삭제
    await prisma.reply.delete({
      where: { id: replyId },
    });

    // revalidatePath(`/${appName}/${postType}/${postId}`);

    // 업데이트된 게시글 정보 반환
    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        comments: {
          include: {
            replies: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!updatedPost) {
      throw new Error("게시글을 찾을 수 없습니다.");
    }

    // Post 타입으로 변환
    return {
      id: updatedPost.id,
      listNumber: updatedPost.listNumber.toString(),
      writer: updatedPost.writer,
      title: updatedPost.title,
      email: updatedPost.email,
      content: updatedPost.content,
      created_at: formatDate(updatedPost.createdAt),
      comments: updatedPost.comments.map((comment) => ({
        id: comment.id,
        writer: comment.writer,
        email: comment.email,
        content: comment.content,
        created_at: formatDate(comment.createdAt),
        replys: comment.replies.map((reply) => ({
          id: reply.id,
          writer: reply.writer,
          email: reply.email,
          content: reply.content,
          mentionTo: reply.mentionTo,
          created_at: formatDate(reply.createdAt),
        })),
      })),
    };
  } catch (error) {
    console.error("답글 삭제 실패:", error);
    throw new Error("답글을 삭제하는 중 오류가 발생했습니다.");
  }
}

// 답글 수정
export async function editReply({
  appName,
  postType,
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
    // 답글 수정
    await prisma.reply.update({
      where: { id: replyId },
      data: { content, mentionTo: mentionTarget },
    });

    // revalidatePath(`/${appName}/${postType}/${postId}`);

    // 업데이트된 게시글 정보 반환
    const updatedPost = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        comments: {
          include: {
            replies: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
          orderBy: {
            createdAt: "desc", // 댓글은 최신순
          },
        },
      },
    });

    if (!updatedPost) {
      throw new Error("게시글을 찾을 수 없습니다.");
    }

    // Post 타입으로 변환
    return {
      id: updatedPost.id,
      listNumber: updatedPost.listNumber.toString(),
      writer: updatedPost.writer,
      title: updatedPost.title,
      email: updatedPost.email,
      content: updatedPost.content,
      created_at: formatDate(updatedPost.createdAt),
      comments: updatedPost.comments.map((comment) => ({
        id: comment.id,
        writer: comment.writer,
        email: comment.email,
        content: comment.content,
        created_at: formatDate(comment.createdAt),
        replys: comment.replies.map((reply) => ({
          id: reply.id,
          writer: reply.writer,
          email: reply.email,
          content: reply.content,
          mentionTo: reply.mentionTo,
          created_at: formatDate(reply.createdAt),
        })),
      })),
    };
  } catch (error) {
    console.error("답글 수정 실패:", error);
    throw new Error("답글을 수정하는 중 오류가 발생했습니다.");
  }
}
