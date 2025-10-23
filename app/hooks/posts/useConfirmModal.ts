
// ===== 1. useConfirmModal 훅 타입 정의 =====

import { useDisclosure } from "@heroui/react";
import { useState } from "react";

// 모달 설정 타입 정의
interface ModalConfig {
  content: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  confirmColor?: "primary" | "danger" | "success" | "warning";
  showCancel?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

// useConfirmModal 리턴 타입 정의
interface UseConfirmModalReturn {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  modalConfig: ModalConfig | null;
  showConfirm: (config: ModalConfig) => void;
  hideModal: () => void;
}

export function useConfirmModal(): UseConfirmModalReturn {
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [modalConfig, setModalConfig] = useState<ModalConfig | null>(null);

  const showConfirm = (config: ModalConfig) => {
    setModalConfig(config);
    onOpen();
  };

  const hideModal = () => {
    setModalConfig(null);
    onOpenChange(); // 명시적으로 false 전달
  };

  return {
    isOpen,
    onOpenChange,
    modalConfig,
    showConfirm,
    hideModal,
  };
}