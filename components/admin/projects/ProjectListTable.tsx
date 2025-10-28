"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Button,
  Progress
} from "@heroui/react";
import { toast } from "react-toastify";
import { deleteProject } from "@/serverActions/projects";
import type { Project } from "@/types";

export default function ProjectListTable({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`"${title}" 프로젝트를 삭제하시겠습니까?`)) return;

    setLoading(id);
    try {
      await deleteProject(id);
      toast.success("프로젝트가 삭제되었습니다");
      router.refresh();
    } catch (error) {
      toast.error("삭제에 실패했습니다");
    } finally {
      setLoading(null);
    }
  };

  const statusColor: Record<string, any> = {
    "released": "success",
    "in-progress": "warning",
    "backend": "secondary"
  };

  const statusLabel: Record<string, string> = {
    "released": "출시됨",
    "in-progress": "개발중",
    "backend": "백엔드"
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
      <Table aria-label="프로젝트 관리 테이블">
        <TableHeader>
          <TableColumn>프로젝트명</TableColumn>
          <TableColumn>상태</TableColumn>
          <TableColumn>진행률</TableColumn>
          <TableColumn>타입</TableColumn>
          <TableColumn>태그</TableColumn>
          <TableColumn>작성일</TableColumn>
          <TableColumn>액션</TableColumn>
        </TableHeader>
        <TableBody>
          {projects.map((project) => (
            <TableRow key={project.id}>
              <TableCell>
                <Link
                  href={`/project/${project.name}`}
                  target="_blank"
                  className="text-blue-600 hover:text-blue-800 font-medium"
                >
                  {project.title}
                </Link>
              </TableCell>
              <TableCell>
                <Chip
                  color={statusColor[project.status]}
                  variant="flat"
                  size="sm"
                >
                  {statusLabel[project.status]}
                </Chip>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Progress
                    value={project.progress}
                    className="max-w-[100px]"
                    size="sm"
                    color={project.progress === 100 ? "success" : "primary"}
                  />
                  <span className="text-sm">{project.progress}%</span>
                </div>
              </TableCell>
              <TableCell>
                <Chip size="sm" variant="flat">
                  {project.platform}
                </Chip>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {project.tags.slice(0, 2).map((tag) => (
                    <Chip
                      key={tag.id}
                      size="sm"
                      style={{ backgroundColor: tag.color }}
                      className="text-white"
                    >
                      {tag.name}
                    </Chip>
                  ))}
                  {project.tags.length > 2 && (
                    <Chip size="sm" variant="flat">
                      +{project.tags.length - 2}
                    </Chip>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {new Date(project.createdAt).toLocaleDateString('ko-KR')}
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Link href={`/admin/projects/edit/${project.id}`}>
                    <Button size="sm" color="primary" variant="flat">
                      수정
                    </Button>
                  </Link>
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    onPress={() => handleDelete(project.id, project.title)}
                    isLoading={loading === project.id}
                  >
                    삭제
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {projects.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          생성된 프로젝트가 없습니다.
        </div>
      )}
    </div>
  );
}