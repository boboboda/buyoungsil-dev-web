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
import type { Project, ProjectStatus, ProjectType } from "@/types";

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
    status: project?.status || ("in-progress" as ProjectStatus),
    progress: project?.progress || 0,
    type: project?.type || ("mobile" as ProjectType),
    databaseId: project?.databaseId || "",
    tags: project?.tags || []
  });

  const statusOptions = [
    { value: "released", label: "🟢 출시됨" },
    { value: "in-progress", label: "🟡 개발중" },
    { value: "backend", label: "⚙️ 백엔드" }
  ];

  const typeOptions = [
    { value: "mobile", label: "📱 모바일" },
    { value: "web", label: "🌐 웹" },
    { value: "backend", label: "⚙️ 백엔드" }
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
      .replace(/[^a-z0-9가-힣-]/g, '');
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
          placeholder="https://..."
          value={formData.coverImage}
          onValueChange={(value) => setFormData(prev => ({ ...prev, coverImage: value }))}
        />

        <Input
          label="앱 링크"
          placeholder="https://apps.apple.com/..."
          value={formData.appLink}
          onValueChange={(value) => setFormData(prev => ({ ...prev, appLink: value }))}
        />
      </div>

      {/* 프로젝트 상태 */}
      <div className="space-y-4 border-t pt-6">
        <h3 className="text-lg font-bold">상태 및 진행률</h3>

        <Select
          label="프로젝트 상태"
          placeholder="상태 선택"
          selectedKeys={[formData.status]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as ProjectStatus;
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

        <Select
          label="프로젝트 타입"
          placeholder="타입 선택"
          selectedKeys={[formData.type]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0] as ProjectType;
            setFormData(prev => ({ ...prev, type: value }));
          }}
          isRequired
        >
          {typeOptions.map((option) => (
            <SelectItem key={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </Select>

        <div>
          <label className="block text-sm font-medium mb-2">
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
      </div>

      {/* 태그 */}
      <div className="space-y-4 border-t pt-6">
        <h3 className="text-lg font-bold">태그</h3>
        
        <div className="flex gap-2">
          <Input
            placeholder="태그 이름"
            value={tagInput.name}
            onValueChange={(value) => setTagInput(prev => ({ ...prev, name: value }))}
          />
          <input
            type="color"
            value={tagInput.color}
            onChange={(e) => setTagInput(prev => ({ ...prev, color: e.target.value }))}
            className="w-16 h-10 rounded cursor-pointer"
          />
          <Button onPress={handleAddTag} color="primary">
            추가
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {formData.tags.map((tag) => (
            <Chip
              key={tag.id}
              onClose={() => handleRemoveTag(tag.id)}
              style={{ backgroundColor: tag.color }}
              className="text-white"
            >
              {tag.name}
            </Chip>
          ))}
        </div>
      </div>

      {/* Database ID (선택) */}
      <div className="border-t pt-6">
        <Input
          label="Database ID (선택)"
          placeholder="Notion Database ID"
          value={formData.databaseId}
          onValueChange={(value) => setFormData(prev => ({ ...prev, databaseId: value }))}
          description="Notion 등 외부 데이터베이스 연동 시 사용"
        />
      </div>

      {/* 제출 버튼 */}
      <div className="flex gap-4 pt-6">
        <Button
          type="submit"
          color="primary"
          size="lg"
          isLoading={loading}
          className="flex-1"
        >
          {project ? "수정하기" : "생성하기"}
        </Button>
        <Button
          type="button"
          variant="flat"
          size="lg"
          onPress={() => router.back()}
        >
          취소
        </Button>
      </div>
    </form>
  );
}