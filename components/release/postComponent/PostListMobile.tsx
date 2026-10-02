"use client";

import { Button, Input, Pagination } from "@heroui/react";
import { useRouter } from "next/navigation";
import React from "react";

import { useBoardBase, useViewer } from "@/components/app/AppViewerContext";
import { PostSummary } from "@/types";

import { SearchIcon, PlusIcon } from "../../icons";

const PAGE_SIZE = 10;

// 한국 시간(KST) 기준 연, 월, 일을 꺼낸다.
const kstParts = (value?: string) => {
  if (!value) return null;

  const d = new Date(value);

  if (Number.isNaN(d.getTime())) return null;

  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const pick = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return { year: pick("year"), month: pick("month"), day: pick("day") };
};

// 올해 글은 10.03, 지난해 이전 글은 25.10.03 으로 짧게 보여준다.
const formatListDate = (value?: string) => {
  const p = kstParts(value);

  if (!p) return value ?? "";

  const thisYear = kstParts(new Date().toISOString())?.year;

  return p.year === thisYear
    ? `${p.month}.${p.day}`
    : `${p.year.slice(2)}.${p.month}.${p.day}`;
};

const PostListMobile = ({
  posts,
  appName,
  postType,
}: {
  posts: PostSummary[];
  appName: string;
  postType: string;
}) => {
  const router = useRouter();
  const { isAdmin } = useViewer();
  const base = useBoardBase(appName, postType);

  const isNotice = postType === "notice";
  // 공지사항은 관리자만, 문의 게시판은 누구나 글쓰기 버튼이 보인다.
  const canWrite = !isNotice || isAdmin;

  const [filterValue, setFilterValue] = React.useState("");
  const [page, setPage] = React.useState(1);

  // 검색 후 최신 글이 위로 오도록 정렬한다.
  const filtered = React.useMemo(() => {
    const keyword = filterValue.trim().toLowerCase();
    const list = keyword
      ? posts.filter((p) => p.title.toLowerCase().includes(keyword))
      : [...posts];

    return list.sort(
      (a, b) =>
        (Date.parse(b.created_at ?? "") || 0) -
        (Date.parse(a.created_at ?? "") || 0),
    );
  }, [posts, filterValue]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);

  const items = React.useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;

    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  const onSearchChange = React.useCallback((value?: string) => {
    setFilterValue(value ?? "");
    setPage(1);
  }, []);

  const emptyText = filterValue
    ? "검색 결과가 없습니다."
    : isNotice
      ? "등록된 공지사항이 없습니다."
      : "등록된 문의가 없습니다.";

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <Input
          isClearable
          className="min-w-0 flex-1"
          placeholder="제목 검색"
          startContent={<SearchIcon />}
          value={filterValue}
          onClear={() => onSearchChange("")}
          onValueChange={onSearchChange}
        />
        {canWrite && (
          <Button
            className="shrink-0"
            color="primary"
            endContent={<PlusIcon />}
            onPress={() => router.push(`${base}/write`)}
          >
            글쓰기
          </Button>
        )}
      </div>

      <span className="text-small text-default-400">
        총 {filtered.length}개
      </span>

      {items.length === 0 ? (
        <p className="py-12 text-center text-small text-default-400">
          {emptyText}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider border-y border-divider">
          {items.map((post) => (
            <li key={post.id}>
              <button
                className="flex w-full min-w-0 flex-col gap-1.5 px-1 py-3.5 text-left active:bg-default-100"
                type="button"
                onClick={() => router.push(`${base}/detail/${post.id}`)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
                    {post.title}
                  </span>
                  {post.commentCount > 0 && (
                    <span className="shrink-0 text-xs font-bold text-primary">
                      {post.commentCount}
                    </span>
                  )}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-xs text-default-400 tabular-nums">
                  {!isNotice && (
                    <>
                      <span className="truncate">{post.writer}</span>
                      <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-default-400" />
                    </>
                  )}
                  <span className="shrink-0">
                    {formatListDate(post.created_at)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex justify-center">
          <Pagination
            isCompact
            showControls
            color="primary"
            page={currentPage}
            total={pages}
            onChange={setPage}
          />
        </div>
      )}
    </div>
  );
};

export default PostListMobile;