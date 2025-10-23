// hooks/comments/useComments.ts
"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  addAComment,
  deleteAComment,
  editComment,
  addAReply,
  deleteAReply,
  editReply,
} from "@/serverActions/posts";

export function useComments() {
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [showReplies, setShowReplies] = useState<Record<string, boolean>>({});
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editingReply, setEditingReply] = useState<string | null>(null);
  const [editCommentContent, setEditCommentContent] = useState("");
  const [editReplyContent, setEditReplyContent] = useState("");

  // 🔥 멘션 관련 상태 추가
  const [mentionTarget, setMentionTarget] = useState<string | null>(null);

  const queryClient = useQueryClient();

  // 댓글 생성
  const createCommentMutation = useMutation({
    mutationFn: addAComment,
    onSuccess: (updatedPost, variables) => {
      queryClient.setQueryData(
        ["post", variables.appName, variables.postType, variables.postId],
        updatedPost,
      );
    },
  });

  // 댓글 삭제
  const deleteCommentMutation = useMutation({
    mutationFn: deleteAComment,
    onSuccess: (updatedPost, variables) => {
      queryClient.setQueryData(
        ["post", variables.appName, variables.postType, variables.postId],
        updatedPost,
      );
    },
  });

  // 댓글 수정
  const editCommentMutation = useMutation({
    mutationFn: editComment,
    onSuccess: (updatedPost, variables) => {
      queryClient.setQueryData(
        ["post", variables.appName, variables.postType, variables.postId],
        updatedPost,
      );
      setEditingComment(null);
      setEditCommentContent("");
    },
  });

  // 답글 생성
  const createReplyMutation = useMutation({
    mutationFn: addAReply,
    onSuccess: (updatedPost, variables) => {
      queryClient.setQueryData(
        ["post", variables.appName, variables.postType, variables.postId],
        updatedPost,
      );
    },
  });

  // 답글 삭제
  const deleteReplyMutation = useMutation({
    mutationFn: deleteAReply,
    onSuccess: (updatedPost, variables) => {
      queryClient.setQueryData(
        ["post", variables.appName, variables.postType, variables.postId],
        updatedPost,
      );
    },
  });

  // 답글 수정
  const editReplyMutation = useMutation({
    mutationFn: editReply,
    onSuccess: (updatedPost, variables) => {
      queryClient.setQueryData(
        ["post", variables.appName, variables.postType, variables.postId],
        updatedPost,
      );
      setEditingReply(null);
      setEditReplyContent("");
    },
  });

  // 액션 함수들
  const handleCommentSubmit = (
    appName: string,
    postType: string,
    postId: string,
    writer: string,
    email: string,
  ) => {
    if (!newComment.trim()) return;

    createCommentMutation.mutate({
      appName,
      postType,
      postId,
      commentWriter: writer,
      commentContent: newComment,
      email,
    });

    setNewComment("");
  };

  const handleCommentDelete = (
    appName: string,
    postType: string,
    postId: string,
    commentId: string,
  ) => {
    deleteCommentMutation.mutate({
      appName,
      postType,
      postId,
      commentId,
    });
  };

  const handleCommentEdit = (
    appName: string,
    postType: string,
    postId: string,
    commentId: string,
  ) => {
    if (!editCommentContent.trim()) return;

    editCommentMutation.mutate({
      appName,
      postType,
      postId,
      commentId,
      content: editCommentContent,
    });
  };

  // 🔥 답글 제출 (멘션 포함)
  const handleReplySubmit = (
    appName: string,
    postType: string,
    postId: string,
    commentId: string,
    writer: string,
    email: string,
  ) => {
    if (!replyContent.trim()) return;

    let actualContent = replyContent;
    let mentionTo = mentionTarget;

    // @멘션 텍스트에서 파싱
    const mentionMatch = replyContent.match(/^@([가-힣a-zA-Z0-9_]+)\s+(.*)$/);

    if (mentionMatch) {
      mentionTo = mentionMatch[1];
      actualContent = mentionMatch[2];
    }

    createReplyMutation.mutate({
      appName,
      postType,
      postId,
      email,
      commentId,
      replyWriter: writer,
      replyContent: actualContent,
      mentionTarget: mentionTo, // 멘션 대상 포함
    });

    // 초기화
    setReplyContent("");
    setReplyTo(null);
    setMentionTarget(null);
  };

  const handleReplyDelete = (
    appName: string,
    postType: string,
    postId: string,
    replyId: string,
  ) => {
    deleteReplyMutation.mutate({
      appName,
      postType,
      postId,
      replyId,
    });
  };

  // 🔥 답글 수정 (멘션 파싱 포함)
  const handleReplyEdit = (
    appName: string,
    postType: string,
    postId: string,
    replyId: string,
  ) => {
    if (!editReplyContent.trim()) return;

    let actualContent = editReplyContent;
    let mentionTo = null;

    // @멘션 텍스트에서 파싱
    const mentionMatch = editReplyContent.match(
      /^@([가-힣a-zA-Z0-9_]+)\s+(.*)$/,
    );

    if (mentionMatch) {
      mentionTo = mentionMatch[1];
      actualContent = mentionMatch[2];
    }

    editReplyMutation.mutate({
      appName,
      postType,
      postId,
      replyId,
      content: actualContent,
      mentionTarget: mentionTo, // 멘션 대상 포함
    });
  };

  // 🔥 답글에 답글 달기 (멘션 포함)
  const handleReplyToReply = (commentId: string, targetUserName: string) => {
    setReplyTo(commentId);
    setReplyContent(`@${targetUserName} `);
    setMentionTarget(targetUserName);
  };

  // 🔥 멘션 제거
  const removeMention = () => {
    if (mentionTarget) {
      setReplyContent(replyContent.replace(`@${mentionTarget} `, ""));
      setMentionTarget(null);
    }
  };

  const toggleReplies = (commentId: string) => {
    setShowReplies((prev) => ({
      ...prev,
      [commentId]: !prev[commentId],
    }));
  };

  const startEditingComment = (commentId: string, currentContent: string) => {
    setEditingComment(commentId);
    setEditCommentContent(currentContent);
  };

  // 🔥 답글 수정 시작 (멘션 포함)
  const startEditingReply = (
    replyId: string,
    currentContent: string,
    currentMentionTo?: string,
  ) => {
    setEditingReply(replyId);

    // 기존 멘션이 있다면 포함해서 수정
    const editContent = currentMentionTo
      ? `@${currentMentionTo} ${currentContent}`
      : currentContent;

    setEditReplyContent(editContent);
  };

  const cancelEditing = () => {
    setEditingComment(null);
    setEditingReply(null);
    setEditCommentContent("");
    setEditReplyContent("");
    setMentionTarget(null); // 멘션도 초기화
  };

  return {
    // 상태들
    newComment,
    setNewComment,
    replyTo,
    setReplyTo,
    replyContent,
    setReplyContent,
    showReplies,
    editingComment,
    editingReply,
    editCommentContent,
    setEditCommentContent,
    editReplyContent,
    setEditReplyContent,

    // 🔥 멘션 관련 상태 추가
    mentionTarget,
    setMentionTarget,

    // 액션들
    handleCommentSubmit,
    handleCommentDelete,
    handleCommentEdit,
    handleReplySubmit,
    handleReplyDelete,
    handleReplyEdit,
    toggleReplies,
    startEditingComment,
    startEditingReply,
    cancelEditing,

    // 🔥 멘션 관련 액션 추가
    handleReplyToReply,
    removeMention,

    // 로딩 상태들
    isCreatingComment: createCommentMutation.isPending,
    isCreatingReply: createReplyMutation.isPending,
    isDeletingComment: deleteCommentMutation.isPending,
    isDeletingReply: deleteReplyMutation.isPending,
    isEditingCommentLoading: editCommentMutation.isPending,
    isEditingReplyLoading: editReplyMutation.isPending,
  };
}
