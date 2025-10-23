"use client";

import {
  type ReactNode,
  createContext,
  useRef,
  useContext,
  useMemo,
} from "react";
import { useStore } from "zustand";

import {
  defaultInitContent,
  createEditorStore,
  EditorStore,
} from "@/store/editorSotre";

export type NoteStoreApi = ReturnType<typeof createEditorStore>;

const NoteStoreContext = createContext<NoteStoreApi | undefined>(undefined);

export interface NoteStoreProviderProps {
  children: ReactNode;
}

export const NoteStoreProvider = ({ children }: NoteStoreProviderProps) => {
  const storeRef = useRef<NoteStoreApi>();

  if (!storeRef.current) {
    storeRef.current = createEditorStore(defaultInitContent);
  }

  return (
    <NoteStoreContext.Provider value={storeRef.current}>
      {children}
    </NoteStoreContext.Provider>
  );
};

export const useNoteStore = <T,>(selector: (store: EditorStore) => T): T => {
  const noteStoreContext = useContext(NoteStoreContext);

  if (!noteStoreContext) {
    throw new Error(`useNoteStore must be used within UserStoreProvider`);
  }

  return useStore(noteStoreContext, selector);
};

export const useNoteStoreSubscribe = () => {
  const noteStoreContext = useContext(NoteStoreContext);

  if (!noteStoreContext) {
    throw new Error(`noteStoreSubscribe must be used within AuthStoreProvider`);
  }

  return useMemo(
    () => ({
      subscribe: noteStoreContext.subscribe,
    }),
    [noteStoreContext],
  );
};

// export const useAuthStoreSubscribe = () => {
//   const authStoreContext = useContext(AuthStoreContext)
//   if (!authStoreContext) {
//     throw new Error(`useUserStoreSubscribe must be used within AuthStoreProvider`)
//   }

//   return useMemo(() => ({
//     subscribe: authStoreContext.subscribe
//   }), [authStoreContext])
// }
