// hooks/posts/usePostDetail.ts
"use client";
import type { Post } from "@/types";

import { usePost } from "./usePost";
import { usePostActions } from "./usePostActions";
import { useComments } from "./useComments";
import { useConfirmModal } from "./useConfirmModal";

// 작성자 정보는 서버가 세션에서 읽으므로 더 이상 currentUser 를 받지 않는다.
export function usePostDetail(
  appName: string,
  postType: string,
  postId: string,
  initialPost?: Post | null,
) {
  // 기본 데이터 및 액션 훅들
  const postQuery = usePost(appName, postType, postId, initialPost);
  const postActions = usePostActions();
  const comments = useComments();
  const { isOpen, onOpenChange, modalConfig, showConfirm, hideModal } =
    useConfirmModal();

  // 래핑된 액션 함수들 (매개변수 자동 바인딩)
  const handleCommentSubmit = () => {
    comments.handleCommentSubmit(appName, postType, postId);
  };

  const handleReplySubmit = (commentId: string) => {
    comments.handleReplySubmit(appName, postType, postId, commentId);
  };

  const handleCommentDelete = (commentId: string) => {
    comments.handleCommentDelete(appName, postType, postId, commentId);
  };

  const handleReplyDelete = (replyId: string) => {
    comments.handleReplyDelete(appName, postType, postId, replyId);
  };

  const handleCommentEdit = (commentId: string) => {
    comments.handleCommentEdit(appName, postType, postId, commentId);
  };

  const handleReplyEdit = (replyId: string) => {
    comments.handleReplyEdit(appName, postType, postId, replyId);
  };

  // 수정에 성공하면 onDone 이 호출된다 (편집 모드 닫기용)
  const handleEditPost = (
    title: string,
    content: string,
    onDone?: () => void,
  ) => {
    postActions.handleEditPost(
      appName,
      postType,
      postId,
      title,
      content,
      onDone,
    );
  };

  const openPostDeleteModal = (targetPostId: string) => {
    showConfirm({
      content: "게시글을 삭제하시겠습니까?",
      confirmText: "삭제",
      confirmColor: "danger",
      onConfirm: async () => {
        await postActions.handleDeletePost(appName, postType, targetPostId);
        hideModal();
      },
    });
  };

  const openCommentDeleteModal = (commentId: string) => {
    showConfirm({
      content: "댓글을 삭제하시겠습니까?",
      confirmText: "삭제",
      confirmColor: "danger",
      onConfirm: async () => {
        await handleCommentDelete(commentId);
        hideModal();
      },
    });
  };

  // 답글 삭제 모달 열기
  const openReplyDeleteModal = (replyId: string) => {
    showConfirm({
      content: "답글을 삭제하시겠습니까?",
      confirmText: "삭제",
      confirmColor: "danger",
      onConfirm: async () => {
        await handleReplyDelete(replyId);
        hideModal();
      },
    });
  };

  return {
    // 모달 관련
    isModalOpen: isOpen,
    onModalOpenChange: onOpenChange,
    modalConfig,
    showConfirmModal: showConfirm,
    hideModal,
    // 데이터
    post: postQuery.data,
    isLoading: postQuery.isLoading,
    error: postQuery.error,

    // 댓글 상태들
    ...comments,

    // 게시글 액션들
    openPostDeleteModal,
    handleEditPost,
    isDeleting: postActions.isDeleting,
    isEditing: postActions.isEditing,

    // 래핑된 댓글 액션들
    handleCommentSubmit,
    handleReplySubmit,
    openCommentDeleteModal,
    openReplyDeleteModal,
    handleCommentEdit,
    handleReplyEdit,
  };
}