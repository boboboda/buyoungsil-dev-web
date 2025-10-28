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
import { toggleStoryPublish, deleteStory } from "@/serverActions/stories";

interface Story {
  id: string;
  slug: string;
  title: string;
  category: string;
  isPublished: boolean;
  viewCount: number;
  createdAt: Date;
}

export default function StoryListTable({ stories }: { stories: Story[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handleTogglePublish = async (id: string) => {
    setLoading(id);
    try {
      await toggleStoryPublish(id);
      toast.success("공개 상태가 변경되었습니다");
      router.refresh();
    } catch (error) {
      toast.error("상태 변경에 실패했습니다");
    } finally {
      setLoading(null);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`"${title}" 스토리를 삭제하시겠습니까?`)) return;

    setLoading(id);
    try {
      await deleteStory(id);
      toast.success("스토리가 삭제되었습니다");
      router.refresh();
    } catch (error) {
      toast.error("삭제에 실패했습니다");
    } finally {
      setLoading(null);
    }
  };

  const categoryColor = {
    "삽질기": "warning",
    "꿀팁": "success",
    "일상": "primary"
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
      <Table aria-label="스토리 관리 테이블">
        <TableHeader>
          <TableColumn>제목</TableColumn>
          <TableColumn>카테고리</TableColumn>
          <TableColumn>조회수</TableColumn>
          <TableColumn>공개</TableColumn>
          <TableColumn>작성일</TableColumn>
          <TableColumn>액션</TableColumn>
        </TableHeader>
        <TableBody>
          {stories.map((story) => (
            <TableRow key={story.id}>
              <TableCell>
                <Link
                  href={`/stories/${story.slug}`}
                  target="_blank"
                  className="text-blue-600 hover:text-blue-800 font-medium"
                >
                  {story.title}
                </Link>
              </TableCell>
              <TableCell>
                <Chip
                  color={categoryColor[story.category as keyof typeof categoryColor] as any}
                  variant="flat"
                  size="sm"
                >
                  {story.category}
                </Chip>
              </TableCell>
              <TableCell>
                👁️ {story.viewCount.toLocaleString()}
              </TableCell>
              <TableCell>
                <Switch
                  isSelected={story.isPublished}
                  onValueChange={() => handleTogglePublish(story.id)}
                  isDisabled={loading === story.id}
                  color={story.isPublished ? "success" : "default"}
                  size="sm"
                >
                  {story.isPublished ? "🟢" : "🔴"}
                </Switch>
              </TableCell>
              <TableCell>
                {new Date(story.createdAt).toLocaleDateString('ko-KR')}
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Link href={`/admin/stories/edit/${story.id}`}>
                    <Button size="sm" color="primary" variant="flat">
                      수정
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    onPress={() => handleDelete(story.id, story.title)}
                    isLoading={loading === story.id}
                  >
                    삭제
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {stories.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          작성된 스토리가 없습니다.
        </div>
      )}
    </div>
  );
}