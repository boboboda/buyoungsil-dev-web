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
import { noteCategoryInfo } from "@/types";
import { toggleNotePublish } from "@/serverActions/editorServerAction";  // 🔥 추가

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

  // 🔥 서버 액션 사용한 공개/비공개 토글
  const handleTogglePublish = async (noteId: number, currentStatus: boolean) => {
    setLoadingIds(prev => new Set(prev).add(noteId));

    try {
      await toggleNotePublish(noteId);  // 🔥 서버 액션 호출
      
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
  );
}