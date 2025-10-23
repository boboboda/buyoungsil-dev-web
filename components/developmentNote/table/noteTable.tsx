"use client";

import { useState, useEffect } from "react";
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
  Tooltip,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import React from "react";
import { toast } from "react-toastify";

import "react-toastify/dist/ReactToastify.css";

import { SearchIcon, ChevronDownIcon, EditIcon, DeleteIcon } from "../../icons";

import { capitalize } from "@/lib/utils";
import { noteColumns } from "@/types";
import { Note } from "@/store/editorSotre";
import { useNoteStore } from "@/components/providers/editor-provider";

const AdminNoteTable = ({ notes }: { notes: Note[] }) => {
  const [filterValue, setFilterValue] = React.useState("");

  const [selectedKeys, setSelectedKeys] = React.useState<Selection>(
    new Set([]),
  );

  const INITIAL_VISIBLE_COLUMNS = [
    "noteId",
    "mainCategory",
    "subCategory",
    "title",
    "actions",
  ];

  const [visibleColumns, setVisibleColumns] = React.useState<Selection>(
    new Set(INITIAL_VISIBLE_COLUMNS),
  );

  const [rowsPerPage, setRowsPerPage] = React.useState(5);

  const [sortDescriptor, setSortDescriptor] = React.useState<SortDescriptor>({
    column: "notetId",
    direction: "ascending",
  });

  const { deleteToServer } = useNoteStore((state) => state);

  const notifySuccessEvent = (msg: string) => toast.success(msg);

  const notifyfailedEvent = (msg: string) => toast.error(msg);

  const handleNoteDelete = async (noteId: string) => {
    const result = await deleteToServer(noteId);

    if (result) {
      notifySuccessEvent("성공적으로 삭제되었습니다.");
      router.refresh();
    } else {
      notifyfailedEvent("삭제가 실패되었습니다.");
    }
  };

  const router = useRouter();

  // 페이지
  const [page, setPage] = React.useState(1);

  //검색
  const hasSearchFilter = Boolean(filterValue);

  const [windowWidth, setWindowWidth] = useState(innerWidth);

  const setVisibleColumnsForWindowWidth = () => {
    if (windowWidth <= 700) {
      setVisibleColumns(
        new Set(["title", "noteId", "mainCategory", "subCategory"]),
      );
    } else {
      setVisibleColumns(new Set(INITIAL_VISIBLE_COLUMNS));
    }
  };

  useEffect(() => {
    // window 크기가 변경될 때마다
    window.addEventListener("resize", () => {
      setWindowWidth(innerWidth);
    });
  }, []);

  useEffect(() => {
    setVisibleColumnsForWindowWidth();
  }, [windowWidth]);

  //해더 컬럼
  const headerColumns = React.useMemo(() => {
    if (visibleColumns === "all") return noteColumns;

    return noteColumns.filter((column) =>
      Array.from(visibleColumns).includes(column.uid),
    );
  }, [visibleColumns]);

  //아이템 필터-검색용도
  const filteredItems = React.useMemo(() => {
    let filteredNotes = [...notes];

    if (hasSearchFilter) {
      filteredNotes = filteredNotes.filter((notes) =>
        notes.title!.toLowerCase().includes(filterValue.toLowerCase()),
      );
    }

    return filteredNotes;
  }, [notes, filterValue]);

  //페이지 관련
  const pages = Math.ceil(filteredItems.length / rowsPerPage);

  const items = React.useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;

    return filteredItems.slice(start, end);
  }, [page, filteredItems, rowsPerPage]);

  // 정렬관련- 날짜 관련 cmp 수정 필요
  const sortedItems = React.useMemo(() => {
    return [...items].sort((a: Note, b: Note) => {
      const first = a[sortDescriptor.column as keyof Note] as string;
      const second = b[sortDescriptor.column as keyof Note] as string;
      const cmp = first < second ? -1 : first > second ? 1 : 0;

      return sortDescriptor.direction === "descending" ? -cmp : cmp;
    });
  }, [sortDescriptor, items]);

  const renderCell = React.useCallback(
    (note: Note, columnKey: any) => {
      const cellValue = note[columnKey as keyof Note];

      switch (columnKey) {
        case "noteId":
          return (
            <h1 key={note.noteId} className="flex justify-center">
              {note.noteId}
            </h1>
          );
        case "mainCategory":
          return (
            <h1 key={note.noteId} className="flex justify-center">
              {note.mainCategory}
            </h1>
          );
        case "subCategory":
          return (
            <h1 key={note.noteId} className="flex justify-center">
              {note.subCategory!.name}
            </h1>
          );
        case "title":
          return (
            <h1 key={note.id} className="flex justify-center cursor-pointer">
              {note.title}
            </h1>
          );

        // case "create_at":
        //   return (
        //     <h1 className="flex w-full text-center items-center justify-center" key={note.id}>
        //       {note.create_at}
        //     </h1>
        //   );
        case "actions":
          return (
            <div className="relative flex justify-center space-x-3">
              <Tooltip content="Edit Note">
                <button
                  className="text-lg text-default-400 cursor-pointer active:opacity-50"
                  onClick={(event) => {
                    router.push(`write/${note.noteId}`);
                  }}
                >
                  <EditIcon />
                </button>
              </Tooltip>
              <Tooltip color="danger" content="Delete Note">
                <button
                  className="text-lg text-danger cursor-pointer active:opacity-50"
                  onClick={async (event) => {
                    await handleNoteDelete(note.noteId?.toString()!);
                    console.log("삭제눌렀다고");
                  }}
                >
                  <DeleteIcon />
                </button>
              </Tooltip>
            </div>
          );
        default:
          return cellValue;
      }
    },
    [notes],
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
                {noteColumns.map((column) => (
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
            Total {notes.length} notes
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
    notes.length,
    hasSearchFilter,
  ]);

  //바텀뷰
  const bottomContent = React.useMemo(() => {
    return (
      <div className="py-2 px-2 flex justify-end items-center">
        {/* <span className="w-[30%] text-small text-default-400">
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
        /> */}
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
    <>
      <Table
        isHeaderSticky
        aria-label="table with custom cells, pagination and sorting"
        bottomContent={bottomContent}
        bottomContentPlacement="outside"
        classNames={{
          base: "max-h-[382px] md:max-w-[80%] mx-auto",
          thead: "w-full",
          tbody: "w-full",
          table: "w-full min-w-full",
          th: "bg-default-100 sticky top-0 z-10",
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
              className="text-center"
            >
              {column.name}
            </TableColumn>
          )}
        </TableHeader>
        <TableBody
          emptyContent={"보여줄 게시글이 없습니다"}
          items={sortedItems}
        >
          {(item) =>
            item && (
              <TableRow key={item.noteId}>
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
    </>
  );
};

export default AdminNoteTable;
