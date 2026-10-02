// hooks/posts/usePostActions.ts
"use client";
import type { Post } from "@/types";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { isAppPath } from "@/lib/utils/appPath";
import { toast } from "react-toastify";


import { deleteAPost, editAPost } from "@/serverActions/posts";

export function usePostActions() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();

  //알람 처리
  const notifySuccessEvent = (msg: string) => toast.success(msg);
  const notifyErrorEvent = (msg: string) => toast.error(msg);

  // 게시글 삭제
  const deletePostMutation = useMutation({
    mutationFn: deleteAPost,
    onSuccess: (deletedPost, variables) => {
      if (deletedPost) {
        // 실제 게시판 경로로 이동 
        router.push(
          isAppPath(pathname)
            ? `/app/board/${variables.appName}/${variables.postType}`
            : `/project/${variables.appName}/board/${variables.postType}`,
        );

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
    onError: () => {
      notifyErrorEvent(`게시글 삭제에 실패했습니다!`);
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
          (oldPost: Post | null | undefined) => {
            if (!oldPost) return oldPost;

            return {
              ...oldPost,
              title: updatedPost.title,
              content: updatedPost.content,
            };
          },
        );
        notifySuccessEvent(`게시글이 수정되었습니다!`);
      } else {
        notifyErrorEvent(`게시글 수정에 실패했습니다!`);
      }
    },
    onError: () => {
      notifyErrorEvent(`게시글 수정에 실패했습니다!`);
    },
  });

  const handleDeletePost = (appName: string, postType: string, id: string) => {
    deletePostMutation.mutate({ appName, postType, id });
  };

  // 수정이 성공했을 때만 onDone 이 호출된다 (편집 모드 닫기 등)
  const handleEditPost = (
    appName: string,
    postType: string,
    id: string,
    title: string,
    content: string,
    onDone?: () => void,
  ) => {
    editPostMutation.mutate(
      { appName, postType, id, title, content },
      {
        onSuccess: (updatedPost) => {
          if (updatedPost) onDone?.();
        },
      },
    );
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