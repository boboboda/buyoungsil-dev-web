import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from "@heroui/react";

interface SimpleModalProps {
  content: string;
  title?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void; // 확인 클릭 시 외부 로직 실행만
  onCancel?: () => void; // 취소 클릭 시 외부 로직 실행만
  confirmText?: string;
  cancelText?: string;
  confirmColor?: "primary" | "danger" | "success" | "warning";
  showCancel?: boolean;
  isLoading?: boolean; // 외부에서 로딩 상태 관리
}

export default function SimpleModal({
  content,
  title = "확인",
  isOpen,
  onOpenChange,
  onConfirm, // 그냥 바로 실행
  onCancel,
  confirmText = "확인",
  cancelText = "취소",
  confirmColor = "primary",
  showCancel = true,
  isLoading = false,
}: SimpleModalProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader>{title}</ModalHeader>
            <ModalBody>
              <p>{content}</p>
            </ModalBody>
            <ModalFooter>
              {showCancel && (
                <Button
                  color="danger"
                  disabled={isLoading}
                  variant="light"
                  onPress={() => {
                    onCancel?.(); // 외부 취소 로직만 실행
                    onClose(); // 모달 닫기
                  }}
                >
                  {cancelText}
                </Button>
              )}
              <Button
                color={confirmColor}
                disabled={isLoading}
                isLoading={isLoading}
                onPress={onConfirm} // 외부 확인 로직만 실행 (모달 닫기 포함 안됨)
              >
                {confirmText}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
