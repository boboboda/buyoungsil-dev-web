"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input } from "@heroui/react";

import { PostSummary } from "@/types";

const PAGE_SIZE = 10;

const formatDate = (value?: string) => {
  if (!value) return "";
  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

export default function AppPostList({
  posts,
  appName,
  postType,
}: {
  posts: PostSummary[];
  appName: string;
  postType: string;
}) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const isNotice = postType === "notice";
  const base = `/app/board/${appName}/${postType}`;

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();

    return k ? posts.filter((p) => p.title.toLowerCase().includes(k)) : posts;
  }, [posts, keyword]);

  const shown = filtered.slice(0, visible);

  const changeKeyword = (value: string) => {
    setKeyword(value);
    setVisible(PAGE_SIZE);
  };

  return (
    <div className="w-full px-4 py-4 flex flex-col gap-4 box-border">
      <h1 className="text-xl font-bold">{isNotice ? "공지사항" : "문의사항"}</h1>

      <div className="flex items-center gap-2">
        <Input
          isClearable
          className="min-w-0 flex-1"
          placeholder="제목 검색"
          value={keyword}
          onClear={() => changeKeyword("")}
          onValueChange={changeKeyword}
        />
        {!isNotice && (
          <Button
            className="shrink-0"
            color="primary"
            onPress={() => router.push(`${base}/write`)}
          >
            글쓰기
          </Button>
        )}
      </div>

      <p className="text-small text-default-400">총 {filtered.length}건</p>

      {shown.length === 0 ? (
        <div className="py-16 text-center text-default-400">
          보여줄 게시글이 없습니다
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {shown.map((post) => (
            <li key={post.id}>
              <Link
                className="block rounded-xl border border-default-200 bg-content1 px-4 py-3 active:bg-default-100"
                href={`${base}/detail/${post.id}`}
              >
                <div className="break-words font-medium">
                  {post.title}
                  {post.commentCount > 0 && (
                    <span className="ml-1 text-primary">
                      [{post.commentCount}]
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center justify-between text-small text-default-400">
                  <span className="min-w-0 truncate">{post.writer}</span>
                  <span className="ml-2 shrink-0">
                    {formatDate(post.created_at)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {filtered.length > shown.length && (
        <Button variant="flat" onPress={() => setVisible((v) => v + PAGE_SIZE)}>
          더 보기
        </Button>
      )}
    </div>
  );
}