"use client";

import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Button,
  Chip,
  Switch
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { useState } from "react";
import Link from "next/link";
import { noteCategoryInfo } from "@/types";
import { toggleNotePublish } from "@/serverActions/editorServerAction";

interface Note {
  noteId: number;
  title: string | null;
  mainCategory: string | null;
  subCategory: any;
  level: string;
  isPublished: boolean;
  createdAt: Date;
}

interface NoteManageTableProps {
  notes: Note[];
}

export default function NoteManageTable({ notes }: NoteManageTableProps) {
  const router = useRouter();
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());

  const handleTogglePublish = async (noteId: number, currentStatus: boolean) => {
    setLoadingIds(prev => new Set(prev).add(noteId));

    try {
      await toggleNotePublish(noteId);
      
      toast.success(
        `노트가 ${!currentStatus ? "공개" : "비공개"}되었습니다.`
      );
      router.refresh();
    } catch (error) {
      console.error("Toggle error:", error);
      toast.error("상태 변경에 실패했습니다.");
    } finally {
      setLoadingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(noteId);
        return newSet;
      });
    }
  };

  return (
    <div>
      {/* 헤더 - 제목과 버튼 */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">📚 개발노트 관리</h1>
        <Link href="/admin/write">
          <Button color="primary" size="lg">
            ✍️ 새 노트 작성
          </Button>
        </Link>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
          <p className="text-sm text-gray-500 mb-1">전체 노트</p>
          <p className="text-2xl font-bold">{notes.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
          <p className="text-sm text-gray-500 mb-1">공개</p>
          <p className="text-2xl font-bold text-green-500">
            {notes.filter((n) => n.isPublished).length}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
          <p className="text-sm text-gray-500 mb-1">비공개</p>
          <p className="text-2xl font-bold text-orange-500">
            {notes.filter((n) => !n.isPublished).length}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow">
          <p className="text-sm text-gray-500 mb-1">최근 7일</p>
          <p className="text-2xl font-bold text-blue-500">
            {notes.filter((n) => {
              const weekAgo = new Date();
              weekAgo.setDate(weekAgo.getDate() - 7);
              return new Date(n.createdAt) > weekAgo;
            }).length}
          </p>
        </div>
      </div>

      {/* 테이블 */}
      <Table aria-label="개발노트 관리 테이블">
        <TableHeader>
          <TableColumn>ID</TableColumn>
          <TableColumn>제목</TableColumn>
          <TableColumn>카테고리</TableColumn>
          <TableColumn>레벨</TableColumn>
          <TableColumn>공개</TableColumn>
          <TableColumn>작성일</TableColumn>
          <TableColumn>액션</TableColumn>
        </TableHeader>
        <TableBody>
          {notes.map((note) => {
            const categoryInfo = note.mainCategory 
              ? noteCategoryInfo[note.mainCategory as keyof typeof noteCategoryInfo]
              : null;

            return (
              <TableRow key={note.noteId}>
                <TableCell>
                  <span className="font-mono text-sm">{note.noteId}</span>
                </TableCell>
                
                <TableCell>
                  <span className="font-semibold">
                    {note.title || "제목 없음"}
                  </span>
                </TableCell>
                
                <TableCell>
                  {categoryInfo ? (
                    <Chip size="sm" variant="flat">
                      {categoryInfo.icon} {categoryInfo.name}
                    </Chip>
                  ) : (
                    <Chip size="sm" variant="flat">
                      ❓ {note.mainCategory || "없음"}
                    </Chip>
                  )}
                </TableCell>
                
                <TableCell>
                  <Chip 
                    size="sm"
                    color={
                      note.level === "BEGINNER" ? "success" :
                      note.level === "INTERMEDIATE" ? "warning" :
                      "danger"
                    }
                  >
                    {note.level === "BEGINNER" ? "🟢 초급" :
                     note.level === "INTERMEDIATE" ? "🟡 중급" :
                     "🔴 고급"}
                  </Chip>
                </TableCell>
                
                <TableCell>
                  <Switch
                    size="sm"
                    isSelected={note.isPublished}
                    onValueChange={() =>
                      handleTogglePublish(note.noteId, note.isPublished)
                    }
                    isDisabled={loadingIds.has(note.noteId)}
                    color={note.isPublished ? "success" : "default"}
                  >
                    {note.isPublished ? "공개" : "비공개"}
                  </Switch>
                </TableCell>
                
                <TableCell>
                  <span className="text-sm text-gray-600">
                    {new Date(note.createdAt).toLocaleDateString('ko-KR')}
                  </span>
                </TableCell>
                
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      color="primary"
                      variant="flat"
                      onPress={() => router.push(`/admin/write/${note.noteId}`)}
                    >
                      수정
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      onPress={() => router.push(`/note/detail/${note.noteId}`)}
                    >
                      보기
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}