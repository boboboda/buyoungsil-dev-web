"use client";
import type { Post } from "@/types";

import { useQuery } from "@tanstack/react-query";

import { fetchAPost } from "@/serverActions/posts";

export function usePost(
  appName: string,
  postId: string,
  postType: string,
  initialData?: Post,
) {
  return useQuery({
    queryKey: ["post", appName, postId, postType],
    queryFn: () => fetchAPost(appName, postId, postType),
    initialData,
    enabled: !!postId && !!appName,
    staleTime: 5 * 60 * 1000, // 5분
    gcTime: 10 * 60 * 1000, // 10분
  });
}
