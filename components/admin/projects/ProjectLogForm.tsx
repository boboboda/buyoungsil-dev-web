"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Input,
  Textarea,
  Select,
  SelectItem,
  Button,
  Chip
} from "@heroui/react";
import { toast } from "react-toastify";
import { createProjectLog } from "@/serverActions/projects";
import { TECH_STACK_OPTIONS } from "@/types";

interface ProjectTag {
  id: string;
  name: string;
  color: string;
}

interface Project {
  id: string;
  title: string;
  platform: string;
    techStack: string[];
  tags: ProjectTag[];
}

interface Note {
  noteId?: number | null;
  title?: string | null;
  mainCategory?: string | null;
  level?: string;
}

interface ProjectLogFormProps {
  projects: Project[];
  notes: Note[];
}

export default function ProjectLogForm({ projects, notes }: ProjectLogFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    projectId: "",
    title: "",
    content: "",
    logType: "progress",
    noteId: ""
  });

  const logTypeOptions = [
    { value: "progress", label: "📈 진행" },
    { value: "issue", label: "🐛 이슈" },
    { value: "solution", label: "✅ 해결" },
    { value: "milestone", label: "🎉 마일스톤" }
  ];

 
  // 🔥 수정: techStack 기반 필터링
const filteredNotes = useMemo(() => {
  if (!formData.projectId) return notes;

  const selectedProject = projects.find(p => p.id === formData.projectId);
  if (!selectedProject || !selectedProject.techStack) return notes;

  console.log("🔍 프로젝트 기술 스택:", selectedProject.techStack);

  return notes.filter(note => {
    if (!note.mainCategory) return false;
    
    // 1. basics는 항상 표시
    if (note.mainCategory === "basics") return true;
    
    // 2. 프로젝트의 techStack에 해당하는 노트만 표시
    const isMatch = selectedProject.techStack.some(tech => {
      const option = TECH_STACK_OPTIONS.find(o => o.value === tech);
      return option?.category === note.mainCategory;
    });

    console.log(`  📝 ${note.mainCategory} → ${isMatch ? '✅' : '❌'}`);
    
    return isMatch;
  });
}, [formData.projectId, projects, notes]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.projectId || !formData.title || !formData.content) {
      toast.error("필수 항목을 입력하세요");
      return;
    }

    setLoading(true);

    try {
      await createProjectLog({
        projectId: formData.projectId,
        title: formData.title,
        content: formData.content,
        logType: formData.logType,
        noteId: formData.noteId ? Number(formData.noteId) : undefined
      });

      toast.success("개발 일지가 저장되었습니다");
      router.push("/admin/projects");
      router.refresh();
    } catch (error) {
      toast.error("저장에 실패했습니다");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 프로젝트 선택 */}
      <Select
        label="프로젝트"
        placeholder="프로젝트를 선택하세요"
        selectedKeys={formData.projectId ? [formData.projectId] : []}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as string;
          setFormData(prev => ({ ...prev, projectId: value, noteId: "" }));
        }}
        isRequired
      >
        {projects.map((project) => (
          <SelectItem key={project.id} textValue={project.title}>
            <div>
              <div className="font-medium">{project.title}</div>
              <div className="text-xs text-gray-500">
                {project.platform} | {project.tags.map(t => t.name).join(', ')}
              </div>
            </div>
          </SelectItem>
        ))}
      </Select>

      {/* 로그 타입 */}
      <Select
        label="로그 타입"
        placeholder="로그 타입 선택"
        selectedKeys={[formData.logType]}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as string;
          setFormData(prev => ({ ...prev, logType: value }));
        }}
        isRequired
      >
        {logTypeOptions.map((option) => (
          <SelectItem key={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </Select>

      {/* 제목 */}
      <Input
        label="제목"
        placeholder="개발 일지 제목"
        value={formData.title}
        onValueChange={(value) => setFormData(prev => ({ ...prev, title: value }))}
        isRequired
      />

      {/* 내용 */}
      <Textarea
        label="내용"
        placeholder="개발 과정을 자세히 작성하세요"
        value={formData.content}
        onValueChange={(value) => setFormData(prev => ({ ...prev, content: value }))}
        minRows={10}
        isRequired
      />

      {/* 🔥 연결된 기술 가이드 */}
      <div>
        <Select
          label="연결된 기술 가이드 (선택사항)"
          placeholder="관련 기술 가이드를 연결하세요"
          selectedKeys={formData.noteId ? [formData.noteId] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as string;
            setFormData(prev => ({ ...prev, noteId: value }));
          }}
          description={
            formData.projectId 
              ? `프로젝트 플랫폼 관련 노트 (${filteredNotes.length}개)`
              : "먼저 프로젝트를 선택하세요"
          }
          isDisabled={!formData.projectId}
        >
          {filteredNotes.map((note) => (
            <SelectItem key={String(note.noteId)} textValue={note.title || "제목 없음"}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex-1 truncate">{note.title || "제목 없음"}</span>
                <div className="flex items-center gap-1">
                  <Chip size="sm" variant="flat" className="text-xs">
                    {note.mainCategory}
                  </Chip>
                  <Chip
                    size="sm"
                    color={
                      note.level === "BEGINNER" ? "success" :
                      note.level === "INTERMEDIATE" ? "warning" : "danger"
                    }
                    variant="flat"
                  >
                    {note.level === "BEGINNER" ? "🟢" :
                     note.level === "INTERMEDIATE" ? "🟡" : "🔴"}
                  </Chip>
                </div>
              </div>
            </SelectItem>
          ))}
        </Select>
      </div>

      {/* 저장 버튼 */}
      <Button
        type="submit"
        color="primary"
        size="lg"
        isLoading={loading}
        className="w-full"
      >
        저장
      </Button>
    </form>
  );
}