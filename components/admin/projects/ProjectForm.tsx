"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Input,
  Textarea,
  Select,
  SelectItem,
  Slider,
  Button,
  Chip
} from "@heroui/react";
import { toast } from "react-toastify";
import { createProject, updateProject } from "@/serverActions/projects";

interface ProjectTag {
  id: string;
  name: string;
  color: string;
}

interface Project {
  id: string;
  name: string;
  title: string;
  description: string;
  coverImage?: string | null;
  appLink?: string | null;
  platform: string;
  status: string;
  progress: number;
  databaseId?: string | null;
  tags: ProjectTag[];
}

interface ProjectFormProps {
  project?: Project;
}

export default function ProjectForm({ project }: ProjectFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [tagInput, setTagInput] = useState({ name: "", color: "#3B82F6" });

  const [formData, setFormData] = useState({
    name: project?.name || "",
    title: project?.title || "",
    description: project?.description || "",
    coverImage: project?.coverImage || "",
    appLink: project?.appLink || "",
    platform: project?.platform || "mobile",
    status: project?.status || "in-progress",
    progress: project?.progress || 0,
    databaseId: project?.databaseId || "",
    tags: project?.tags || []
  });

  const platformOptions = [
    { value: "mobile", label: "📱 모바일" },
    { value: "web", label: "🌐 웹" },
    { value: "backend", label: "⚙️ 백엔드" }
  ];

  const statusOptions = [
    { value: "released", label: "🟢 출시됨" },
    { value: "in-progress", label: "🟡 개발중" },
  ];

  const handleAddTag = () => {
    if (!tagInput.name.trim()) {
      toast.error("태그 이름을 입력하세요");
      return;
    }

    setFormData(prev => ({
      ...prev,
      tags: [...prev.tags, {
        id: `temp-${Date.now()}`,
        name: tagInput.name,
        color: tagInput.color
      }]
    }));
    setTagInput({ name: "", color: "#3B82F6" });
  };

  const handleRemoveTag = (id: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t.id !== id)
    }));
  };

  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title || !formData.description) {
      toast.error("제목과 설명은 필수입니다");
      return;
    }

    setLoading(true);

    try {
      const projectData = {
        ...formData,
        name: formData.name || generateSlug(formData.title),
        tags: formData.tags.map(tag => ({
          name: tag.name,
          color: tag.color
        }))
      };

      if (project) {
        await updateProject(project.id, projectData);
        toast.success("프로젝트가 수정되었습니다");
      } else {
        await createProject(projectData);
        toast.success("프로젝트가 생성되었습니다");
      }
      
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
      {/* 프로젝트 기본 정보 */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold">기본 정보</h3>
        
        <Input
          label="프로젝트 제목"
          placeholder="예: 로또번호 추천 앱"
          value={formData.title}
          onValueChange={(value) => {
            setFormData(prev => ({
              ...prev,
              title: value,
              name: generateSlug(value)
            }));
          }}
          isRequired
        />

        <Input
          label="URL Slug"
          placeholder="lotto-recommendation-app"
          value={formData.name}
          onValueChange={(value) => setFormData(prev => ({ ...prev, name: value }))}
          description="URL에 사용될 고유 식별자 (자동 생성)"
        />

        <Textarea
          label="프로젝트 설명"
          placeholder="프로젝트에 대한 설명을 입력하세요"
          value={formData.description}
          onValueChange={(value) => setFormData(prev => ({ ...prev, description: value }))}
          minRows={3}
          isRequired
        />

        <Input
          label="커버 이미지 URL"
          placeholder="https://example.com/image.jpg"
          value={formData.coverImage || ""}
          onValueChange={(value) => setFormData(prev => ({ ...prev, coverImage: value }))}
        />

        <Input
          label="앱/웹사이트 링크"
          placeholder="https://..."
          value={formData.appLink || ""}
          onValueChange={(value) => setFormData(prev => ({ ...prev, appLink: value }))}
        />
      </div>

      {/* 플랫폼 & 상태 */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold">분류</h3>

        <Select
          label="플랫폼"
          placeholder="플랫폼 선택"
          selectedKeys={[formData.platform]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as string;
            setFormData(prev => ({ ...prev, platform: value }));
          }}
          isRequired
        >
          {platformOptions.map((option) => (
            <SelectItem key={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </Select>

        <Select
          label="상태"
          placeholder="프로젝트 상태"
          selectedKeys={[formData.status]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as string;
            setFormData(prev => ({ ...prev, status: value }));
          }}
          isRequired
        >
          {statusOptions.map((option) => (
            <SelectItem key={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </Select>

        {formData.status === "in-progress" && (
          <div>
            <label className="text-sm font-medium mb-2 block">
              진행률: {formData.progress}%
            </label>
            <Slider
              value={formData.progress}
              onChange={(value) => setFormData(prev => ({ ...prev, progress: value as number }))}
              minValue={0}
              maxValue={100}
              step={5}
              color="primary"
            />
          </div>
        )}
      </div>

      {/* 태그 */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold">기술 스택 태그</h3>
        
        <div className="flex gap-2">
          <Input
            placeholder="태그 이름 (예: Flutter)"
            value={tagInput.name}
            onValueChange={(value) => setTagInput(prev => ({ ...prev, name: value }))}
            className="flex-1"
          />
          <Input
            type="color"
            value={tagInput.color}
            onValueChange={(value) => setTagInput(prev => ({ ...prev, color: value }))}
            className="w-20"
          />
          <Button
            type="button"
            onClick={handleAddTag}
            color="primary"
            variant="flat"
          >
            추가
          </Button>
        </div>

        {formData.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {formData.tags.map((tag) => (
              <Chip
                key={tag.id}
                onClose={() => handleRemoveTag(tag.id)}
                style={{ backgroundColor: tag.color + "20", color: tag.color }}
              >
                {tag.name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {/* 기타 */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold">기타</h3>
        
        <Input
          label="Database ID (선택사항)"
          placeholder="기존 Post/Notice ID"
          value={formData.databaseId || ""}
          onValueChange={(value) => setFormData(prev => ({ ...prev, databaseId: value }))}
          description="기존 MongoDB Post/Notice와 연결할 경우"
        />
      </div>

      {/* 제출 버튼 */}
      <Button
        type="submit"
        color="primary"
        size="lg"
        isLoading={loading}
        className="w-full"
      >
        {project ? "수정" : "생성"}
      </Button>
    </form>
  );
}