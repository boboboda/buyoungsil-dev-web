// store/modal-store.ts
import { create } from "zustand";

interface ModalState {
  isSponsorModalOpen: boolean;
  openSponsorModal: () => void;
  closeSponsorModal: () => void;
  onSponsorModalChange: (open: boolean) => void; // NextUI용 핸들러 추가
}

export const useModalStore = create<ModalState>((set) => ({
  isSponsorModalOpen: false,
  openSponsorModal: () => set({ isSponsorModalOpen: true }),
  closeSponsorModal: () => set({ isSponsorModalOpen: false }),
  onSponsorModalChange: (open: boolean) => set({ isSponsorModalOpen: open }),
}));
