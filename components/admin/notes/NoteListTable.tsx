"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Button,
  Switch
} from "@heroui/react";
import { toast } from "react-toastify";
import { toggleNotePublish } from "@/serverActions/editorServerAction";

interface Note {
  id: string;
  noteId: number;
  title: string | null;
  mainCategory: string | null;
  isPublished: boolean;
  createdAt: Date;
}

export default function NoteListTable({ notes }: { notes: Note[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState<number | null>(null);

  const handleTogglePublish = async (noteId: number) => {
    setLoading(noteId);
    try {
      await toggleNotePublish(noteId);
      toast.success("공개 상태가 변경되었습니다");
      router.refresh();
    } catch (error) {
      toast.error("상태 변경에 실패했습니다");
    } finally {
      setLoading(null);
    }
  };

  const categoryColor: Record<string, any> = {
    "프론트엔드": "primary",
    "백엔드": "success",
    "모바일": "warning",
    "데이터베이스": "secondary",
    "인프라": "danger",
    "기타": "default"
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
      <Table aria-label="개발노트 관리 테이블">
        <TableHeader>
          <TableColumn>번호</TableColumn>
          <TableColumn>제목</TableColumn>
          <TableColumn>카테고리</TableColumn>
          <TableColumn>공개</TableColumn>
          <TableColumn>작성일</TableColumn>
          <TableColumn>액션</TableColumn>
        </TableHeader>
        <TableBody>
          {notes.map((note) => (
            <TableRow key={note.id}>
              <TableCell>{note.noteId}</TableCell>
              <TableCell>
                <Link
                  href={`/note/detail/${note.noteId}`}
                  target="_blank"
                  className="text-blue-600 hover:text-blue-800 font-medium"
                >
                  {note.title || "제목 없음"}
                </Link>
              </TableCell>
              <TableCell>
                {note.mainCategory ? (
                  <Chip
                    color={categoryColor[note.mainCategory] || "default"}
                    variant="flat"
                    size="sm"
                  >
                    {note.mainCategory}
                  </Chip>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </TableCell>
              <TableCell>
                <Switch
                  isSelected={note.isPublished}
                  onValueChange={() => handleTogglePublish(note.noteId)}
                  isDisabled={loading === note.noteId}
                  color={note.isPublished ? "success" : "default"}
                  size="sm"
                >
                  {note.isPublished ? "🟢" : "🔴"}
                </Switch>
              </TableCell>
              <TableCell>
                {new Date(note.createdAt).toLocaleDateString('ko-KR')}
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Link href={`/admin/notes/edit/${note.noteId}`}>
                    <Button size="sm" color="primary" variant="flat">
                      수정
                    </Button>
                  </Link>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {notes.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          작성된 노트가 없습니다.
        </div>
      )}
    </div>
  );
}