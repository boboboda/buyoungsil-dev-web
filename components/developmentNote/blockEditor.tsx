"use client";

import { EditorContent } from "@tiptap/react";
import React, { useEffect, useRef, useState } from "react";
import {
  useDisclosure,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from "@heroui/react";

import { TextMenu } from "../titap/menus/TextMenu";
import { ContentItemMenu } from "../titap/menus/ContentItemMenu";
import { useNoteStore } from "../providers/editor-provider";

import { EditorHeader } from "./EditorHeader";

import { LinkMenu } from "@/components/titap/menus";
import { useBlockEditor } from "@/hooks/useBlockEditor";
import { Sidebar } from "@/components/titap/Sidebar";
import ImageBlockMenu from "@/lib/extensions/ImageBlock/components/ImageBlockMenu";
import { ColumnsMenu } from "@/lib/extensions/MultiColumn/menus";
import { TableColumnMenu, TableRowMenu } from "@/lib/extensions/Table/menus";
import { useSidebar } from "@/hooks/useSidebar";
import { defaultInitContent, Note } from "@/store/editorSotre";
import { NoteEditorType } from "@/types";

export const BlockEditor = ({
  fetchNotes,
  editorType,
  note,
}: {
  note?: Note;
  fetchNotes?: Note[];
  editorType: NoteEditorType;
}) => {
  const menuContainerRef = useRef(null);

  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  const leftSidebar = useSidebar();

  let { loadFromLocal, deleteLocal, setContent } = useNoteStore(
    (state) => state,
  );

  const [readState, setReadState] = useState(true);

  const { editor } = useBlockEditor({ clientID: "kim", readState: readState });

  
  // 🔥 수정 1: 첫 번째 useEffect (로컬 스토리지 체크)
useEffect(() => {
  const fetchData = async () => {
    try {
      const localNote: Note = await loadFromLocal();

      // 🔥 수정: null 체크 강화
      if (localNote && localNote.title && localNote.title !== "") {
        console.log("로컬데이터 있어요", localNote);
        onOpen();
      }
    } catch (error) {
      console.error("Error loading data:", error);
    }
  };

  if (editorType !== "read") {
    fetchData();
  }
}, []);

// 🔥 수정 2: 두 번째 useEffect (에디터 타입별 처리)
useEffect(() => {
  // 🔥 추가: note와 editor가 없으면 실행하지 않음
  if (!editor || !note) return;

  switch (editorType) {
    case "add":
      break;
      
    case "edit":
      // 🔥 추가: content가 있는지 확인
      if (note.content) {
        editor.commands.clearContent();
        editor.commands.setContent(note.content);
        setContent({
          noteId: note.noteId,
          title: note.title,
          content: note.content,
        });
      }
      break;

    case "read":
      // 🔥 추가: content가 있는지 확인
      if (note.content) {
        editor.commands.clearContent();
        editor.commands.setContent(note.content);
        setContent({ 
          title: note.title, 
          content: note.content 
        });
        setReadState(false);
      }
      break;
  }
}, [note, editor, editorType]); // 🔥 의존성 배열에 editorType 추가

// 🔥 수정 3: editor가 없을 때 로딩 표시
if (!editor) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="text-gray-500">에디터를 불러오는 중...</div>
    </div>
  );
}

  return (
    <div ref={menuContainerRef} className="flex h-full w-full">
      <Modal
        backdrop="opaque"
        classNames={{
          body: "py-6",
          backdrop: "bg-[#292f46]/50 backdrop-opacity-40",
          base: "border-[#292f46] bg-[#19172c] text-[#a8b0d3]",
          header: "border-b-[1px] border-[#292f46]",
          closeButton: "hover:bg-white/5 active:bg-white/10",
        }}
        isDismissable={false}
        isOpen={isOpen}
        placement="center"
        radius="lg"
        onOpenChange={onOpenChange}
      >
        <ModalContent>
          {(onClose) => (
            <CustomModalContent
              deleteLocal={async () => {
                const success = await deleteLocal();

                if (success) {
                  onClose();
                  if (editor) {
                    setContent({ title: "" });
                    editor.commands.clearContent();
                    editor.commands.setContent(defaultInitContent.content);
                  }
                } else {
                  return;
                }
              }}
              onClose={onClose}
            />
          )}
        </ModalContent>
      </Modal>

      {isOpen ? null : (
        <>
          <Sidebar
            editor={editor}
            isOpen={leftSidebar.isOpen}
            onClose={leftSidebar.close}
          />
          <div className="relative flex flex-col flex-1 h-full overflow-hidden">
            {editorType !== "read" ? (
              <EditorHeader
                editType={editorType}
                editor={editor}
                isSidebarOpen={leftSidebar.isOpen}
                note={note}
                notes={fetchNotes}
                toggleSidebar={leftSidebar.toggle}
              />
            ) : null}

            <EditorContent className="flex-1 overflow-y-auto" editor={editor} />
            <ContentItemMenu editor={editor} />
            <LinkMenu appendTo={menuContainerRef} editor={editor} />
            <TextMenu editor={editor} />
            <ColumnsMenu appendTo={menuContainerRef} editor={editor} />
            <TableRowMenu appendTo={menuContainerRef} editor={editor} />
            <TableColumnMenu appendTo={menuContainerRef} editor={editor} />
            <ImageBlockMenu appendTo={menuContainerRef} editor={editor} />
          </div>
        </>
      )}
    </div>
  );
};

export default BlockEditor;

const CustomModalContent = ({
  onClose,
  deleteLocal,
}: {
  onClose: () => void;
  deleteLocal: () => void;
}) => {
  return (
    <>
      <ModalHeader className="flex flex-col gap-1">안내</ModalHeader>
      <ModalBody>
        <h3>이전에 쓰던 글을 불러오시겠습니까?</h3>
      </ModalBody>
      <ModalFooter>
        <Button color="primary" onPress={onClose}>
          예
        </Button>
        <Button
          color="danger"
          onPress={() => {
            deleteLocal();
            onClose();
          }}
        >
          아니요
        </Button>
      </ModalFooter>
    </>
  );
};
