"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Button,
  Chip,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@heroui/react";
import { toast } from "react-toastify";
import { deleteAPost } from "@/serverActions/posts";
import type { PostSummary } from "@/types";

interface AdminBoardTableProps {
  posts: PostSummary[];
  projectName: string;
  postType: string;
}

export default function AdminBoardTable({
  posts = [], // 기본값 설정
  projectName,
  postType,
}: AdminBoardTableProps) {
  const router = useRouter();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [selectedPost, setSelectedPost] = useState<PostSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // posts가 없거나 배열이 아닐 경우 빈 배열로 처리
  const safePostsArray = Array.isArray(posts) ? posts : [];

  const handleDelete = async () => {
    if (!selectedPost) return;

    setIsDeleting(true);
    try {
      await deleteAPost({
        appName: projectName,
        postType: postType,
        id: selectedPost.id,
      });

      toast.success("게시글이 삭제되었습니다");
      onClose();
      router.refresh();
    } catch (error) {
      toast.error("삭제에 실패했습니다");
      console.error(error);
    } finally {
      setIsDeleting(false);
    }
  };

  const openDeleteModal = (post: PostSummary) => {
    setSelectedPost(post);
    onOpen();
  };

  const handleView = (postId: string) => {
    router.push(`/project/${projectName}/board/${postType}/detail/${postId}`);
  };

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
        <Table aria-label="게시판 관리 테이블">
          <TableHeader>
            <TableColumn>번호</TableColumn>
            <TableColumn>제목</TableColumn>
            <TableColumn>작성자</TableColumn>
            <TableColumn>작성일</TableColumn>
            <TableColumn>댓글</TableColumn>
            <TableColumn align="center">관리</TableColumn>
          </TableHeader>
          <TableBody emptyContent="게시글이 없습니다">
            {safePostsArray.map((post, index) => (
              <TableRow key={post.id}>
                <TableCell>{safePostsArray.length - index}</TableCell>
                <TableCell>
                  <button
                    onClick={() => handleView(post.id)}
                    className="text-left hover:text-blue-600 transition-colors"
                  >
                    {post.title}
                  </button>
                </TableCell>
                <TableCell>{post.writer}</TableCell>
                <TableCell>{post.created_at}</TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat" color="primary">
                    {post.commentCount || 0}
                  </Chip>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2 justify-center">
                    <Button
                      size="sm"
                      color="primary"
                      variant="flat"
                      onPress={() => handleView(post.id)}
                    >
                      보기
                    </Button>
                    <Button
                      size="sm"
                      color="danger"
                      variant="flat"
                      onPress={() => openDeleteModal(post)}
                    >
                      삭제
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 삭제 확인 모달 */}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>게시글 삭제</ModalHeader>
          <ModalBody>
            <p>
              정말로 <strong>"{selectedPost?.title}"</strong> 게시글을 삭제하시겠습니까?
            </p>
            <p className="text-sm text-gray-600 mt-2">
              이 작업은 되돌릴 수 없습니다.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>
              취소
            </Button>
            <Button
              color="danger"
              onPress={handleDelete}
              isLoading={isDeleting}
            >
              삭제
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}