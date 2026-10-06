// components/developmentNote/NoteEditorHeader.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Button,
  Chip,
  Input,
  Select,
  SelectItem,
  SharedSelection,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import { useNoteStore } from "@/components/providers/editor-provider";
import { NoteCategory, NoteEditorType } from "@/types/index";
import { Note } from "@/store/editorSotre";
import {
  createSubCategory,
  fetchSubCategories,
  SubCategoryOption,
} from "@/serverActions/noteSubCategoryActions";
import {
  fetchNoteLinkOptions,
  NoteLinkOption,
} from "@/serverActions/noteLinkActions";
import {
  CategoryOption,
  fetchCategoryOptions,
} from "@/serverActions/noteCategoryActions";

import NoteLinkButton from "./NoteLinkButton";
import RelatedNotesField from "./RelatedNotesField";

// 등급 타입 및 옵션 정의
export type NoteLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

const levelOptions = [
  { value: "BEGINNER" as NoteLevel, label: "🟢 초급" },
  { value: "INTERMEDIATE" as NoteLevel, label: "🟡 중급" },
  { value: "ADVANCED" as NoteLevel, label: "🔴 고급" },
];

interface NoteEditorHeaderProps {
  /** @deprecated 서브 카테고리는 DB에서 직접 불러오므로 더 이상 사용하지 않음 */
  notes?: Note[];
  note?: Note;
  editType: NoteEditorType;
}

