// components/admin/projects/ProjectLogsView.tsx
"use client";

import { Card, CardBody, CardHeader, Chip, Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import moment from "moment";

interface ProjectLog {
  id: string;
  title: string;
  content: string;
  logType: string;
  noteId?: number | null;
  createdAt: Date;
}

interface ProjectLogsViewProps {
  logs: ProjectLog[];
  projectId: string;
}

export default function ProjectLogsView({ logs, projectId }: ProjectLogsViewProps) {
  const router = useRouter();

  const getLogTypeConfig = (logType: string) => {
    switch (logType) {
      case "progress":
        return { icon: "📈", label: "진행", color: "primary" as const };
      case "issue":
        return { icon: "🐛", label: "이슈", color: "danger" as const };
      case "solution":
        return { icon: "✅", label: "해결", color: "success" as const };
      case "milestone":
        return { icon: "🎉", label: "마일스톤", color: "secondary" as const };
      default:
        return { icon: "📝", label: "기타", color: "default" as const };
    }
  };

  if (logs.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">아직 개발 로그가 없습니다.</p>
        <Button
          color="primary"
          onClick={() => router.push(`/admin/logs/create?project=${projectId}`)}
        >
          첫 로그 작성하기
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">개발 로그 ({logs.length})</h2>
        <Button
          color="primary"
          onClick={() => router.push(`/admin/logs/create?project=${projectId}`)}
        >
          + 로그 추가
        </Button>
      </div>

      <div className="space-y-4">
        {logs.map((log) => {
          const typeConfig = getLogTypeConfig(log.logType);
          
          return (
            <Card key={log.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="flex gap-3 items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Chip
                      size="sm"
                      color={typeConfig.color}
                      variant="flat"
                    >
                      {typeConfig.icon} {typeConfig.label}
                    </Chip>
                    <span className="text-xs text-gray-500">
                      {moment(log.createdAt).format("YYYY년 MM월 DD일")}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold">{log.title}</h3>
                </div>
              </CardHeader>
              <CardBody>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {log.content}
                </p>
                {log.noteId && (
                  <div className="mt-3">
                    <Chip size="sm" variant="bordered" color="secondary">
                      🔗 연결된 기술 가이드: #{log.noteId}
                    </Chip>
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}