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
  Button,
  Tooltip,
} from "@heroui/react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import Link from "next/link";
import { GradientButton } from "@/components/common/GradientButton";
import { toggleNotePublish } from "@/serverActions/editorServerAction";
import { Pencil, Trash2 } from "lucide-react";

// 🔥 subCategory는 DB에 { id, name } 형태의 JSON으로 저장됨 (types/index.ts의 SubCategory)
interface NoteSubCategory {
  id?: number;
  name: string;
}

interface Note {
  id: string;
  noteId: number;  // 실제 노트 ID (number 타입)
  title: string;
  mainCategory?: string | null;
  subCategory?: string | { id?: number | string; name?: string } | null;
  level?: string | null;
  isPublished: boolean;
  createdAt: Date | string;
}

// 🔥 NoteCategory 테이블에서 내려오는 카테고리 메타 정보 (이름/아이콘/정렬순서는 여기가 기준)
interface CategoryMeta {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  order: number;
  isPublished: boolean;
}

interface NoteManageTableProps {
  notes: Note[];
  categories: CategoryMeta[];
}

const ALL_FILTER = "__all__";

export default function NoteManageTable({ notes, categories }: NoteManageTableProps) {
  const router = useRouter();
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_FILTER);

  // 레벨별 뱃지 색상
  const getLevelColor = (level?: string | null) => {
    switch(level) {
      case 'BEGINNER': return 'success';
      case 'INTERMEDIATE': return 'warning';
      case 'ADVANCED': return 'danger';
      default: return 'default';
    }
  };

  // 레벨 이모지
  const getLevelEmoji = (level?: string | null) => {
    switch(level) {
      case 'BEGINNER': return '🟢';
      case 'INTERMEDIATE': return '🟡';
      case 'ADVANCED': return '🔴';
      default: return '⚪';
    }
  };

  // 레벨 텍스트
  const getLevelText = (level?: string | null) => {
    switch(level) {
      case 'BEGINNER': return '초급';
      case 'INTERMEDIATE': return '중급';
      case 'ADVANCED': return '고급';
      default: return '미지정';
    }
  };

  // 공개/비공개 토글
  const handleTogglePublish = async (noteId: number) => {
    setLoadingIds(prev => new Set(prev).add(noteId));

    try {
      await toggleNotePublish(noteId);
      
      toast.success("노트 공개 상태가 변경되었습니다.");
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

  // 🔥 slug -> { name, icon } 조회용 맵. 실제 카테고리 이름/아이콘은
  //    하드코딩하지 않고 DB(NoteCategory, /admin/categories에서 관리)를 그대로 사용.
  const categoryMap = useMemo(() => {
    const map: Record<string, { name: string; icon: string }> = {};
    categories.forEach((c) => {
      map[c.slug] = { name: c.name, icon: c.icon || "📝" };
    });
    return map;
  }, [categories]);

  // 카테고리 정보 텍스트 (예: "🧩 Kotlin Compose > Layout")
    // 카테고리 정보 텍스트 (예: "🧩 Kotlin Compose > Layout")
  const getCategoryInfo = (mainCategory?: string | null, rawSubCategory?: Note["subCategory"]) => {
    const info = categoryMap[mainCategory || ""] || {
      name: mainCategory || "미분류",
      icon: "📝",
    };

    // subCategory는 { id, name } 객체(예전 데이터는 문자열)라서 그대로 찍으면
    // "[object Object]"가 됨 → name만 꺼내서 표시
    const subCategoryName =
      typeof rawSubCategory === "string" ? rawSubCategory : rawSubCategory?.name;

    if (subCategoryName) {
      return `${info.icon} ${info.name} > ${subCategoryName}`;
    }

    return `${info.icon} ${info.name}`;
  };

  // 🔥 카테고리별 필터 탭에 쓸 노트 개수 (전체 노트 기준, 공개 여부 무관)
  const noteCountBySlug = useMemo(() => {
    const counts: Record<string, number> = {};
    notes.forEach((note) => {
      const slug = note.mainCategory || "";
      counts[slug] = (counts[slug] || 0) + 1;
    });
    return counts;
  }, [notes]);

  // 실제로 노트가 하나라도 있는 카테고리만 탭으로 노출 (order 순서 유지)
  const categoryTabs = useMemo(
    () => categories.filter((c) => (noteCountBySlug[c.slug] || 0) > 0),
    [categories, noteCountBySlug],
  );

  const visibleNotes = useMemo(() => {
    if (selectedCategory === ALL_FILTER) {
      return notes;
    }
    return notes.filter((note) => note.mainCategory === selectedCategory);
  }, [notes, selectedCategory]);

  return (
    <div className="w-full">
      {/* 헤더 - 제목과 버튼 */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            📚 개발노트 관리
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            개발노트를 작성하고 공개 여부를 관리합니다
          </p>
        </div>
        <Link href="/admin/write">
          <GradientButton size="lg" gradient="from-blue-600 to-purple-600">
            ✍️ 새 노트 작성
          </GradientButton>
        </Link>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 rounded-xl p-6 shadow-lg border border-gray-100 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">전체 노트</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{notes.length}</p>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-6 shadow-lg border border-green-100 dark:border-green-800">
          <p className="text-sm text-green-600 dark:text-green-400 mb-2">공개</p>
          <p className="text-3xl font-bold text-green-600 dark:text-green-400">
            {notes.filter((n) => n.isPublished).length}
          </p>
        </div>
        <div className="bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 rounded-xl p-6 shadow-lg border border-orange-100 dark:border-orange-800">
          <p className="text-sm text-orange-600 dark:text-orange-400 mb-2">비공개</p>
          <p className="text-3xl font-bold text-orange-600 dark:text-orange-400">
            {notes.filter((n) => !n.isPublished).length}
          </p>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-6 shadow-lg border border-blue-100 dark:border-blue-800">
          <p className="text-sm text-blue-600 dark:text-blue-400 mb-2">최근 7일</p>
          <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
            {notes.filter((n) => {
              const weekAgo = new Date();
              weekAgo.setDate(weekAgo.getDate() - 7);
              return new Date(n.createdAt) > weekAgo;
            }).length}
          </p>
        </div>
      </div>

      {/* 공개/비공개 설명 */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
          💡 <strong>노트 공개/비공개란?</strong>
        </p>
        <p className="text-sm text-blue-700 dark:text-blue-300">
          • <strong>비공개</strong>: 사용자에게 노트가 표시되지 않음 (작성 중이거나 검토가 필요한 상태)
        </p>
        <p className="text-sm text-blue-700 dark:text-blue-300">
          • <strong>공개</strong>: 사용자가 노트 목록과 상세 페이지에서 내용을 볼 수 있음
        </p>
      </div>

      {/* 카테고리 필터 탭 */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          onClick={() => setSelectedCategory(ALL_FILTER)}
          className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
            selectedCategory === ALL_FILTER
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
          }`}
        >
          전체 ({notes.length})
        </button>
        {categoryTabs.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => setSelectedCategory(category.slug)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
              selectedCategory === category.slug
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
            }`}
          >
            {category.icon || "📝"} {category.name} ({noteCountBySlug[category.slug] || 0})
          </button>
        ))}
      </div>

      {/* 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <Table
          aria-label="개발노트 관리 테이블"
          classNames={{
            wrapper: "shadow-none",
          }}
        >
          <TableHeader>
            <TableColumn>제목</TableColumn>
            <TableColumn>카테고리</TableColumn>
            <TableColumn>레벨</TableColumn>
            <TableColumn>공개</TableColumn>
            <TableColumn>작성일</TableColumn>
            <TableColumn>액션</TableColumn>
          </TableHeader>
          <TableBody
            emptyContent={
              selectedCategory === ALL_FILTER
                ? "노트가 없습니다."
                : "이 카테고리에는 노트가 없습니다."
            }
          >
            {visibleNotes.map((note) => (
              <TableRow key={note.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold text-base">{note.title}</span>
                    <code className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded w-fit">
                      {note.id.substring(0, 8)}
                    </code>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm">
                    {getCategoryInfo(note.mainCategory, note.subCategory)}
                  </span>
                </TableCell>
                <TableCell>
                  <Chip 
                    size="sm" 
                    color={getLevelColor(note.level)}
                    variant="flat"
                  >
                    {getLevelEmoji(note.level)} {getLevelText(note.level)}
                  </Chip>
                </TableCell>
                <TableCell>
                  <Switch
                    size="sm"
                    isSelected={note.isPublished}
                    onValueChange={() => handleTogglePublish(note.noteId)}
                    isDisabled={loadingIds.has(note.noteId)}
                    color={note.isPublished ? "success" : "default"}
                  >
                    {note.isPublished ? "공개" : "비공개"}
                  </Switch>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {new Date(note.createdAt).toLocaleDateString('ko-KR', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit'
                    })}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Tooltip content="수정">
                      <Link href={`/admin/write/${note.noteId}`}>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="flat"
                          color="primary"
                        >
                          <Pencil size={16} />
                        </Button>
                      </Link>
                    </Tooltip>
                    <Tooltip content="삭제">
                      <Button
                        isIconOnly
                        size="sm"
                        variant="flat"
                        color="danger"
                        onPress={() => {
                          if (confirm('정말 삭제하시겠습니까?')) {
                            // 삭제 로직 추가 필요
                            toast.info('삭제 기능은 아직 구현되지 않았습니다.');
                          }
                        }}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}