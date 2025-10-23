// app/note/[slug]/noteItemView.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/solid";

import ReadBlockEditor from "./readBlockEditor";
import { Button, useDisclosure } from "@heroui/react";
import { useRouter } from "next/navigation";
import { Note } from "@/store/editorSotre";
import { useNoteStore } from "@/components/providers/editor-provider";
import { useCachedSession } from "@/app/hooks/user/useCachedSession";
import {
  canAccessContent,
  getAccessMessage,
  getRequiredRole,
} from "@/lib/utils/access-control";
import SimpleModal from "@/components/modal/simpleModal";

interface GroupedNotes {
  [key: string]: Note[];
}

type UserRole = "guest" | "user" | "supporter" | "admin";

// 레벨 설정 및 아이콘 컴포넌트
const LEVEL_CONFIG = {
  BEGINNER: {
    icon: "🟢",
    label: "초급",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
    textColor: "text-green-800",
  },
  INTERMEDIATE: {
    icon: "🟡",
    label: "중급",
    bgColor: "bg-yellow-50",
    borderColor: "border-yellow-200",
    textColor: "text-yellow-800",
  },
  ADVANCED: {
    icon: "🔴",
    label: "고급",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
    textColor: "text-red-800",
  },
};

// 레벨 순서 정의
const LEVEL_ORDER: ("BEGINNER" | "INTERMEDIATE" | "ADVANCED")[] = [
  "BEGINNER",
  "INTERMEDIATE",
  "ADVANCED",
];

// 권한 아이콘 컴포넌트
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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

  // 🔥 사용자 역할 결정 (게스트 기본값)
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

  // 🔥 레벨 기반 그룹핑 (레벨 -> 서브카테고리 -> 노트)
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

  // 🔥 서브카테고리 기반 그룹핑 (사이드바용)
  const groupedNotes = useMemo(() => {
    if (!fetchNotes || fetchNotes.length === 0) {
      return {};
    }

    return fetchNotes.reduce((acc, note) => {
      const subCategoryName = note.subCategory?.name || "Uncategorized";

      if (!acc[subCategoryName]) {
        acc[subCategoryName] = [];
      }
      acc[subCategoryName].push(note);

      return acc;
    }, {} as GroupedNotes);
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

  // 🔥 모달 설정 생성 함수
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

  // 🔥 노트 클릭 핸들러 (권한 체크 포함)
  const handleNoteClick = (selectedNote: Note) => {
    const hasAccess = canAccessContent(
      userRole,
      selectedNote.level || "BEGINNER",
    );

    if (hasAccess) {
      setNote(selectedNote);
    } else {
      // 권한 없을 시 모달 설정 후 표시
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
    <div className="flex relative w-full min-h-screen">
      {/* Sidebar */}
      <div
        className={`fixed left-0 top-0 h-full bg-gray-100 transition-all duration-300 ease-in-out ${isSidebarOpen ? "w-64" : "w-0"} flex flex-col z-10`}
      >
        {isSidebarOpen && (
          <>
            <div className="flex-grow overflow-y-auto">
              <div className="p-4">
                <h2 className="text-black font-bold text-[25px] mb-4">
                  {note?.mainCategory}
                </h2>
                <h3 className="text-black font-bold text-[20px] mb-2">목차</h3>
                {LEVEL_ORDER.map((level) => {
                  const levelData = groupedNotesByLevel[level];

                  if (!levelData) return null;

                  return (
                    <div key={level} className="mb-6">
                      {/* 레벨 헤더 */}
                      <div
                        className={`flex items-center mb-3 p-2 rounded-lg ${LEVEL_CONFIG[level].bgColor} ${LEVEL_CONFIG[level].borderColor} border`}
                      >
                        <ContentLevelIcon level={level} />
                        <h4
                          className={`font-bold text-lg ${LEVEL_CONFIG[level].textColor}`}
                        >
                          {LEVEL_CONFIG[level].label}
                        </h4>
                      </div>

                      {/* 서브카테고리별 노트 */}
                      {Object.entries(levelData).map(
                        ([subCategoryName, notes]) => (
                          <div
                            key={`${level}-${subCategoryName}`}
                            className="mb-4 ml-2"
                          >
                            <h5 className="text-black font-semibold mb-2 text-sm">
                              {subCategoryName}
                            </h5>
                            <ul className="ml-3">
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
                                    className={`mb-2 cursor-pointer flex items-center transition-colors text-sm
    ${isCurrentNote
                                        ? 'text-blue-600 font-semibold'
                                        : hasAccess
                                          ? 'text-black hover:text-gray-600'
                                          : 'text-gray-400 hover:text-gray-500'
                                      }
    ${!hasAccess ? 'opacity-70' : ''}
  `}
                                    title={!hasAccess ? getAccessMessage(userRole, noteItem.level || 'BEGINNER') : ''}
                                    onClick={() => handleNoteClick(noteItem)}
                                  >
                                    <span className={`${!hasAccess ? 'line-through' : ''}`}>
                                      {noteItem.title}
                                    </span>
                                    {!hasAccess && (
                                      <span className="ml-1 text-xs">🔒</span>
                                    )}
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

                {/* 🔥 사용자 권한 정보 표시 */}
                <div className="mt-6 p-3 bg-gray-50 rounded-lg border">
                  <div className="text-xs text-gray-600 mb-2">현재 권한</div>
                  <div className="flex items-center gap-2">
                    <div
                      className={`px-2 py-1 rounded text-xs font-medium ${userRole === "admin"
                          ? "bg-purple-100 text-purple-800"
                          : userRole === "supporter"
                            ? "bg-yellow-100 text-yellow-800"
                            : userRole === "user"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-gray-100 text-gray-800"
                        }`}
                    >
                      {userRole === "admin"
                        ? "관리자"
                        : userRole === "supporter"
                          ? "후원자"
                          : userRole === "user"
                            ? "회원"
                            : "게스트"}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {userRole === "admin"
                      ? "모든 콘텐츠 접근 가능"
                      : userRole === "supporter"
                        ? "🟢🟡🔴 모든 레벨 접근 가능"
                        : userRole === "user"
                          ? "🟢🟡 초급, 중급 접근 가능"
                          : "🟢 초급만 접근 가능"}
                  </div>
                </div>
              </div>
            </div>
            <div className="p-3 mb-[100px]">
              <Button
                className="w-full bg-slate-500"
                onClick={() => router.back()}
              >
                뒤로가기
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Main Content */}
      <div
        className={`w-full min-h-screen transition-all duration-300 ease-in-out ${isSidebarOpen ? "ml-64" : "ml-0"}`}
      >
        <button
          className="m-2 bg-slate-700 hover:bg-slate-500 text-white p-2 rounded-[5px]"
          onClick={toggleSidebar}
        >
          {isSidebarOpen ? (
            <ChevronLeftIcon className="w-6 h-6" />
          ) : (
            <ChevronRightIcon className="w-6 h-6" />
          )}
        </button>
        <ReadBlockEditor note={note!} />
      </div>

      {/* 🔥 재사용 가능한 SimpleModal 사용 */}
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
