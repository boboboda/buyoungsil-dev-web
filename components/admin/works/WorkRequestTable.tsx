"use client";

import { useState } from "react";
import { WorkRequest } from "@prisma/client";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Select,
  SelectItem,
} from "@heroui/react";
import { toast } from "react-toastify";
import { updateWorkRequestStatus } from "@/serverActions/workRequests";

interface WorkRequestTableProps {
  workRequests: WorkRequest[];
}

const statusConfig = {
  pending: { label: "대기중", color: "warning" as const },
  reviewing: { label: "검토중", color: "primary" as const },
  accepted: { label: "수락됨", color: "success" as const },
  rejected: { label: "거절됨", color: "danger" as const },
  completed: { label: "완료됨", color: "default" as const },
};

const projectTypeLabels = {
  mobile: "모바일 앱",
  web: "웹사이트/웹앱",
  backend: "백엔드/API",
  consulting: "컨설팅",
};

export default function WorkRequestTable({ workRequests: initialRequests }: WorkRequestTableProps) {
  const [requests, setRequests] = useState(initialRequests);
  const [selectedRequest, setSelectedRequest] = useState<WorkRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const filteredRequests = statusFilter === "all" 
    ? requests 
    : requests.filter(req => req.status === statusFilter);

  const handleViewDetail = (request: WorkRequest) => {
    setSelectedRequest(request);
    onOpen();
  };

  const handleStatusChange = async (id: string, newStatus: string, adminNote?: string) => {
    setLoading(true);
    try {
      const result = await updateWorkRequestStatus(id, newStatus, adminNote);
      
      if (result.success) {
        // 로컬 상태 업데이트
        setRequests(prev => 
          prev.map(req => req.id === id ? { ...req, status: newStatus, adminNote: adminNote || req.adminNote } : req)
        );
        
        if (selectedRequest?.id === id) {
          setSelectedRequest(prev => prev ? { ...prev, status: newStatus, adminNote: adminNote || prev.adminNote } : null);
        }
        
        toast.success("상태가 변경되었습니다");
      } else {
        toast.error(result.error || "상태 변경에 실패했습니다");
      }
    } catch (error) {
      toast.error("상태 변경에 실패했습니다");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex gap-4 items-center">
        <Select
          label="상태 필터"
          selectedKeys={[statusFilter]}
          onSelectionChange={(keys) => setStatusFilter(Array.from(keys)[0] as string)}
          className="max-w-xs"
        >
          <SelectItem key="all">전체</SelectItem>
          <SelectItem key="pending">대기중</SelectItem>
          <SelectItem key="reviewing">검토중</SelectItem>
          <SelectItem key="accepted">수락됨</SelectItem>
          <SelectItem key="rejected">거절됨</SelectItem>
          <SelectItem key="completed">완료됨</SelectItem>
        </Select>
        
        <div className="text-sm text-gray-600 dark:text-gray-400">
          총 {filteredRequests.length}건
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
        {filteredRequests.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="text-lg mb-2">📭</p>
            <p>외주 신청이 없습니다</p>
          </div>
        ) : (
          <Table aria-label="외주 신청 목록">
            <TableHeader>
              <TableColumn>신청일</TableColumn>
              <TableColumn>이름</TableColumn>
              <TableColumn>회사</TableColumn>
              <TableColumn>프로젝트 제목</TableColumn>
              <TableColumn>유형</TableColumn>
              <TableColumn>예산</TableColumn>
              <TableColumn>상태</TableColumn>
              <TableColumn>작업</TableColumn>
            </TableHeader>
            <TableBody>
              {filteredRequests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>
                    {new Date(request.createdAt).toLocaleDateString('ko-KR')}
                  </TableCell>
                  <TableCell className="font-medium">{request.name}</TableCell>
                  <TableCell>{request.company || '-'}</TableCell>
                  <TableCell className="max-w-xs truncate">{request.title}</TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat">
                      {projectTypeLabels[request.projectType as keyof typeof projectTypeLabels]}
                    </Chip>
                  </TableCell>
                  <TableCell className="text-sm">{request.budget}</TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      color={statusConfig[request.status as keyof typeof statusConfig].color}
                      variant="flat"
                    >
                      {statusConfig[request.status as keyof typeof statusConfig].label}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="flat"
                      color="primary"
                      onClick={() => handleViewDetail(request)}
                    >
                      상세보기
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* 상세 모달 */}
      <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                외주 신청 상세
              </ModalHeader>
              <ModalBody>
                {selectedRequest && (
                  <div className="space-y-6">
                    {/* 신청자 정보 */}
                    <div>
                      <h3 className="text-lg font-bold mb-3">👤 신청자 정보</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-gray-500">이름:</span>
                          <span className="ml-2 font-medium">{selectedRequest.name}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">이메일:</span>
                          <span className="ml-2 font-medium">{selectedRequest.email}</span>
                        </div>
                        {selectedRequest.company && (
                          <div>
                            <span className="text-gray-500">회사:</span>
                            <span className="ml-2 font-medium">{selectedRequest.company}</span>
                          </div>
                        )}
                        {selectedRequest.phone && (
                          <div>
                            <span className="text-gray-500">연락처:</span>
                            <span className="ml-2 font-medium">{selectedRequest.phone}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 프로젝트 정보 */}
                    <div>
                      <h3 className="text-lg font-bold mb-3">💼 프로젝트 정보</h3>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-gray-500">제목:</span>
                          <p className="mt-1 font-medium">{selectedRequest.title}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">설명:</span>
                          <p className="mt-1 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                            {selectedRequest.description}
                          </p>
                        </div>
                        {selectedRequest.requirements && (
                          <div>
                            <span className="text-gray-500">주요 기능/요구사항:</span>
                            <p className="mt-1 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                              {selectedRequest.requirements}
                            </p>
                          </div>
                        )}
                        {selectedRequest.reference && (
                          <div>
                            <span className="text-gray-500">참고 URL:</span>
                            <a 
                              href={selectedRequest.reference} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="ml-2 text-blue-600 hover:underline"
                            >
                              {selectedRequest.reference}
                            </a>
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-3 pt-2">
                          <div>
                            <span className="text-gray-500">유형:</span>
                            <p className="mt-1 font-medium">
                              {projectTypeLabels[selectedRequest.projectType as keyof typeof projectTypeLabels]}
                            </p>
                          </div>
                          <div>
                            <span className="text-gray-500">예산:</span>
                            <p className="mt-1 font-medium">{selectedRequest.budget}</p>
                          </div>
                          <div>
                            <span className="text-gray-500">기간:</span>
                            <p className="mt-1 font-medium">{selectedRequest.timeline}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 상태 변경 */}
                    <div>
                      <h3 className="text-lg font-bold mb-3">⚙️ 관리</h3>
                      <div className="space-y-3">
                        <Select
                          label="상태 변경"
                          selectedKeys={[selectedRequest.status]}
                          onSelectionChange={(keys) => {
                            const newStatus = Array.from(keys)[0] as string;
                            handleStatusChange(selectedRequest.id, newStatus);
                          }}
                          isDisabled={loading}
                        >
                          <SelectItem key="pending">대기중</SelectItem>
                          <SelectItem key="reviewing">검토중</SelectItem>
                          <SelectItem key="accepted">수락됨</SelectItem>
                          <SelectItem key="rejected">거절됨</SelectItem>
                          <SelectItem key="completed">완료됨</SelectItem>
                        </Select>

                        {selectedRequest.adminNote && (
                          <div>
                            <span className="text-sm text-gray-500">관리자 메모:</span>
                            <p className="mt-1 p-3 bg-gray-100 dark:bg-gray-700 rounded text-sm">
                              {selectedRequest.adminNote}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button color="default" variant="flat" onPress={onClose}>
                  닫기
                </Button>
                <Button
                  color="primary"
                  as="a"
                  href={`mailto:${selectedRequest?.email}`}
                >
                  이메일 보내기
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}