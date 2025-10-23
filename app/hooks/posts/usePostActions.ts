// hooks/posts/usePostActions.ts
"use client";
import type { Post } from "@/types";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";

import { deleteAPost, editAPost } from "@/serverActions/posts";

export function usePostActions() {
  const queryClient = useQueryClient();
  const router = useRouter();

  //알람 처리
  const notifySuccessEvent = (msg: string) => toast.success(msg);
  const notifyErrorEvent = (msg: string) => toast.error(msg);

  // 게시글 삭제
  const deletePostMutation = useMutation({
    mutationFn: deleteAPost,
    onSuccess: (deletedPost, variables) => {
      if (deletedPost) {
        router.push(`/release/${variables.postType}/${variables.appName}`);

        notifySuccessEvent(`게시글이 성공적으로 삭제되었습니다!`);
        // 해당 게시글 캐시 제거
        queryClient.removeQueries({
          queryKey: [
            "post",
            variables.appName,
            variables.postType,
            variables.id,
          ],
        });
        // 게시글 목록 캐시 무효화
        queryClient.invalidateQueries({
          queryKey: ["posts", variables.appName, variables.postType],
        });
      } else {
        notifyErrorEvent(`게시글 삭제에 실패했습니다!`);
      }
    },
  });

  // 게시글 수정
  const editPostMutation = useMutation({
    mutationFn: editAPost,
    onSuccess: (updatedPost, variables) => {
      if (updatedPost) {
        // 게시글 캐시 부분 업데이트
        queryClient.setQueryData(
          ["post", variables.appName, variables.postType, variables.id],
          (oldPost: Post) => {
            if (!oldPost) return oldPost;

            return {
              ...oldPost,
              title: variables.title,
              content: variables.content,
            };
          },
        );
      }
    },
  });

  const handleDeletePost = (appName: string, postType: string, id: string) => {
    deletePostMutation.mutate({ appName, postType, id });
  };

  const handleEditPost = (
    appName: string,
    postType: string,
    id: string,
    title: string,
    content: string,
  ) => {
    editPostMutation.mutate({ appName, postType, id, title, content });
  };

  return {
    handleDeletePost,
    handleEditPost,
    isDeleting: deletePostMutation.isPending,
    isEditing: editPostMutation.isPending,
    deleteError: deletePostMutation.error,
    editError: editPostMutation.error,
  };
}
