import { create } from "zustand";
import { Session } from "next-auth";

interface SessionStore {
  cachedSession: Session | null;
  setCachedSession: (session: Session | null) => void;
  isInitialized: boolean;
  setInitialized: (init: boolean) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  cachedSession: null,
  isInitialized: false,
  setCachedSession: (session) => set({ cachedSession: session }),
  setInitialized: (init) => set({ isInitialized: init }),
}));
