// store/visitorStore.ts (Zustand 스토어)
import { create } from "zustand";

interface VisitorState {
  todayCount: number;
  totalCount: number;
  totalUserCount: number;
  setCounts: (today: number, total: number, totalUser: number) => void;
  // fetchCounts는 이제 컴포넌트에서 직접 호출하거나 다른 방식으로 관리
}

export const useVisitorStore = create<VisitorState>((set) => ({
  todayCount: 0,
  totalCount: 0,
  totalUserCount: 0,
  setCounts: (today, total, totalUser) =>
    set({ todayCount: today, totalCount: total, totalUserCount: totalUser }),
}));
