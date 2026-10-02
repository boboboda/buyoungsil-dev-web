"use client";

import {
  Table,
  Input,
  Button,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Selection,
  SortDescriptor,
  Pagination,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import React from "react";
import "react-toastify/dist/ReactToastify.css";

import { useSession } from "next-auth/react";

import { SearchIcon, ChevronDownIcon, PlusIcon } from "../../icons";

import { columns } from "@/types";
import { capitalize } from "@/lib/utils";
import { PostSummary } from "@/types";

// 날짜를 한국 시간(KST) 기준 YYYY-MM-DD 로 표시
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

const PostTable = ({
  posts,
  appName,
  postType,
}: {
  posts: PostSummary[];
  appName: string;
  postType: string;
}) => {
  const { data: session } = useSession();

  const isAdmin = session?.user?.role === "admin";

  // 공지사항은 관리자만, 문의 게시판은 누구나(비로그인은 write 페이지에서 로그인으로 이동)
  const canWrite = postType !== "notice" || isAdmin;

  const [filterValue, setFilterValue] = React.useState("");

  const [selectedKeys, setSelectedKeys] = React.useState<Selection>(
    new Set([]),
  );

  const INITIAL_VISIBLE_COLUMNS = [
    "listNumber",
    "title",
    "writer",
    "created_at",
  ];

  const [visibleColumns, setVisibleColumns] = React.useState<Selection>(
    new Set(INITIAL_VISIBLE_COLUMNS),
  );

  const [rowsPerPage, setRowsPerPage] = React.useState(5);

  const [sortDescriptor, setSortDescriptor] = React.useState<SortDescriptor>({
    column: "created_at",
    direction: "descending",
  });

  const router = useRouter();

  const [page, setPage] = React.useState(1);

  const hasSearchFilter = Boolean(filterValue);

  const headerColumns = React.useMemo(() => {
    if (visibleColumns === "all") return columns;

    return columns.filter((column) =>
      Array.from(visibleColumns).includes(column.uid),
    );
  }, [visibleColumns]);

  // 검색 → 정렬 → 페이지 순서로 처리 (정렬이 현재 페이지에만 적용되던 문제 수정)
  const filteredItems = React.useMemo(() => {
    let filteredPosts = [...posts];

    if (hasSearchFilter) {
      filteredPosts = filteredPosts.filter((p) =>
        p.title.toLowerCase().includes(filterValue.toLowerCase()),
      );
    }

    return filteredPosts;
  }, [posts, filterValue, hasSearchFilter]);

  const sortedAll = React.useMemo(() => {
    return [...filteredItems].sort((a: PostSummary, b: PostSummary) => {
      const col = sortDescriptor.column as keyof PostSummary;
      let cmp: number;

      if (col === "listNumber") {
        cmp = Number(a.listNumber) - Number(b.listNumber);
      } else {
        const first = String(a[col] ?? "");
        const second = String(b[col] ?? "");

        cmp = first < second ? -1 : first > second ? 1 : 0;
      }

      return sortDescriptor.direction === "descending" ? -cmp : cmp;
    });
  }, [sortDescriptor, filteredItems]);

  const pages = Math.max(1, Math.ceil(sortedAll.length / rowsPerPage));

  const sortedItems = React.useMemo(() => {
    const start = (page - 1) * rowsPerPage;

    return sortedAll.slice(start, start + rowsPerPage);
  }, [page, sortedAll, rowsPerPage]);

  const renderCell = React.useCallback(
    (post: PostSummary, columnKey: React.Key) => {
      switch (columnKey) {
        case "listNumber":
          return (
            <span className="flex justify-center">{post.listNumber}</span>
          );
        case "writer":
          return <span className="flex justify-center">{post.writer}</span>;
        case "title":
          return (
            <span
              className="flex justify-center cursor-pointer hover:underline"
              onClick={() => {
                router.push(
                  `/project/${appName}/board/${postType}/detail/${post.id}`,
                );
              }}
            >
              {post.title}
              {post.commentCount > 0 && (
                <span className="ml-1 text-primary">[{post.commentCount}]</span>
              )}
            </span>
          );
        case "created_at":
          return (
            <span className="flex w-full text-center items-center justify-center">
              {formatDate(post.created_at)}
            </span>
          );
        default:
          return null;
      }
    },
    [router, appName, postType],
  );

  const onNextPage = React.useCallback(() => {
    if (page < pages) {
      setPage(page + 1);
    }
  }, [page, pages]);

  const onPreviousPage = React.useCallback(() => {
    if (page > 1) {
      setPage(page - 1);
    }
  }, [page]);

  const onRowsPerPageChange = React.useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setRowsPerPage(Number(e.target.value));
      setPage(1);
    },
    [],
  );

  const onSearchChange = React.useCallback((value?: string) => {
    if (value) {
      setFilterValue(value);
      setPage(1);
    } else {
      setFilterValue("");
    }
  }, []);

  const onClear = React.useCallback(() => {
    setFilterValue("");
    setPage(1);
  }, []);

  const topContent = React.useMemo(() => {
    return (
      <div className="flex flex-col gap-4 ">
        <div className="flex justify-between gap-3 items-end">
          <Input
            isClearable
            className="w-full sm:max-w-[44%]"
            placeholder="제목 검색"
            startContent={<SearchIcon />}
            value={filterValue}
            onClear={() => onClear()}
            onValueChange={onSearchChange}
          />
          <div className="flex gap-3">
            <Dropdown>
              <DropdownTrigger className="flex">
                <Button
                  endContent={<ChevronDownIcon className="text-small" />}
                  variant="flat"
                >
                  Columns
                </Button>
              </DropdownTrigger>
              <DropdownMenu
                disallowEmptySelection
                aria-label="Table Columns"
                closeOnSelect={false}
                selectedKeys={visibleColumns}
                selectionMode="multiple"
                onSelectionChange={setVisibleColumns}
              >
                {columns.map((column) => (
                  <DropdownItem key={column.uid} className="capitalize">
                    {capitalize(column.name)}
                  </DropdownItem>
                ))}
              </DropdownMenu>
            </Dropdown>

            {canWrite && (
              <Button
                color="primary"
                endContent={<PlusIcon />}
                onPress={() =>
                  router.push(`/project/${appName}/board/${postType}/write`)
                }
              >
                글쓰기
              </Button>
            )}
          </div>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-default-400 text-small">
            Total {posts.length} Posts
          </span>
          <label className="flex items-center text-default-400 text-small">
            Rows per page:
            <select
              className="bg-transparent outline-none text-default-400 text-small"
              onChange={onRowsPerPageChange}
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="15">15</option>
            </select>
          </label>
        </div>
      </div>
    );
  }, [
    filterValue,
    visibleColumns,
    onSearchChange,
    onRowsPerPageChange,
    onClear,
    posts.length,
    canWrite,
    router,
    appName,
    postType,
  ]);

  const bottomContent = React.useMemo(() => {
    return (
      <div className="py-2 px-2 flex justify-between items-center">
        <span className="w-[30%] text-small text-default-400">
          {selectedKeys === "all"
            ? "All items selected"
            : `${selectedKeys.size} of ${filteredItems.length} selected`}
        </span>
        <Pagination
          isCompact
          showControls
          showShadow
          color="primary"
          page={page}
          total={pages}
          onChange={setPage}
        />
        <div className="hidden sm:flex w-[30%] justify-end gap-2">
          <Button
            isDisabled={pages === 1}
            size="sm"
            variant="flat"
            onPress={onPreviousPage}
          >
            이전
          </Button>
          <Button
            isDisabled={pages === 1}
            size="sm"
            variant="flat"
            onPress={onNextPage}
          >
            다음
          </Button>
        </div>
      </div>
    );
  }, [
    selectedKeys,
    filteredItems.length,
    page,
    pages,
    onPreviousPage,
    onNextPage,
  ]);

  return (
    <Table
      isHeaderSticky
      aria-label="게시글 목록"
      bottomContent={bottomContent}
      bottomContentPlacement="outside"
      classNames={{
        wrapper: "max-h-[382px]",
      }}
      sortDescriptor={sortDescriptor}
      topContent={topContent}
      topContentPlacement="outside"
      onSortChange={setSortDescriptor}
    >
      <TableHeader columns={headerColumns}>
        {(column) => (
          <TableColumn
            key={column.uid}
            allowsSorting={column.sortable}
            className={`text-center ${column.className || ""}`}
          >
            {column.name}
          </TableColumn>
        )}
      </TableHeader>
      <TableBody emptyContent={"보여줄 게시글이 없습니다"} items={sortedItems}>
        {(item) => (
          <TableRow key={item.id}>
            {(columnKey) => (
              <TableCell className=" text-center">
                {renderCell(item, columnKey)}
              </TableCell>
            )}
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
};

export default PostTable;