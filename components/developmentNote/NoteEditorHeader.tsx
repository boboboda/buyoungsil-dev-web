// components/developmentNote/NoteEditorHeader.tsx
"use client";

import { useState, useEffect } from "react";
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
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

import { useNoteStore } from "@/components/providers/editor-provider";
import { noteCategories, NoteCategory, NoteEditorType } from "@/types/index";
import { Note, SubCategory } from "@/store/editorSotre";

// 등급 타입 및 옵션 정의
export type NoteLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED";

const levelOptions = [
  { value: "BEGINNER" as NoteLevel, label: "🟢 초급" },
  { value: "INTERMEDIATE" as NoteLevel, label: "🟡 중급" },
  { value: "ADVANCED" as NoteLevel, label: "🔴 고급" },
];

interface NoteEditorHeaderProps {
  notes: Note[];
  note?: Note;
  editType: NoteEditorType;
}

export default function NoteEditorHeader({
  notes,
  note,
  editType,
}: NoteEditorHeaderProps) {
  const [editor] = useLexicalComposerContext();
  const router = useRouter();

  const {
    setContent,
    mainCategory,
    subCategories,
    subCategory,
    setSubCategories,
    saveToServer,
    updateToServer,
    title,
    level,
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
  const [newCategoryName, setNewCategoryName] = useState("");

  // 🔥 메인 카테고리 선택 핸들러
  const handleSelectionChange = (keys: SharedSelection) => {
    setViewMainCategory(keys as Set<NoteCategory>);

    const selectedArray = Array.from(keys);
    const selectedCategory = selectedArray[0] as NoteCategory;

    if (selectedCategory) {
      setContent({ mainCategory: selectedCategory });
    }
  };

  // 🔥 등급 선택 핸들러
  const handleLevelChange = (keys: SharedSelection) => {
    console.log("🔥 레벨 변경 감지:", keys);

    if (keys === "all") return;

    const selectedLevel = Array.from(keys)[0] as NoteLevel;

    console.log("🔥 선택된 레벨:", selectedLevel);

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

  // 🔥 서브 카테고리 선택 핸들러
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

  // 🔥 서브 카테고리 추가
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

  // 🔥 초기화 (editType에 따라)
  useEffect(() => {
    switch (editType) {
      case "add":
        // 서버에서 가져온 서브카테고리 설정
        const serverSubCategories = notes
          .map((note) => note.subCategory)
          .filter(
            (subCat): subCat is SubCategory =>
              subCat !== null && subCat !== undefined,
          );

        if (serverSubCategories.length !== 0) {
          // 중복 제거
          const uniqueSubCats = Array.from(
            new Map(serverSubCategories.map(cat => [cat.id, cat])).values()
          );
          setSubCategories(uniqueSubCats);
        }

        if (mainCategory) {
          setViewMainCategory(new Set([mainCategory]));
        }

        console.log("🔥 ADD 모드: 기본 레벨 설정");
        setViewLevel(new Set(["BEGINNER"]));
        setContent({ level: "BEGINNER" });
        break;

      case "edit":
        const editSubCat: SubCategory = note?.subCategory ?? { id: 0, name: "" };
        const editMainCat: NoteCategory = note?.mainCategory ?? "basics";
        const editLevel: NoteLevel = note?.level || "BEGINNER";

        console.log("🔥 EDIT 모드: 기존 레벨 로드:", editLevel);

        setSubCategories([editSubCat]);
        setContent({ mainCategory: editMainCat });
        setContent({ subCategory: editSubCat });
        setContent({ noteId: note?.noteId });
        setContent({ level: editLevel });

        setViewSubCategory(editSubCat);
        setViewMainCategory(new Set([editMainCat]));
        setViewLevel(new Set([editLevel]));
        break;

      case "read":
        const readSubCat: SubCategory = note?.subCategory ?? { id: 0, name: "" };
        const readMainCat: NoteCategory = note?.mainCategory ?? "basics";
        const readLevel: NoteLevel = note?.level || "BEGINNER";

        console.log("🔥 READ 모드: 레벨 로드:", readLevel);

        setSubCategories([readSubCat]);
        setContent({ mainCategory: readMainCat });
        setContent({ subCategory: readSubCat });
        setContent({ noteId: note?.noteId });
        setContent({ level: readLevel });

        setViewSubCategory(readSubCat);
        setViewMainCategory(new Set([readMainCat]));
        setViewLevel(new Set([readLevel]));
        break;

      default:
        console.log("Unknown edit type");
        break;
    }
  }, [editType, note, notes, mainCategory, setContent, setSubCategories]);

  // 🔥 서브카테고리 동기화
  useEffect(() => {
    if (subCategory && subCategories.length !== 0) {
      console.log("sub", subCategories);
      setViewSubCategory(subCategory);
    }
  }, [subCategories, subCategory]);

  // 🔥 디버깅용 level 상태 감시
  useEffect(() => {
    console.log("🔥 현재 스토어 level 상태:", level);
  }, [level]);

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
      console.log("🔥 저장 직전 스토어 상태 확인:");
      console.log("- level:", level);
      console.log("- title:", title);
      console.log("- mainCategory:", mainCategory);
      console.log("- subCategory:", subCategory);

      // Lexical 에디터 상태 가져오기
      const editorState = editor.getEditorState();
      const json = editorState.toJSON();
      
      // content도 함께 저장
      setContent({ content: json });

      const result = await saveToServer();

      console.log("saveServer", result);

      if (result) {
        notifySuccessEvent("서버에 저장되었습니다.");
        router.push("/admin/notes");
        router.refresh();
      }
    } catch (error) {
      console.log(error);
      toast.error("저장 중 오류가 발생했습니다.");
    }
  };

  // 🔥 수정 핸들러
  const handleUpdateToServer = async () => {
    try {
      console.log("🔥 수정 직전 스토어 상태 확인:");
      console.log("- level:", level);
      console.log("- title:", title);
      console.log("- mainCategory:", mainCategory);
      console.log("- subCategory:", subCategory);

      // Lexical 에디터 상태 가져오기
      const editorState = editor.getEditorState();
      const json = editorState.toJSON();
      
      // content도 함께 저장
      setContent({ content: json });

      const result = await updateToServer();

      console.log("updateServer", result);

      if (result) {
        notifySuccessEvent("문서가 수정되었습니다.");
        router.push("/admin/notes");
        router.refresh();
      }
    } catch (error) {
      console.log(error);
      toast.error("수정 중 오류가 발생했습니다.");
    }
  };

  return (
    <div className="flex flex-col items-center w-full py-2 pl-6 pr-3 gap-3 border-b border-neutral-200 dark:border-neutral-700">
      <div className="flex flex-row w-full gap-4">
        {/* 메인 카테고리 */}
        <div className="flex flex-1 max-w-[200px]">
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

        {/* 서브 카테고리 */}
        <div className="flex flex-1 max-w-[200px]">
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

        {/* 난이도 선택 */}
        <div className="flex flex-1 max-w-[200px]">
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

        {/* 서브 카테고리 추가 */}
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

        {/* 우측: 모드 표시 + 저장 버튼 */}
        <div className="flex flex-1 justify-end items-center gap-3">
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
      </div>

      {/* 제목 입력 */}
      <div className="w-full">
        <div className="flex flex-1 gap-4">
          <Input
            className="no-underline"
            label="제목"
            type="text"
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
}