import { createStore } from "zustand/vanilla";
import { JSONContent } from "@tiptap/react";
import { subscribeWithSelector } from "zustand/middleware";

import { NoteCategory } from "./../types/index";

import {
  addEdtiorServer,
  allFetchEditorServerAdmin,
  deleteOneEditorServer,
  findOneAndUpdateEditorServer,
} from "@/serverActions/editorServerAction";
import { allFetchEdtiorServer } from "@/serverActions/editorServerAction";

export interface Note extends JSONContent {
  noteId?: number | null;
  title?: string | null;
  mainCategory?: NoteCategory | null;
  subCategory?: SubCategory | null;
  level?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  content?: JSONContent[];
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

export const defaultInitContent: Note = {
  noteId: null,
  title: "",
  mainCategory: "basics",
  subCategory: null,
  level: "BEGINNER",
  content: [
    {
      type: "heading",
      attrs: {
        textAlign: "left",
        level: 3,
      },
      content: [],
    },
  ],
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
      saveToLocal: () => {
        const newData = get();
        const newNote: Note = {
          noteId: newData.noteId,
          title: newData.title,
          subCategory: newData.subCategory,
          mainCategory: newData.mainCategory,
          level: newData.level,
          content: newData.content,
        };

        if (newData) {
          localStorage.setItem("editorAutoSave", JSON.stringify(newNote));
          set({ hasLocalChanges: true });
        }

        console.log("local저장", newNote);
      },
      deleteLocal: async () => {
        try {
          localStorage.removeItem("editorAutoSave");

          return true; // 성공적으로 삭제됨
        } catch (error) {
          console.error("Error deleting local data:", error);

          return false; // 삭제 실패
        }
      },
      saveToServer: async () => {
  try {
    console.log("실행됨 2");
    let note = get();

     const jsonData = await allFetchEditorServerAdmin();
    const allFetchData: Note[] = JSON.parse(jsonData);

    if (allFetchData && allFetchData.length > 0) {
      const lastData = allFetchData[allFetchData.length - 1];
      
      // 🔥 수정: 괄호 추가!
      note.noteId = (lastData.noteId ?? 0) + 1;
      console.log("마지막 노트 ID:", lastData.noteId, "→ 새 ID:", note.noteId);
    } else {
      console.log("데이터가 없습니다.");
      note.noteId = 1;  // 첫 노트는 1번
    }

    const newData = {
      noteId: note.noteId,
      title: note.title,
      mainCategory: note.mainCategory,
      subCategory: note.subCategory,
      content: note.content,
      level: note.level,
    };

    console.log("저장할 노트 ID:", newData.noteId);

    const noteData = await addEdtiorServer(JSON.stringify(newData));

    if (noteData.success) {
      localStorage.removeItem("editorAutoSave");
      set({ ...defaultInitContent });
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.log("saveToServer 에러:", error);
    return false;
  }
},
      updateToServer: async () => {
        try {
          let note = get();

          console.log("수정 노트 정보", note);

          const newData = {
            noteId: note.noteId,
            title: note.title,
            mainCategory: note.mainCategory,
            subCategory: note.subCategory,
            content: note.content,
            level: note.level,
          };

          if (newData) {
            console.log("에디터 서버 실행");
            const result = await findOneAndUpdateEditorServer(
              note.noteId!.toString(),
              JSON.stringify(newData),
            );

            console.log("성공여부", result.success);

            if (result.success) {
              localStorage.removeItem("editorAutoSave");

              set({ defaultInitContent });

              return true;
            } else {
              return false;
            }
          } else {
            return false;
          }
        } catch (error) {
          console.log(error);

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
      // 🔥 수정: loadFromLocal 함수에 타입 가드 추가
loadFromLocal: () => {
  try {
    const savedData = localStorage.getItem("editorAutoSave");
    
    // 🔥 추가: null 체크
    if (!savedData) {
      return null;
    }

    const parsedData: Note = JSON.parse(savedData);
    
    // 🔥 추가: 파싱된 데이터 검증
    if (!parsedData || typeof parsedData !== 'object') {
      return null;
    }

    console.log("local 불러오기", parsedData);
    return parsedData;
  } catch (error) {
    console.error("Error loading from local:", error);
    return null; // 🔥 에러 시 null 반환
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
