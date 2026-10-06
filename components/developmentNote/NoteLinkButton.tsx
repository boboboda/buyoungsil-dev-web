// components/developmentNote/NoteLinkButton.tsx
// 글쓰기 화면: 본문에서 드래그로 선택한 문장을 다른 개발노트로 가는 링크로 바꾼다.
"use client";

import { useRef, useState } from "react";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  useDisclosure,
} from "@heroui/react";
import { $toggleLink } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  BaseSelection,
} from "lexical";
import { toast } from "react-toastify";

import type { NoteLinkOption } from "@/serverActions/noteLinkActions";
import { noteHref } from "@/lib/note/noteUtils";

export default function NoteLinkButton({
  options,
  currentNoteId,
}: {
  options: NoteLinkOption[];
  currentNoteId?: number | null;
}) {
  const [editor] = useLexicalComposerContext();
  const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
  const [keyword, setKeyword] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const savedSelection = useRef<BaseSelection | null>(null);

  // 모달이 열리면 에디터가 포커스를 잃으므로, 열기 전에 선택 영역을 저장해 둔다.
  const handleOpen = () => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();

      if ($isRangeSelection(selection) && !selection.isCollapsed()) {
        savedSelection.current = selection.clone();
        setSelectedText(selection.getTextContent());
        setKeyword("");
        onOpen();
      } else {
        toast.info("연결할 문장을 본문에서 먼저 드래그해 선택해 주세요.");
      }
    });
  };

  const handlePick = (option: NoteLinkOption) => {
    const saved = savedSelection.current;

    if (!saved) {
      onClose();

      return;
    }

    editor.update(() => {
      $setSelection(saved.clone());
      $toggleLink(noteHref(option.mainCategory, option.noteId));
    });

    toast.success(`'${option.title}' 글로 연결했습니다.`);
    savedSelection.current = null;
    onClose();
  };

  const trimmed = keyword.trim().toLowerCase();
  const filtered = options
    .filter((option) => option.noteId !== currentNoteId)
    .filter(
      (option) =>
        trimmed === "" ||
        option.title.toLowerCase().includes(trimmed) ||
        option.mainCategory.toLowerCase().includes(trimmed),
    )
    .slice(0, 50);

  return (
    <>
      {/* mouseDown 에서 기본 동작을 막아야 버튼을 눌러도 에디터 선택이 풀리지 않는다 */}
      <Button
        className="shrink-0"
        variant="flat"
        onMouseDown={(e) => e.preventDefault()}
        onPress={handleOpen}
      >
        🔗 선택한 문장을 글에 연결
      </Button>

      <Modal
        isOpen={isOpen}
        placement="center"
        scrollBehavior="inside"
        onOpenChange={onOpenChange}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>연결할 글 선택</span>
            <span className="text-sm font-normal text-gray-500 line-clamp-2">
              선택한 문장: “{selectedText}”
            </span>
          </ModalHeader>
          <ModalBody className="pb-6">
            <Input
              autoFocus
              placeholder="제목이나 카테고리로 검색"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />

            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-500">
                검색 결과가 없습니다.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {filtered.map((option) => (
                  <li key={option.noteId}>
                    <button
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700"
                      type="button"
                      onClick={() => handlePick(option)}
                    >
                      <span className="block text-sm font-medium">
                        {option.title}
                      </span>
                      <span className="text-xs text-gray-500">
                        {option.mainCategory}
                        {!option.isPublished && " · 비공개"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
}