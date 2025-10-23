// stores/uiStore.ts

import { create } from "zustand";

interface UIState {
  showNavbar: boolean;
  setShowNavbar: (show: boolean) => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  showNavbar: true,
  setShowNavbar: (show) => set({ showNavbar: show }),
  isSidebarOpen: false,
  toggleSidebar: () =>
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
}));
