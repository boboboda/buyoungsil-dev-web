// components/developmentNote/userNote/noteItemView.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/solid";
import { Button, useDisclosure } from "@heroui/react";
import { useRouter } from "next/navigation";
import { Note } from "@/store/editorSotre";
import { useNoteStore } from "@/components/providers/editor-provider";
import { useCachedSession } from "@/app/hooks/user/useCachedSession";
import {
  canAccessContent,
  getAccessMessage,
} from "@/lib/utils/access-control";
import SimpleModal from "@/components/modal/simpleModal";
import ReadLexicalEditor from "./ReadLexicalEditor";

interface GroupedNotes {
  [key: string]: Note[];
}

type UserRole = "guest" | "user" | "supporter" | "admin";

// 레벨 설정
const LEVEL_CONFIG = {
  BEGINNER: {
    icon: "🟢",
    label: "초급",
    bgColor: "bg-green-50 dark:bg-green-900/20",
    borderColor: "border-green-200 dark:border-green-800",
    textColor: "text-green-800 dark:text-green-300",
  },
  INTERMEDIATE: {
    icon: "🟡",
    label: "중급",
    bgColor: "bg-yellow-50 dark:bg-yellow-900/20",
    borderColor: "border-yellow-200 dark:border-yellow-800",
    textColor: "text-yellow-800 dark:text-yellow-300",
  },
  ADVANCED: {
    icon: "🔴",
    label: "고급",
    bgColor: "bg-red-50 dark:bg-red-900/20",
    borderColor: "border-red-200 dark:border-red-800",
    textColor: "text-red-800 dark:text-red-300",
  },
};

const LEVEL_ORDER: ("BEGINNER" | "INTERMEDIATE" | "ADVANCED")[] = [
  "BEGINNER",
  "INTERMEDIATE",
  "ADVANCED",
];

const ContentLevelIcon = ({
  level,
}: {
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
}) => {
  return <span className="mr-1">{LEVEL_CONFIG[level].icon}</span>;
};

