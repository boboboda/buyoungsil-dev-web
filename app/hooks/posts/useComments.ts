// hooks/comments/useComments.ts
"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";

import {
  addAComment,
  deleteAComment,
  editComment,
  addAReply,
  deleteAReply,
  editReply,
} from "@/serverActions/posts";

// "@이름 내용" 형태에서 멘션 대상과 실제 내용을 분리한다. (줄바꿈이 있는 내용도 허용)
const MENTION_REGEX = /^@([가-힣a-zA-Z0-9_]+)\s+([\s\S]*)$/;

function parseMention(text: string): {
  mentionTo: string | null;
  content: string;
} {
  const match = text.match(MENTION_REGEX);

  if (match) {
    return { mentionTo: match[1], content: match[2] };
  }

  return { mentionTo: null, content: text };
}

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

  const notifyError = (msg: string) => toast.error(msg);

  // 댓글 생성
  const createCommentMutation = useMutation({
    mutationFn: addAComment,
    onSuccess: (updatedPost, variables) => {
      queryClient.setQueryData(
        ["post", variables.appName, variables.postType, variables.postId],
        updatedPost,
      );
    },
    onError: () => {
      notifyError("댓글 작성에 실패했습니다. 로그인 상태를 확인해주세요.");
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
    onError: () => {
      notifyError("댓글 삭제에 실패했습니다.");
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
    onError: () => {
      notifyError("댓글 수정에 실패했습니다.");
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
      // 방금 단 답글이 바로 보이도록 해당 댓글의 답글 목록을 펼친다.
      setShowReplies((prev) => ({ ...prev, [variables.commentId]: true }));
    },
    onError: () => {
      notifyError("답글 작성에 실패했습니다. 로그인 상태를 확인해주세요.");
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
    onError: () => {
      notifyError("답글 삭제에 실패했습니다.");
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
    onError: () => {
      notifyError("답글 수정에 실패했습니다.");
    },
  });

  // 액션 함수들 (작성자 이름/이메일은 서버가 세션에서 직접 읽는다)
  const handleCommentSubmit = (
    appName: string,
    postType: string,
    postId: string,
  ) => {
    if (!newComment.trim()) return;

    createCommentMutation.mutate(
      {
        appName,
        postType,
        postId,
        commentContent: newComment,
      },
      {
        // 성공했을 때만 입력창을 비운다 (실패하면 쓴 내용이 남아 있다)
        onSuccess: () => setNewComment(""),
      },
    );
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
  ) => {
    if (!replyContent.trim()) return;

    const { mentionTo, content } = parseMention(replyContent);

    if (!content.trim()) return;

    createReplyMutation.mutate(
      {
        appName,
        postType,
        postId,
        commentId,
        replyContent: content,
        mentionTarget: mentionTo,
      },
      {
        // 성공했을 때만 초기화
        onSuccess: () => {
          setReplyContent("");
          setReplyTo(null);
          setMentionTarget(null);
        },
      },
    );
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

    const { mentionTo, content } = parseMention(editReplyContent);

    if (!content.trim()) return;

    editReplyMutation.mutate({
      appName,
      postType,
      postId,
      replyId,
      content,
      mentionTarget: mentionTo,
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
    currentMentionTo?: string | null,
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