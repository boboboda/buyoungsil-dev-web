"use client";

import { Editor, removeDuplicates } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Button,
  Chip,
  Input,
  Select,
  SelectItem,
  SharedSelection,
} from "@heroui/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";

import { useNoteStore } from "../providers/editor-provider";

import { EditorInfo } from "./EditorInfo";

import { noteCategories, NoteCategory, NoteEditorType } from "@/types/index";
import { Note, SubCategory } from "@/store/editorSotre";
import { Toolbar } from "@/components/titap/Toolbar";
import { Icon } from "@/components/titap/Icon";

// 등급 타입 및 옵션 정의
export type NoteLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

const levelOptions = [
  { value: "BEGINNER" as NoteLevel, label: "🟢 초급" },
  { value: "INTERMEDIATE" as NoteLevel, label: "🟡 중급" },
  { value: "ADVANCED" as NoteLevel, label: "🔴 고급" },
];

export type EditorHeaderProps = {
  isSidebarOpen?: boolean;
  toggleSidebar?: () => void;
  editor: Editor;
};

export const EditorHeader = ({
  editor,
  isSidebarOpen,
  toggleSidebar,
  notes,
  note,
  editType,
}: {
  editor: Editor;
  isSidebarOpen?: boolean;
  toggleSidebar: () => void;
  notes: Note[];
  note: Note;
  editType: NoteEditorType;
}) => {
  const { characters, words } = useEditorState({
    editor,
    selector: (ctx): { characters: number; words: number } => {
      const { characters, words } = ctx.editor?.storage.characterCount || {
        characters: () => 0,
        words: () => 0,
      };

      return { characters: characters(), words: words() };
    },
  });

  const {
    setContent,
    mainCategory,
    subCategories,
    subCategory,
    setSubCategories,
    saveToServer,
    updateToServer,
    title,
    level, // 새로 추가된 level 상태
  } = useNoteStore((state) => state);

  const [viewMainCategory, setViewMainCategory] = useState<Set<NoteCategory>>(
    new Set(),
  );
  const [viewSubCategory, setViewSubCategory] = useState<SubCategory>({
    id: 0,
    name: "",
  });
  const [viewLevel, setViewLevel] = useState<Set<string>>(
    new Set(["BEGINNER"]),
  );

  const handleSelectionChange = (keys: SharedSelection) => {
    setViewMainCategory(keys as Set<NoteCategory>);

    // SharedSelection을 배열로 변환
    const selectedArray = Array.from(keys);
    const selectedCategory = selectedArray[0] as NoteCategory;

    if (selectedCategory) {
      setContent({ mainCategory: selectedCategory });
    }
  };

  // 🔥 등급 선택 핸들러 수정
  const handleLevelChange = (keys: SharedSelection) => {
    console.log("🔥 레벨 변경 감지:", keys);

    // "all" 선택은 무시
    if (keys === "all") return;

    // SharedSelection을 배열로 변환하여 첫 번째 값 가져오기
    const selectedLevel = Array.from(keys)[0] as NoteLevel;

    console.log("🔥 선택된 레벨:", selectedLevel);

    // NoteLevel 유효성 검증
    if (
      selectedLevel &&
      (selectedLevel === "BEGINNER" ||
        selectedLevel === "INTERMEDIATE" ||
        selectedLevel === "ADVANCED")
    ) {
      const levelSet = new Set([selectedLevel]);

      setViewLevel(levelSet);
      setContent({ level: selectedLevel });
      console.log("🔥 스토어에 레벨 저장됨:", selectedLevel);
    }
  };

  const router = useRouter();

  // 🔥 디버깅용 level 상태 감시
  useEffect(() => {
    console.log("🔥 현재 스토어 level 상태:", level);
  }, [level]);

  useEffect(() => {
    switch (editType) {
      case "add":
        const serverSubCategories = notes
          .map((note) => note.subCategory)
          .filter(
            (subCat): subCat is SubCategory =>
              subCat !== null && subCat !== undefined,
          );

        if (
          serverSubCategories.length !== 0 &&
          serverSubCategories[0] !== null
        ) {
          setSubCategories(removeDuplicates(serverSubCategories));
        }
        if (mainCategory) {
          setViewMainCategory(new Set([mainCategory]));
        }
        // 🔥 기본 등급 설정 수정
        console.log("🔥 ADD 모드: 기본 레벨 설정");
        setViewLevel(new Set(["BEGINNER"]));
        setContent({ level: "BEGINNER" });
        break;

      case "edit":
        const editSubCat: SubCategory = note.subCategory ?? { id: 0, name: "" };
        const editMainCat: NoteCategory = note.mainCategory ?? "basics";
        const editLevel: NoteLevel = note.level || "BEGINNER";

        console.log("🔥 EDIT 모드: 기존 레벨 로드:", editLevel);

        setSubCategories([editSubCat]);
        setContent({ mainCategory: editMainCat });
        setContent({ subCategory: editSubCat });
        setContent({ noteId: note.noteId });
        setContent({ level: editLevel });

        setViewSubCategory(editSubCat);
        setViewMainCategory(new Set([editMainCat]));
        setViewLevel(new Set([editLevel]));
        break;

      case "read":
        const readSubCat: SubCategory = note.subCategory ?? { id: 0, name: "" };
        const readMainCat: NoteCategory = note.mainCategory ?? "basics";
        const readLevel: NoteLevel = note.level || "BEGINNER";

        console.log("🔥 READ 모드: 레벨 로드:", readLevel);

        setSubCategories([readSubCat]);
        setContent({ mainCategory: readMainCat });
        setContent({ subCategory: readSubCat });
        setContent({ noteId: note.noteId });
        setContent({ level: readLevel });

        setViewSubCategory(readSubCat);
        setViewMainCategory(new Set([readMainCat]));
        setViewLevel(new Set([readLevel]));
        break;

      default:
        console.log("Unknown edit type");
        break;
    }
  }, [editType, note, notes, mainCategory, setContent, setSubCategories]); // 🔥 의존성 배열 추가

  useEffect(() => {
    if (subCategory && subCategories.length !== 0) {
      console.log("sub", subCategories);
      setViewSubCategory(subCategory);
    }
  }, [subCategories, subCategory]);

  const handleSubCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedValue = e.target.value;

    console.log("카테고리", selectedValue);

    const existingCategory = subCategories.find(
      (cat) => cat.name === selectedValue,
    );

    if (existingCategory) {
      setViewSubCategory(existingCategory);
      setContent({ subCategory: existingCategory });
      console.log("실행됨");
    }
  };

  const [newCategoryName, setNewCategoryName] = useState("");

  const addSubCategory = () => {
    const selectedValue = newCategoryName;
    const existingCategory = subCategories.find(
      (cat) => cat.name === selectedValue,
    );

    let newCategory: SubCategory;

    if (existingCategory) {
      newCategory = existingCategory;
    } else {
      const lastId =
        subCategories.length > 0
          ? Math.max(...subCategories.map((cat) => cat.id))
          : 0;
      const newId = lastId + 1;

      newCategory = {
        id: newId,
        name: selectedValue,
      };

      setSubCategories([...subCategories, newCategory]);
    }

    setContent({ subCategory: newCategory });
    setNewCategoryName("");
  };

  const notifySuccessEvent = (msg: string) => toast.success(msg);

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

  // 🔥 저장 전 디버깅 추가
  const handleSaveToServer = async () => {
    try {
      console.log("🔥 저장 직전 스토어 상태 확인:");
      console.log("- level:", level);
      console.log("- title:", title);
      console.log("- mainCategory:", mainCategory);
      console.log("- subCategory:", subCategory);

      const result = await saveToServer();

      console.log("saveServer", result);

      if (result) {
        notifySuccessEvent("서버에 저장되었습니다.");
        router.push("/");
        router.refresh();
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleUpdateToServer = async () => {
    try {
      console.log("🔥 수정 직전 스토어 상태 확인:");
      console.log("- level:", level);
      console.log("- title:", title);
      console.log("- mainCategory:", mainCategory);
      console.log("- subCategory:", subCategory);

      const result = await updateToServer();

      console.log("updateServer", result);

      if (result) {
        notifySuccessEvent("문서가 수정되었습니다.");
        router.push("/");
        router.refresh();
      }
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <div className="flex flex-col items-center w-full py-2 pl-6 pr-3 gap-3 border-b border-neutral-200">
      <div className="flex flex-row w-full gap-4">
        <div className="flex flex-row items-center">
          <div className="flex items-center gap-x-1.5">
            <Toolbar.Button
              active={isSidebarOpen}
              className={isSidebarOpen ? "bg-transparent" : ""}
              tooltip={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
              onClick={toggleSidebar}
            >
              <Icon name={isSidebarOpen ? "PanelLeftClose" : "PanelLeft"} />
            </Toolbar.Button>
          </div>
        </div>

        <div className="flex flex-1 max-w-[200px] ">
          <Select
            className="max-w-xs"
            label="메인 카테고리"
            selectedKeys={viewMainCategory}
            onSelectionChange={handleSelectionChange}
          >
            {noteCategories.map((category) => (
              <SelectItem key={category}>{category}</SelectItem>
            ))}
          </Select>
        </div>

        <div className="flex flex-1 max-w-[200px] ">
          <Select
            className="max-w-xs"
            label="서브 카테고리"
            selectedKeys={viewSubCategory ? [viewSubCategory.name] : []}
            onChange={handleSubCategoryChange}
          >
            {subCategories.map((category) => (
              <SelectItem key={category.name}>{category.name}</SelectItem>
            ))}
          </Select>
        </div>

        {/* 🔥 등급 선택 UI 개선 */}
        <div className="flex flex-1 max-w-[200px] ">
          <Select
            className="max-w-xs"
            label="난이도"
            selectedKeys={viewLevel}
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

        <div className="flex space-x-2 items-center">
          <Input
            placeholder="새 카테고리 이름"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
          />
          <Button
            className={`
    ${
      newCategoryName === ""
        ? "opacity-50 cursor-not-allowed"
        : "hover:bg-blue-500"
    }
  `}
            disabled={newCategoryName === ""}
            onClick={addSubCategory}
          >
            추가
          </Button>
        </div>

        <div className="flex flex-1 justify-end items-center">
          <div className="flex justify-end items-center mr-3">
            <TextEditMode />
          </div>
          <EditorInfo characters={characters} words={words} />
          <Button
            className="hover:bg-blue-500"
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
      </div>
      <div className="w-full">
        <div key="underlined" className="flex flex-1 gap-4">
          <Input
            className="no-underline"
            label="제목"
            type="제목"
            value={title || ""}
            onChange={(e) => {
              setContent({ title: e.target.value });
              console.log("인풋", e.target.value);
            }}
          />
        </div>
      </div>
    </div>
  );
};
