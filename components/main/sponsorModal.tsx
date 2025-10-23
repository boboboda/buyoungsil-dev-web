"use client";

import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";

import { useModalStore } from "@/store/sponsorStore";

export default function SponsorModal() {
  const { isSponsorModalOpen, onSponsorModalChange } = useModalStore();

  return (
    <div className="z-[200]">
      <Modal
        isOpen={isSponsorModalOpen}
        placement="center"
        onOpenChange={onSponsorModalChange}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-xl font-bold">💝 후원하기</h2>
                <p className="text-sm text-gray-500">
                  개발 활동을 응원해주세요!
                </p>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <div className="text-center py-4">
                    <p className="text-lg mb-2">
                      안녕하세요!{" "}
                      <span className="font-semibold text-blue-600">
                        김준욱
                      </span>
                      입니다.
                    </p>
                    <p className="text-gray-600 mb-4">
                      유용한 콘텐츠와 앱 개발을 위해 노력하고 있습니다.
                    </p>
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                    <h3 className="font-semibold mb-3 text-center">
                      💳 후원 계좌 정보
                    </h3>
                    <div className="space-y-2 text-center">
                      <div className="flex justify-between items-center bg-white dark:bg-gray-700 p-3 rounded-md">
                        <span className="font-medium">은행</span>
                        <span className="text-green-600 font-semibold">
                          농협
                        </span>
                      </div>
                      <div className="flex justify-between items-center bg-white dark:bg-gray-700 p-3 rounded-md">
                        <span className="font-medium">계좌번호</span>
                        <span className="font-mono text-blue-600 font-semibold">
                          356-0314-7383-03
                        </span>
                      </div>
                      <div className="flex justify-between items-center bg-white dark:bg-gray-700 p-3 rounded-md">
                        <span className="font-medium">예금주</span>
                        <span className="font-semibold">김준욱</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-center space-y-2">
                    <p className="text-sm text-gray-600">
                      🚀 여러분의 후원은 더 나은 콘텐츠 개발에 큰 도움이 됩니다.
                    </p>
                    <p className="text-sm text-gray-600">
                      📱 새로운 앱 개발과 기술 블로그 운영비로 소중히
                      사용하겠습니다.
                    </p>
                    <p className="text-xs text-gray-500 mt-3">
                      ❤️ 작은 관심과 응원에도 깊이 감사드립니다!
                    </p>
                  </div>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button color="danger" variant="light" onPress={onClose}>
                  닫기
                </Button>
                <Button
                  color="primary"
                  onPress={() => {
                    // 계좌번호 복사 기능 (선택사항)
                    navigator.clipboard.writeText("3560314738303");
                    alert("계좌번호가 복사되었습니다!");
                  }}
                >
                  계좌번호 복사
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
