"use client";

import { useState } from "react";
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
  Textarea,
} from "@heroui/react";
import { toast } from "react-toastify";
import moment from "moment";
import { updateWorkRequestStatus, deleteWorkRequest } from "@/serverActions/workRequests";

interface WorkRequest {
  id: string;
  name: string;
  email: string;
  company: string | null;
  phone: string | null;
  projectType: string;
  budget: string;
  timeline: string;
  title: string;
  description: string;
  requirements: string | null;
  reference: string | null;
  status: string;
  adminNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkRequestTableProps {
  workRequests: WorkRequest[];
}

export default function WorkRequestTable({ workRequests: initialRequests }: WorkRequestTableProps) {
  const [workRequests, setWorkRequests] = useState(initialRequests);
  const [selectedRequest, setSelectedRequest] = useState<WorkRequest | null>(null);
  const [newStatus, setNewStatus] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const { isOpen, onOpen, onClose } = useDisclosure();

  const statusConfig = {
    pending: { label: "대기중", color: "warning" as const },
    reviewing: { label: "검토중", color: "primary" as const },
    accepted: { label: "수락", color: "success" as const },
    rejected: { label: "거절", color: "danger" as const },
    completed: { label: "완료", color: "default" as const },
  };

  const projectTypeLabels: Record<string, string> = {
    mobile: "📱 모바일",
    web: "🌐 웹",
    backend: "⚙️ 백엔드",
    consulting: "💡 컨설팅",
  };

  const handleOpenDetail = (request: WorkRequest) => {
    setSelectedRequest(request);
    setNewStatus(request.status);
    setAdminNote(request.adminNote || "");
    onOpen();
  };

  const handleUpdateStatus = async () => {
    if (!selectedRequest) return;

    const result = await updateWorkRequestStatus(
      selectedRequest.id,
      newStatus,
      adminNote
    );

    if (result.success) {
      toast.success("상태가 업데이트되었습니다.");
      
      // 로컬 상태 업데이트
      setWorkRequests(prev =>
        prev.map(req =>
          req.id === selectedRequest.id
            ? { ...req, status: newStatus, adminNote }
            : req
        )
      );
      
      onClose();
    } else {
      toast.error(result.error || "업데이트 실패");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;

    const result = await deleteWorkRequest(id);

    if (result.success) {
      toast.success("삭제되었습니다.");
      setWorkRequests(prev => prev.filter(req => req.id !== id));
    } else {
      toast.error(result.error || "삭제 실패");
    }
  };

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
        <Table aria-label="외주 신청 목록">
          <TableHeader>
            <TableColumn>접수일</TableColumn>
            <TableColumn>신청자</TableColumn>
            <TableColumn>프로젝트 제목</TableColumn>
            <TableColumn>유형</TableColumn>
            <TableColumn>예산</TableColumn>
            <TableColumn>상태</TableColumn>
            <TableColumn>액션</TableColumn>
          </TableHeader>
          <TableBody>
            {workRequests.map((request) => (
              <TableRow key={request.id}>
                <TableCell>
                  {moment(request.createdAt).format("YYYY-MM-DD")}
                </TableCell>
                <TableCell>
                  <div>
                    <p className="font-medium">{request.name}</p>
                    <p className="text-xs text-gray-500">{request.email}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <p className="line-clamp-2">{request.title}</p>
                </TableCell>
                <TableCell>
                  {projectTypeLabels[request.projectType] || request.projectType}
                </TableCell>
                <TableCell>
                  <span className="text-sm">{request.budget}</span>
                </TableCell>
                <TableCell>
                  <Chip
                    color={statusConfig[request.status as keyof typeof statusConfig]?.color}
                    size="sm"
                    variant="flat"
                  >
                    {statusConfig[request.status as keyof typeof statusConfig]?.label || request.status}
                  </Chip>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      color="primary"
                      variant="flat"
                      onPress={() => handleOpenDetail(request)}
                    >
                      상세
                    </Button>
                    <Button
                      size="sm"
                      color="danger"
                      variant="flat"
                      onPress={() => handleDelete(request.id)}
                    >
                      삭제
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {workRequests.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            접수된 외주 신청이 없습니다.
          </div>
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
                          <span className="text-gray-500">유형:</span>
                          <span className="ml-2 font-medium">
                            {projectTypeLabels[selectedRequest.projectType]}
                          </span>
                        </div>
                        <div>
                          <span className="text-gray-500">예산:</span>
                          <span className="ml-2 font-medium">{selectedRequest.budget}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">희망 기간:</span>
                          <span className="ml-2 font-medium">{selectedRequest.timeline}</span>
                        </div>
                      </div>
                    </div>

                    {/* 프로젝트 상세 */}
                    <div>
                      <h3 className="text-lg font-bold mb-3">📝 프로젝트 상세</h3>
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm text-gray-500 mb-1">제목</p>
                          <p className="font-medium">{selectedRequest.title}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500 mb-1">설명</p>
                          <p className="text-sm whitespace-pre-wrap">{selectedRequest.description}</p>
                        </div>
                        {selectedRequest.requirements && (
                          <div>
                            <p className="text-sm text-gray-500 mb-1">요구사항</p>
                            <p className="text-sm whitespace-pre-wrap">{selectedRequest.requirements}</p>
                          </div>
                        )}
                        {selectedRequest.reference && (
                          <div>
                            <p className="text-sm text-gray-500 mb-1">참고 URL</p>
                            <a
                              href={selectedRequest.reference}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:underline"
                            >
                              {selectedRequest.reference}
                            </a>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 상태 관리 */}
                    <div>
                      <h3 className="text-lg font-bold mb-3">⚙️ 상태 관리</h3>
                      <Select
                        label="상태"
                        selectedKeys={[newStatus]}
                        onSelectionChange={(keys) => {
                          const value = Array.from(keys)[0] as string;
                          setNewStatus(value);
                        }}
                        className="mb-3"
                      >
                        {Object.entries(statusConfig).map(([key, config]) => (
                          <SelectItem key={key}>
                            {config.label}
                          </SelectItem>
                        ))}
                      </Select>

                      <Textarea
                        label="관리자 메모"
                        placeholder="내부 메모를 작성하세요"
                        value={adminNote}
                        onValueChange={setAdminNote}
                        minRows={3}
                      />
                    </div>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button color="danger" variant="light" onPress={onClose}>
                  닫기
                </Button>
                <Button color="primary" onPress={handleUpdateStatus}>
                  저장
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}