export default function NoteItemView({
  fetchNotes,
  initialNote,
}: {
  fetchNotes: Note[];
  initialNote: Note | null;
}) {
  const router = useRouter();
  const { session, isAuthenticated } = useCachedSession();
  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  const [note, setNote] = useState<Note | null>(initialNote);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // 🔥 기본값 false로 변경
  const [accessDeniedInfo, setAccessDeniedInfo] = useState<{
    contentLevel: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
    userRole: UserRole;
    title: string;
    content: string;
    confirmText: string;
    confirmAction: () => void;
    showCancel: boolean;
    confirmColor: "primary" | "danger" | "success" | "warning";
  } | null>(null);

  // 사용자 역할 결정
  const userRole: UserRole = useMemo(() => {
    if (!isAuthenticated || !session?.user) {
      return "guest";
    }

    switch (session.user.role) {
      case "admin":
        return "admin";
      case "supporter":
        return "supporter";
      case "user":
        return "user";
      default:
        return "guest";
    }
  }, [isAuthenticated, session?.user]);

  // 레벨 기반 그룹핑
  const groupedNotesByLevel = useMemo(() => {
    if (!fetchNotes || fetchNotes.length === 0) {
      return {};
    }

    return fetchNotes.reduce(
      (acc, note) => {
        const level = note.level || "BEGINNER";
        const subCategoryName = note.subCategory?.name || "Uncategorized";

        if (!acc[level]) {
          acc[level] = {};
        }
        if (!acc[level][subCategoryName]) {
          acc[level][subCategoryName] = [];
        }
        acc[level][subCategoryName].push(note);

        return acc;
      },
      {} as Record<string, GroupedNotes>,
    );
  }, [fetchNotes]);

  const { setContent } = useNoteStore((state) => state);

  useEffect(() => {
    if (note) {
      setContent({
        noteId: note.noteId,
        title: note.title,
        content: note.content,
      });
    }
  }, [note, setContent]);

  // 모달 설정 생성
  const createModalConfig = (
    contentLevel: "BEGINNER" | "INTERMEDIATE" | "ADVANCED",
    userRole: UserRole,
  ) => {
    switch (contentLevel) {
      case "INTERMEDIATE":
        if (userRole === "guest") {
          return {
            title: "🔒 중급 콘텐츠",
            content:
              "중급 콘텐츠는 회원가입이 필요합니다.\n\n무료로 가입하시면 중급 콘텐츠까지 모두 이용하실 수 있습니다.",
            confirmText: "로그인 / 회원가입",
            confirmAction: () => {
              onOpenChange();
              router.push("/signin");
            },
            showCancel: true,
            confirmColor: "primary" as const,
          };
        } else {
          return {
            title: "🔒 중급 콘텐츠",
            content:
              "이미 회원이시군요!\n\n하지만 이 콘텐츠에 접근할 수 없습니다. 권한을 확인해주세요.",
            confirmText: "확인",
            confirmAction: () => onOpenChange(),
            showCancel: false,
            confirmColor: "primary" as const,
          };
        }

      case "ADVANCED":
        return {
          title: "💎 고급 콘텐츠",
          content:
            "고급 콘텐츠는 후원자 전용입니다.\n\n후원해주시면 모든 프리미엄 콘텐츠를 이용하실 수 있습니다.",
          confirmText: "후원하기",
          confirmAction: () => {
            onOpenChange();
            router.push("/support");
          },
          showCancel: true,
          confirmColor: "warning" as const,
        };

      default:
        return {
          title: "🚫 접근 제한",
          content: "이 콘텐츠에 접근할 권한이 없습니다.",
          confirmText: "확인",
          confirmAction: () => onOpenChange(),
          showCancel: false,
          confirmColor: "primary" as const,
        };
    }
  };

  // 노트 클릭 핸들러
  const handleNoteClick = (selectedNote: Note) => {
    const hasAccess = canAccessContent(
      userRole,
      selectedNote.level || "BEGINNER",
    );

    if (hasAccess) {
      setNote(selectedNote);
      setIsSidebarOpen(false); // 🔥 노트 선택 시 사이드바 자동 닫기
    } else {
      const modalConfig = createModalConfig(
        selectedNote.level || "BEGINNER",
        userRole,
      );
      setAccessDeniedInfo({
        contentLevel: selectedNote.level || "BEGINNER",
        userRole,
        ...modalConfig,
      });
      onOpen();
    }
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 relative overflow-hidden">
      
      {/* 🔥 Overlay Background */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* 🔥 사이드바 - Fixed Position with Overlay */}
      <aside
        className={`fixed left-0 top-0 h-full w-80 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* 사이드바 헤더 */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
              {note?.mainCategory || "카테고리"}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              목차
            </p>
          </div>
          
          {/* 닫기 버튼 */}
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ChevronLeftIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
        </div>

        {/* 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto p-6">
          {LEVEL_ORDER.map((level) => {
            const levelData = groupedNotesByLevel[level];

            if (!levelData) return null;

            return (
              <div key={level} className="mb-8">
                {/* 레벨 헤더 */}
                <div
                  className={`flex items-center mb-4 p-3 rounded-lg ${LEVEL_CONFIG[level].bgColor} ${LEVEL_CONFIG[level].borderColor} border-2`}
                >
                  <ContentLevelIcon level={level} />
                  <h4
                    className={`font-bold text-base ${LEVEL_CONFIG[level].textColor}`}
                  >
                    {LEVEL_CONFIG[level].label}
                  </h4>
                </div>

                {/* 서브카테고리별 노트 */}
                {Object.entries(levelData).map(
                  ([subCategoryName, notes]) => (
                    <div
                      key={`${level}-${subCategoryName}`}
                      className="mb-6 ml-2"
                    >
                      <h5 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">
                        {subCategoryName}
                      </h5>
                      <ul className="space-y-2">
                        {notes.map((noteItem, index) => {
                          const hasAccess = canAccessContent(
                            userRole,
                            noteItem.level || "BEGINNER",
                          );
                          const isCurrentNote =
                            note?.noteId === noteItem.noteId;

                          return (
                            <li
                              key={noteItem.noteId || index}
                              className={`
                                cursor-pointer px-3 py-2 rounded-md transition-all duration-200
                                ${
                                  isCurrentNote
                                    ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-semibold"
                                    : hasAccess
                                    ? "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                    : "text-gray-400 dark:text-gray-600 opacity-60"
                                }
                              `}
                              title={
                                !hasAccess
                                  ? getAccessMessage(
                                      userRole,
                                      noteItem.level || "BEGINNER",
                                    )
                                  : ""
                              }
                              onClick={() => handleNoteClick(noteItem)}
                            >
                              <div className="flex items-center justify-between">
                                <span
                                  className={`text-sm ${
                                    !hasAccess ? "line-through" : ""
                                  }`}
                                >
                                  {noteItem.title}
                                </span>
                                {!hasAccess && (
                                  <span className="text-xs">🔒</span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ),
                )}
              </div>
            );
          })}

          {/* 사용자 권한 정보 */}
          <div className="mt-8 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
            <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">
              현재 권한
            </div>
            <div className="flex items-center gap-2 mb-2">
              <div
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  userRole === "admin"
                    ? "bg-purple-200 text-purple-900 dark:bg-purple-800 dark:text-purple-200"
                    : userRole === "supporter"
                    ? "bg-yellow-200 text-yellow-900 dark:bg-yellow-800 dark:text-yellow-200"
                    : userRole === "user"
                    ? "bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-200"
                    : "bg-gray-200 text-gray-900 dark:bg-gray-600 dark:text-gray-200"
                }`}
              >
                {userRole === "admin"
                  ? "👑 관리자"
                  : userRole === "supporter"
                  ? "💎 후원자"
                  : userRole === "user"
                  ? "👤 회원"
                  : "👥 게스트"}
              </div>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">
              {userRole === "admin"
                ? "모든 콘텐츠 접근 가능"
                : userRole === "supporter"
                ? "🟢🟡🔴 모든 레벨 접근"
                : userRole === "user"
                ? "🟢🟡 초급, 중급 접근"
                : "🟢 초급만 접근 가능"}
            </div>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <Button
            className="w-full"
            color="default"
            variant="flat"
            onClick={() => router.back()}
          >
            ← 뒤로가기
          </Button>
        </div>
      </aside>

      {/* 🔥 메인 컨텐츠 영역 - Full Width */}
      <main className="flex-1 flex flex-col overflow-hidden w-full">
        {/* 토글 버튼 */}
        <div className="sticky top-0 z-30 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <button
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            onClick={toggleSidebar}
          >
            <ChevronRightIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              목차 열기
            </span>
          </button>
        </div>

        {/* 에디터 영역 */}
        <div className="flex-1 overflow-y-auto">
          <ReadLexicalEditor note={note!} />
        </div>
      </main>

      {/* 모달 */}
      {accessDeniedInfo && (
        <SimpleModal
          confirmColor={accessDeniedInfo.confirmColor}
          confirmText={accessDeniedInfo.confirmText}
          content={accessDeniedInfo.content}
          isOpen={isOpen}
          showCancel={accessDeniedInfo.showCancel}
          title={accessDeniedInfo.title}
          onCancel={() => onOpenChange()}
          onConfirm={accessDeniedInfo.confirmAction}
          onOpenChange={onOpenChange}
        />
      )}
    </div>
  );
}