// store/editorSotre.ts
import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";

import { NoteCategory } from "./../types/index";

import {
  addEdtiorServer,
  allFetchEditorServerAdmin,
  deleteOneEditorServer,
  findOneAndUpdateEditorServer,
  getMaxNoteId,
} from "@/serverActions/editorServerAction";
import { allFetchEdtiorServer } from "@/serverActions/editorServerAction";

export interface Note {
  noteId?: number | null;
  title?: string | null;
  mainCategory?: NoteCategory | null;
  subCategory?: SubCategory | null;
  level?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  content?: any; // 🔥 Lexical JSON 또는 TipTap JSON
}

export interface SubCategory {
  id: number;
  name: string;
}

export interface EditorActions {
  setContent: (note: Note) => void;
  saveToLocal: () => void;
  saveToServer: () => Promise<boolean>;
  loadFromLocal: () => Note | null | undefined;
  deleteLocal: () => Promise<boolean>;
  setHasLocalChanges: (value: boolean) => void;
  deleteSubCategory: (id: number) => void;
  setSubCategories: (subCategories: SubCategory[]) => void;
  setEditorState: (state: EditorState) => void;
  updateToServer: () => Promise<boolean>;
  deleteToServer: (noteID: string) => Promise<boolean>;
}

// 🔥 기본 Lexical 형식으로 변경
export const defaultInitContent: Note = {
  noteId: null,
  title: "",
  mainCategory: "basics",
  subCategory: null,
  level: "BEGINNER",
  content: {
    root: {
      children: [
        {
          children: [
            {
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text: "",
              type: "text",
              version: 1
            }
          ],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1
        }
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1
    }
  },
};

export interface EditorState {
  subCategories: SubCategory[];
  hasLocalChanges: boolean;
}

export type EditorStore = Note & EditorActions & EditorState;

export const createEditorStore = (initState: Note = defaultInitContent) => {
  return createStore<EditorStore>()(
    subscribeWithSelector((set, get) => ({
      ...initState,
      subCategories: [],
      hasLocalChanges: false,
      setEditorState: (values) => set((state) => ({ ...state, ...values })),
      setContent: (note) => set((state) => ({ ...state, ...note })),
      
      // 🔥 로컬 저장 - Lexical JSON 형식으로
      saveToLocal: () => {
        const newData = get();
        const newNote: Note = {
          noteId: newData.noteId,
          title: newData.title,
          subCategory: newData.subCategory,
          mainCategory: newData.mainCategory,
          level: newData.level,
          content: newData.content, // Lexical JSON 그대로 저장
        };

        if (newData) {
          localStorage.setItem("editorAutoSave", JSON.stringify(newNote));
          set({ hasLocalChanges: true });
        }

        console.log("✅ 로컬 저장 (Lexical 형식):", newNote);
      },
      
      deleteLocal: async () => {
        try {
          localStorage.removeItem("editorAutoSave");
          return true;
        } catch (error) {
          console.error("Error deleting local data:", error);
          return false;
        }
      },
      
      // 🔥 서버 저장 - Lexical JSON 형식으로
      saveToServer: async () => {
        try {
          console.log("🚀 서버 저장 시작");
          let note = get();

          const maxNoteId = await getMaxNoteId();
          note.noteId = maxNoteId + 1;
          
          console.log("새 노트 ID:", note.noteId);

          const newData = {
            noteId: note.noteId,
            title: note.title,
            mainCategory: note.mainCategory,
            subCategory: note.subCategory,
            content: note.content, // 🔥 Lexical JSON 그대로 저장
            level: note.level,
          };

          console.log("📤 저장할 데이터:", newData);

          const noteData = await addEdtiorServer(JSON.stringify(newData));

          if (noteData.success) {
            localStorage.removeItem("editorAutoSave");
            set({ ...defaultInitContent });
            console.log("✅ 서버 저장 성공");
            return true;
          } else {
            console.log("❌ 서버 저장 실패");
            return false;
          }
        } catch (error) {
          console.log("❌ saveToServer 에러:", error);
          return false;
        }
      },
      
      // 🔥 서버 업데이트 - Lexical JSON 형식으로
      updateToServer: async () => {
        try {
          let note = get();

          console.log("🔄 수정 노트 정보:", note);

          const newData = {
            noteId: note.noteId,
            title: note.title,
            mainCategory: note.mainCategory,
            subCategory: note.subCategory,
            content: note.content, // 🔥 Lexical JSON 그대로 저장
            level: note.level,
          };

          if (newData) {
            console.log("📤 수정할 데이터:", newData);
            const result = await findOneAndUpdateEditorServer(
              note.noteId!.toString(),
              JSON.stringify(newData),
            );

            console.log("결과:", result.success);

            if (result.success) {
              localStorage.removeItem("editorAutoSave");
              console.log("✅ 서버 업데이트 성공");
              return true;
            } else {
              console.log("❌ 서버 업데이트 실패");
              return false;
            }
          } else {
            return false;
          }
        } catch (error) {
          console.log("❌ updateToServer 에러:", error);
          return false;
        }
      },
      
      deleteToServer: async (noteId: string) => {
        try {
          const result = await deleteOneEditorServer(noteId);

          if (result.success) {
            return true;
          } else {
            return false;
          }
        } catch (error) {
          console.log("delete err", error);
          return false;
        }
      },
      
      // 🔥 로컬 불러오기 - Lexical JSON 형식
      loadFromLocal: () => {
        try {
          const savedData = localStorage.getItem("editorAutoSave");
          
          if (!savedData) {
            console.log("📭 로컬 저장 데이터 없음");
            return null;
          }

          const parsedData: Note = JSON.parse(savedData);
          
          if (!parsedData || typeof parsedData !== 'object') {
            console.log("❌ 잘못된 데이터 형식");
            return null;
          }

          console.log("✅ 로컬 불러오기 (Lexical 형식):", parsedData);
          return parsedData;
        } catch (error) {
          console.error("❌ 로컬 불러오기 에러:", error);
          return null;
        }
      },
      
      setHasLocalChanges: (value) => set({ hasLocalChanges: value }),
      
      deleteSubCategory: (id) =>
        set((state) => ({
          subCategories: state.subCategories.filter((cat) => cat.id !== id),
        })),
      
      setSubCategories: (subCategories) => {
        set({ subCategories });
        localStorage.setItem("subCategories", JSON.stringify(subCategories));
      },
    })),
  );
};