export default function NoteEditorHeader({
  note,
  editType,
}: NoteEditorHeaderProps) {
  const [editor] = useLexicalComposerContext();
  const router = useRouter();

  const {
    setContent,
    mainCategory,
    subCategory,
    saveToServer,
    updateToServer,
    title,
    level,
    relatedNoteIds,
    noteId: currentNoteId,
  } = useNoteStore((state) => state);

  // 메인 카테고리 선택 목록 (DB: /admin/categories 에서 추가/수정한 카테고리)
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);

  useEffect(() => {
    fetchCategoryOptions()
      .then(setCategoryOptions)
      .catch((error) => {
        console.error("카테고리 목록 조회 실패:", error);
        toast.error("메인 카테고리 목록을 불러오지 못했습니다.");
      });
  }, []);

  // 관련 글 / 본문 링크로 고를 수 있는 전체 노트 목록
  const [noteOptions, setNoteOptions] = useState<NoteLinkOption[]>([]);

  useEffect(() => {
    fetchNoteLinkOptions()
      .then(setNoteOptions)
      .catch((error) => console.error("노트 목록 조회 실패:", error));
  }, []);

  // 선택된 메인 카테고리에 속한 서브 카테고리 목록 (DB)
  const [subOptions, setSubOptions] = useState<SubCategoryOption[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  // 🔥 초기화: 글/노트가 바뀔 때 한 번만 실행
  // (예전에는 mainCategory 등이 deps 에 있어 카테고리를 바꿀 때마다 초기화가 다시 돌았음)
  useEffect(() => {
    switch (editType) {
      case "add":
        setContent({ level: "BEGINNER", relatedNoteIds: [] });
        break;

      case "edit":
      case "read": {
        const sub = note?.subCategory?.name ? note.subCategory : null;

        setContent({
          noteId: note?.noteId,
          title: note?.title ?? "",
          mainCategory: note?.mainCategory ?? "basics",
          subCategory: sub,
          level: note?.level || "BEGINNER",
          relatedNoteIds: note?.relatedNoteIds ?? [],
        });
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editType, note?.noteId]);

  // 🔥 메인 카테고리가 바뀌면 그 카테고리의 서브 카테고리 목록을 불러온다
  useEffect(() => {
    if (!mainCategory) {
      setSubOptions([]);

      return;
    }

    let cancelled = false;

    setSubOptions([]);
    fetchSubCategories(mainCategory)
      .then((options) => {
        if (!cancelled) setSubOptions(options);
      })
      .catch((error) => {
        console.error("서브 카테고리 조회 실패:", error);
        if (!cancelled) toast.error("서브 카테고리를 불러오지 못했습니다.");
      });

    return () => {
      cancelled = true;
    };
  }, [mainCategory]);

  // 목록 로딩 중이거나 목록에 없는 기존 글의 서브 카테고리도 선택된 상태로 보이게 한다
  const selectableSubs = useMemo<SubCategoryOption[]>(() => {
    if (
      subCategory?.name &&
      !subOptions.some((option) => option.name === subCategory.name)
    ) {
      return [
        ...subOptions,
        { id: String(subCategory.id), name: subCategory.name },
      ];
    }

    return subOptions;
  }, [subOptions, subCategory]);

  // 🔥 메인 카테고리 선택 핸들러
  const handleSelectionChange = (keys: SharedSelection) => {
    if (keys === "all") return;

    const selected = Array.from(keys)[0] as NoteCategory | undefined;

    // 이미 선택된 항목을 다시 눌러 빈 선택이 되는 경우는 무시
    if (!selected || selected === mainCategory) return;

    // 서브 카테고리는 메인 카테고리에 종속되므로 메인이 바뀌면 선택을 비운다
    setContent({ mainCategory: selected, subCategory: null });
  };

  // 🔥 서브 카테고리 선택 핸들러 (다시 누르면 선택 해제)
  const handleSubCategoryChange = (keys: SharedSelection) => {
    if (keys === "all") return;

    const name = Array.from(keys)[0];

    if (name === undefined) {
      setContent({ subCategory: null });

      return;
    }

    const found = selectableSubs.find((option) => option.name === String(name));

    if (found) {
      setContent({ subCategory: { id: found.id, name: found.name } });
    }
  };

  // 🔥 등급 선택 핸들러
  const handleLevelChange = (keys: SharedSelection) => {
    if (keys === "all") return;

    const selectedLevel = Array.from(keys)[0] as NoteLevel | undefined;

    if (selectedLevel && levelOptions.some((o) => o.value === selectedLevel)) {
      setContent({ level: selectedLevel });
    }
  };

  // 🔥 서브 카테고리 추가: 현재 메인 카테고리 아래에 즉시 DB 저장
  const addSubCategory = async () => {
    const name = newCategoryName.trim();

    if (!name || isAdding) return;

    if (!mainCategory) {
      toast.error("메인 카테고리를 먼저 선택해주세요.");

      return;
    }

    setIsAdding(true);

    try {
      const result = await createSubCategory(mainCategory, name);

      const added = result.subCategory;

      if (!result.success || !added) {
        toast.error(result.error ?? "카테고리 추가에 실패했습니다.");

        return;
      }

      setSubOptions((prev) =>
        prev.some((option) => option.id === added.id) ? prev : [...prev, added],
      );
      setContent({ subCategory: added });
      setNewCategoryName("");
      toast.success(
        result.created
          ? `'${added.name}' 카테고리를 추가했습니다.`
          : `이미 있는 카테고리라 '${added.name}'을(를) 선택했습니다.`,
      );
    } catch (error) {
      console.error("서브 카테고리 추가 실패:", error);
      toast.error("카테고리 추가 중 오류가 발생했습니다.");
    } finally {
      setIsAdding(false);
    }
  };

  const notifySuccessEvent = (msg: string) => toast.success(msg);

  // 🔥 편집 모드 표시
  const TextEditMode = () => (
    <>
      {editType === "add" ? (
        <Chip
          classNames={{
            base: "bg-gradient-to-br from-indigo-500 to-pink-500 border-small border-white/50 shadow-pink-500/30",
            content: "drop-shadow shadow-black text-white",
          }}
          variant="shadow"
        >
          ADD MODE
        </Chip>
      ) : (
        <Chip
          classNames={{
            base: "bg-gradient-to-br from-indigo-500 to-pink-500 border-small border-white/50 shadow-pink-500/30",
            content: "drop-shadow shadow-black text-white",
          }}
          color="warning"
        >
          EDIT MODE
        </Chip>
      )}
    </>
  );

  // 🔥 저장 핸들러
  const handleSaveToServer = async () => {
    try {
      // Lexical 에디터 상태를 스토어에 반영
      setContent({ content: editor.getEditorState().toJSON() });

      const result = await saveToServer();

      if (result) {
        notifySuccessEvent("서버에 저장되었습니다.");
        router.push("/admin/notes");
        router.refresh();
      } else {
        toast.error("저장에 실패했습니다. 서버 로그를 확인해주세요.");
      }
    } catch (error) {
      console.log(error);
      toast.error("저장 중 오류가 발생했습니다.");
    }
  };

  // 🔥 수정 핸들러
  const handleUpdateToServer = async () => {
    try {
      setContent({ content: editor.getEditorState().toJSON() });

      const result = await updateToServer();

      if (result) {
        notifySuccessEvent("문서가 수정되었습니다.");
        router.push("/admin/notes");
        router.refresh();
      } else {
        toast.error("수정에 실패했습니다. 서버 로그를 확인해주세요.");
      }
    } catch (error) {
      console.log(error);
      toast.error("수정 중 오류가 발생했습니다.");
    }
  };

  return (
    <div className="flex flex-col w-full py-2 px-3 sm:pl-6 gap-3 border-b border-neutral-200 dark:border-neutral-700">
      {/*
        모바일: 모드 표시 + 저장 버튼 → 카테고리/난이도 → 새 서브 카테고리 → (아래) 제목
        PC(lg 이상): 한 줄 (카테고리/난이도 → 새 서브 카테고리 → 오른쪽 끝에 모드 표시 + 저장 버튼)
      */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 w-full">
        {/* 모드 표시 + 저장 버튼 (모바일에서는 맨 위, PC에서는 맨 오른쪽) */}
        <div className="order-first lg:order-last lg:ml-auto flex items-center justify-between lg:justify-end gap-3">
          <TextEditMode />
          <Button
            className="hover:bg-blue-500"
            color="primary"
            onClick={async () => {
              switch (editType) {
                case "add":
                  await handleSaveToServer();
                  break;

                case "edit":
                  await handleUpdateToServer();
                  break;
              }
            }}
          >
            {editType === "add" ? "배포" : "수정"}
          </Button>
        </div>

        {/* 카테고리 / 난이도 (모바일 2칸 + 난이도 전체 폭, PC 한 줄) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-row gap-3">
          {/* 메인 카테고리 */}
          <div className="min-w-0 lg:w-[200px]">
            <Select
              className="w-full"
              items={categoryOptions}
              label="메인 카테고리"
              selectedKeys={mainCategory ? [mainCategory] : []}
              onSelectionChange={handleSelectionChange}
            >
              {(category) => (
                <SelectItem
                  key={category.slug}
                  textValue={`${category.icon} ${category.name}`}
                >
                  {category.icon} {category.name}
                </SelectItem>
              )}
            </Select>
          </div>

          {/* 서브 카테고리 (선택한 메인 카테고리에 속한 것만 표시) */}
          <div className="min-w-0 lg:w-[200px]">
            <Select
              className="w-full"
              label="서브 카테고리"
              placeholder={
                selectableSubs.length === 0 ? "없음" : "선택 안 함"
              }
              selectedKeys={subCategory?.name ? [subCategory.name] : []}
              onSelectionChange={handleSubCategoryChange}
            >
              {selectableSubs.map((option) => (
                <SelectItem key={option.name}>{option.name}</SelectItem>
              ))}
            </Select>
          </div>

          {/* 난이도 선택 */}
          <div className="min-w-0 col-span-2 sm:col-span-1 lg:w-[200px]">
            <Select
              className="w-full"
              label="난이도"
              selectedKeys={level ? [level] : []}
              onSelectionChange={handleLevelChange}
            >
              {levelOptions.map((option) => (
                <SelectItem key={option.value} textValue={option.label}>
                  <div className="flex flex-col">
                    <span>{option.label}</span>
                  </div>
                </SelectItem>
              ))}
            </Select>
          </div>
        </div>

        {/* 서브 카테고리 추가 */}
        <div className="flex items-center gap-2 w-full lg:w-auto">
          <Input
            className="flex-1 min-w-0 lg:w-[220px] lg:flex-none"
            placeholder="새 서브 카테고리 이름"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              // 한글 입력 중 Enter(조합 확정)는 무시
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                addSubCategory();
              }
            }}
          />
          <Button
            className="shrink-0 hover:bg-blue-500"
            isDisabled={newCategoryName.trim() === ""}
            isLoading={isAdding}
            onClick={addSubCategory}
          >
            추가
          </Button>
        </div>
      </div>

      {/* 제목 입력 */}
      <div className="w-full">
        <Input
          className="no-underline"
          label="제목"
          type="text"
          value={title || ""}
          onChange={(e) => setContent({ title: e.target.value })}
        />
      </div>

      {/* 관련 글 (글 하단 카드) + 본문 문장 → 글 연결 (본문 링크) */}
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <RelatedNotesField
            currentNoteId={currentNoteId}
            options={noteOptions}
            value={relatedNoteIds ?? []}
            onChange={(ids) => setContent({ relatedNoteIds: ids })}
          />
        </div>
        <NoteLinkButton currentNoteId={currentNoteId} options={noteOptions} />
      </div>
    </div>
  );
}