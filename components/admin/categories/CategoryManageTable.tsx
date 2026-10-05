"use client";

import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Switch,
  Chip,
} from "@heroui/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { toggleCategoryPublish } from "@/serverActions/noteCategoryActions";

interface CategoryTableProps {
  categories: Array<{
    id: string;
    slug: string;
    name: string;
    description?: string | null;
    icon?: string | null;
    order: number;
    isPublished: boolean;
    createdAt: Date;
  }>;
}

export default function CategoryManageTable({ categories }: CategoryTableProps) {
  const router = useRouter();
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  // 🔥 Server Action 사용한 공개/비공개 토글
  const handleTogglePublish = async (id: string, currentStatus: boolean) => {
    setLoadingIds(prev => new Set(prev).add(id));

    try {
      await toggleCategoryPublish(id);
      
      toast.success(
        `카테고리가 ${!currentStatus ? "공개" : "비공개"}되었습니다.`
      );
      router.refresh();
    } catch (error) {
      console.error("Toggle error:", error);
      toast.error("상태 변경에 실패했습니다.");
    } finally {
      setLoadingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4">🏷️ 카테고리 관리</h1>
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
            💡 <strong>카테고리 공개/비공개란?</strong>
          </p>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            • <strong>비공개</strong>: 사용자에게 카테고리 카드 자체가 표시되지 않음 (컨텐츠 준비 중)
          </p>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            • <strong>공개</strong>: 사용자가 /note 페이지에서 카테고리 카드를 보고 클릭할 수 있음
          </p>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <Table aria-label="카테고리 관리 테이블">
          <TableHeader>
            <TableColumn className="hidden sm:table-cell">순서</TableColumn>
            <TableColumn className="hidden sm:table-cell">아이콘</TableColumn>
            <TableColumn>이름</TableColumn>
            <TableColumn className="hidden md:table-cell">SLUG</TableColumn>
            <TableColumn className="hidden lg:table-cell">설명</TableColumn>
            <TableColumn>공개 상태</TableColumn>
          </TableHeader>
          <TableBody>
            {categories.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="hidden sm:table-cell">
                  <Chip size="sm" variant="flat">
                    {category.order}
                  </Chip>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <span className="text-2xl">{category.icon || "📝"}</span>
                </TableCell>
                <TableCell>
                  <span className="font-semibold text-base sm:text-lg">
                    <span className="sm:hidden mr-1">{category.icon || "📝"}</span>
                    {category.name}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <code className="text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                    {category.slug}
                  </code>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {category.description?.substring(0, 50)}
                    {category.description && category.description.length > 50 ? "..." : ""}
                  </span>
                </TableCell>
                <TableCell>
                  <Switch
                    size="sm"
                    isSelected={category.isPublished}
                    onValueChange={() =>
                      handleTogglePublish(category.id, category.isPublished)
                    }
                    isDisabled={loadingIds.has(category.id)}
                    color={category.isPublished ? "success" : "default"}
                  >
                    {category.isPublished ? "🟢 공개" : "🔴 비공개"}
                  </Switch>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {categories.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          등록된 카테고리가 없습니다.
        </div>
      )}
    </div>
  );
}