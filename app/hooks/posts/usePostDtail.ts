// hooks/posts/usePostDetail.ts
"use client";
import type { Post } from "@/types";

import { usePost } from "./usePost";
import { usePostActions } from "./usePostActions";
import { useComments } from "./useComments";
import { useConfirmModal } from "./useConfirmModal";

export function usePostDetail(
  appName: string,
  postType: string,
  postId: string,
  initialPost?: Post,
  currentUser?: { name: string; email: string },
) {
  // 기본 데이터 및 액션 훅들
  const postQuery = usePost(appName, postType, postId, initialPost);
  const postActions = usePostActions();
  const comments = useComments();
  const { isOpen, onOpenChange, modalConfig, showConfirm, hideModal } =
    useConfirmModal();

  // 사용자 정보 기본값
  const user = currentUser || { name: "익명", email: "anonymous@example.com" };

  // 래핑된 액션 함수들 (매개변수 자동 바인딩)
  const handleCommentSubmit = () => {
    comments.handleCommentSubmit(
      appName,
      postType,
      postId,
      user.name,
      user.email,
    );
  };

  const handleReplySubmit = (commentId: string) => {
    comments.handleReplySubmit(
      appName,
      postType,
      postId,
      commentId,
      user.name,
      user.email,
    );
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

  const handleEditPost = (title: string, content: string) => {
    postActions.handleEditPost(appName, postType, postId, title, content);
  };

  const openPostDeleteModal = (postId : string) => {
    showConfirm({
      content: "게시글을 삭제하시겠습니까?",
      confirmText: "삭제",
      confirmColor: "danger",
      onConfirm: async () => {
        await postActions.handleDeletePost(appName, postType, postId);
        hideModal();
      },
    });
  };

  const openCommentDeleteModal = (commentId : string) => {
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
  const openReplyDeleteModal = (replyId : string) => {
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
