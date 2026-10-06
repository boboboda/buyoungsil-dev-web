// components/admin/categories/CategoryManageTable.tsx
"use client";

import {
  Button,
  Chip,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  useDisclosure,
} from "@heroui/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";

import {
  deleteCategory,
  toggleCategoryPublish,
} from "@/serverActions/noteCategoryActions";
import { getGradientClasses } from "@/lib/note/categoryUtils";

import CategoryFormModal, { CategoryRow } from "./CategoryFormModal";

interface CategoryTableProps {
  categories: CategoryRow[];
}

export default function CategoryManageTable({ categories }: CategoryTableProps) {
  const router = useRouter();
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  const setLoading = (id: string, loading: boolean) =>
    setLoadingIds((prev) => {
      const next = new Set(prev);

      if (loading) next.add(id);
      else next.delete(id);

      return next;
    });

  const openCreate = () => {
    setEditing(null);
    onOpen();
  };

  const openEdit = (category: CategoryRow) => {
    setEditing(category);
    onOpen();
  };

  // 공개/비공개 토글
  const handleTogglePublish = async (id: string, currentStatus: boolean) => {
    setLoading(id, true);

    try {
      await toggleCategoryPublish(id);
      toast.success(`카테고리가 ${!currentStatus ? "공개" : "비공개"}되었습니다.`);
      router.refresh();
    } catch (error) {
      console.error("Toggle error:", error);
      toast.error("상태 변경에 실패했습니다.");
    } finally {
      setLoading(id, false);
    }
  };

  // 삭제 (글이 남아 있으면 서버가 막는다)
  const handleDelete = async (category: CategoryRow) => {
    if (!window.confirm(`'${category.name}' 카테고리를 삭제할까요?`)) return;

    setLoading(category.id, true);

    try {
      const result = await deleteCategory(category.id);

      if (result.success) {
        toast.success("카테고리를 삭제했습니다.");
        router.refresh();
      } else {
        toast.error(result.error ?? "삭제에 실패했습니다.");
      }
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("삭제 중 오류가 발생했습니다.");
    } finally {
      setLoading(category.id, false);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold sm:text-3xl">🏷️ 카테고리 관리</h1>
          <Button className="shrink-0" color="primary" onPress={openCreate}>
            + 카테고리 추가
          </Button>
        </div>
        <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
          <p className="mb-2 text-sm text-blue-800 dark:text-blue-200">
            💡 <strong>카테고리 공개/비공개란?</strong>
          </p>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            • <strong>비공개</strong>: 사용자에게 카테고리 카드 자체가 표시되지 않음 (컨텐츠 준비 중)
          </p>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            • <strong>공개</strong>: 사용자가 /note 페이지에서 카테고리 카드를 보고 클릭할 수 있음
          </p>
          <p className="mt-2 text-sm text-blue-700 dark:text-blue-300">
            • 새 카테고리는 글이 어느 정도 쌓인 뒤에 공개하는 것이 검색/애드센스에 유리합니다.
          </p>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <Table aria-label="카테고리 관리 테이블">
          <TableHeader>
            <TableColumn className="hidden sm:table-cell">순서</TableColumn>
            <TableColumn className="hidden sm:table-cell">카드</TableColumn>
            <TableColumn>이름</TableColumn>
            <TableColumn className="hidden md:table-cell">SLUG</TableColumn>
            <TableColumn className="hidden lg:table-cell">설명</TableColumn>
            <TableColumn>공개 상태</TableColumn>
            <TableColumn>관리</TableColumn>
          </TableHeader>
          <TableBody emptyContent="등록된 카테고리가 없습니다.">
            {categories.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="hidden sm:table-cell">
                  <Chip size="sm" variant="flat">
                    {category.order}
                  </Chip>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {category.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={`${category.name} 이미지`}
                      className="h-9 w-16 rounded object-cover"
                      src={category.imageUrl}
                    />
                  ) : (
                    <div
                      className={`flex h-9 w-16 items-center justify-center rounded bg-gradient-to-br ${getGradientClasses(category.gradient)}`}
                    >
                      <span className="text-xl">{category.icon || "📝"}</span>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-base font-semibold sm:text-lg">
                    <span className="mr-1 sm:hidden">{category.icon || "📝"}</span>
                    {category.name}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <code className="rounded bg-gray-100 px-2 py-1 text-sm dark:bg-gray-800">
                    {category.slug}
                  </code>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {category.description?.substring(0, 50)}
                    {category.description && category.description.length > 50
                      ? "..."
                      : ""}
                  </span>
                </TableCell>
                <TableCell>
                  <Switch
                    color={category.isPublished ? "success" : "default"}
                    isDisabled={loadingIds.has(category.id)}
                    isSelected={category.isPublished}
                    size="sm"
                    onValueChange={() =>
                      handleTogglePublish(category.id, category.isPublished)
                    }
                  >
                    {category.isPublished ? "🟢 공개" : "🔴 비공개"}
                  </Switch>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      isDisabled={loadingIds.has(category.id)}
                      size="sm"
                      variant="flat"
                      onPress={() => openEdit(category)}
                    >
                      수정
                    </Button>
                    <Button
                      color="danger"
                      isDisabled={loadingIds.has(category.id)}
                      size="sm"
                      variant="light"
                      onPress={() => handleDelete(category)}
                    >
                      삭제
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CategoryFormModal
        category={editing}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}