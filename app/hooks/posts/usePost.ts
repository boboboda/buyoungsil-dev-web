"use client";
import type { Post } from "@/types";

import { useQuery } from "@tanstack/react-query";

import { fetchAPost } from "@/serverActions/posts";

// 인자 순서: (appName, postType, postId) — usePostDetail / 댓글 mutation 의 캐시 키와 동일하게 맞춘다.
export function usePost(
  appName: string,
  postType: string,
  postId: string,
  initialData?: Post | null,
) {
  return useQuery({
    queryKey: ["post", appName, postType, postId],
    // fetchAPost 의 시그니처는 (appName, id, postType)
    queryFn: () => fetchAPost(appName, postId, postType),
    initialData: initialData ?? undefined,
    enabled: !!postId && !!appName,
    staleTime: 5 * 60 * 1000, // 5분
    gcTime: 10 * 60 * 1000, // 10분
  });
}