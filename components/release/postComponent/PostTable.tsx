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
import { Post, PostSummary } from "@/types";

const PostTable = ({
  posts,
  appName,
  postType,
}: {
  posts: PostSummary[];
  appName: string;
  postType: string;
}) => {
  const { data: session, status } = useSession();

  const isAdmin = session?.user.role === "admin";

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
    column: "create_at",
    direction: "ascending",
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

  const filteredItems = React.useMemo(() => {
    let filteredPosts = [...posts];

    if (hasSearchFilter) {
      filteredPosts = filteredPosts.filter((Posts) =>
        Posts.title.toLowerCase().includes(filterValue.toLowerCase()),
      );
    }

    return filteredPosts;
  }, [posts, filterValue]);

  const pages = Math.ceil(filteredItems.length / rowsPerPage);

  const items = React.useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;

    return filteredItems.slice(start, end);
  }, [page, filteredItems, rowsPerPage]);

  const sortedItems = React.useMemo(() => {
    return [...items].sort((a: PostSummary, b: PostSummary) => {
      const first = a[sortDescriptor.column as keyof PostSummary] as string;
      const second = b[sortDescriptor.column as keyof PostSummary] as string;
      const cmp = first < second ? -1 : first > second ? 1 : 0;

      return sortDescriptor.direction === "descending" ? -cmp : cmp;
    });
  }, [sortDescriptor, items]);

  const renderCell = React.useCallback(
    (post: any, columnKey: any) => {
      const cellValue = post[columnKey as keyof Post];

      switch (columnKey) {
        case "listNumber":
          return (
            <h1 key={post.id} className="flex justify-center">
              {post.listNumber}
            </h1>
          );
        case "writer":
          return (
            <h1 key={post.id} className="flex justify-center">
              {post.writer}
            </h1>
          );
        case "title":
          return (
            <h1
              key={post.id}
              className="flex justify-center cursor-pointer"
              onClick={() => {
                router.push(
                  `/project/${appName}/board/${postType}/detail/${post.id}`,
                );
              }}
            >
              {post.title}
            </h1>
          );

        case "create_at":
          return (
            <h1
              key={post.id}
              className="flex w-full text-center items-center justify-center"
            >
              {post.create_at}
            </h1>
          );
        default:
          return cellValue;
      }
    },
    [posts],
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
    posts.length,
    hasSearchFilter,
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
  }, [selectedKeys, items.length, page, pages, hasSearchFilter]);

  return (
    <Table
      isHeaderSticky
      aria-label="Example table with custom cells, pagination and sorting"
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
        {(item) =>
          item && (
            <TableRow key={item.id}>
              {(columnKey) => (
                <TableCell className=" text-center">
                  {renderCell(item, columnKey)}
                </TableCell>
              )}
            </TableRow>
          )
        }
      </TableBody>
    </Table>
  );
};

export default PostTable;