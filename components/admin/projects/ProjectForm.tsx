"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Input,
  Textarea,
  Select,
  SelectItem,
  Chip,
  Button,
  Checkbox,
  CheckboxGroup
} from "@heroui/react";
import { toast } from "react-toastify";
import { createProject, updateProject } from "@/serverActions/projects";
import { TECH_STACK_OPTIONS } from "@/types";

export default function ProjectForm({ project }: { project?: any }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: project?.name || "",
    title: project?.title || "",
    description: project?.description || "",
    coverImage: project?.coverImage || "",
    appLink: project?.appLink || "",
    platform: project?.platform || "mobile",
    status: project?.status || "in-progress",
    progress: project?.progress || 0,
    techStack: project?.techStack || [],  // 🔥 기술 스택
    tags: project?.tags || [],             // SEO 태그
    databaseId: project?.databaseId || ""
  });

  const [tagInput, setTagInput] = useState({ name: "", color: "#3B82F6" });

  // SEO 태그 추가
  const handleAddTag = () => {
    if (!tagInput.name.trim()) return;
    
    const newTag = {
      id: Math.random().toString(36).substr(2, 9),
      name: tagInput.name,
      color: tagInput.color
    };
    
    setFormData(prev => ({
      ...prev,
      tags: [...prev.tags, newTag]
    }));
    
    setTagInput({ name: "", color: "#3B82F6" });
  };

  const handleRemoveTag = (id: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag.id !== id)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (project) {
        await updateProject(project.id, formData);
        toast.success("프로젝트가 수정되었습니다");
      } else {
        await createProject(formData);
        toast.success("프로젝트가 생성되었습니다");
      }
      
      router.push("/admin/projects");
      router.refresh();
    } catch (error) {
      toast.error(project ? "수정 실패" : "생성 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 기본 정보 */}
      <Input
        label="프로젝트 Name (URL용)"
        value={formData.name}
        onValueChange={(value) => setFormData(prev => ({ ...prev, name: value }))}
        isRequired
      />

      <Input
        label="프로젝트 제목"
        value={formData.title}
        onValueChange={(value) => setFormData(prev => ({ ...prev, title: value }))}
        isRequired
      />

      <Textarea
        label="설명"
        value={formData.description}
        onValueChange={(value) => setFormData(prev => ({ ...prev, description: value }))}
        minRows={5}
        isRequired
      />

      {/* 플랫폼 */}
      <Select
        label="플랫폼"
        selectedKeys={[formData.platform]}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as string;
          setFormData(prev => ({ ...prev, platform: value }));
        }}
        isRequired
      >
        <SelectItem key="mobile">📱 모바일</SelectItem>
        <SelectItem key="web">💻 웹</SelectItem>
        <SelectItem key="backend">⚙️ 백엔드</SelectItem>
      </Select>

      {/* 🔥 기술 스택 (노트 연결용) */}
      <div className="space-y-2">
        <label className="text-sm font-medium">🔧 기술 스택 (개발노트 연결용)</label>
        <CheckboxGroup
          value={formData.techStack}
          onValueChange={(value) => setFormData(prev => ({ ...prev, techStack: value }))}
          className="gap-2"
        >
          {TECH_STACK_OPTIONS.map((option) => (
            <Checkbox key={option.value} value={option.value}>
              {option.label}
            </Checkbox>
          ))}
        </CheckboxGroup>
        
        {formData.techStack.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {formData.techStack.map((tech) => {
              const option = TECH_STACK_OPTIONS.find(o => o.value === tech);
              return (
                <Chip key={tech} color="primary" variant="flat">
                  {option?.label}
                </Chip>
              );
            })}
          </div>
        )}
        
        <p className="text-xs text-gray-500">
          💡 선택한 기술 스택과 관련된 개발노트만 프로젝트 로그에서 연결할 수 있습니다
        </p>
      </div>

      {/* SEO 태그 (자유 입력) */}
      <div className="space-y-4">
        <label className="text-sm font-medium">🏷️ SEO 태그 (자유 입력)</label>
        
        <div className="flex gap-2">
          <Input
            placeholder="태그 이름 (예: Google Play, 습관관리)"
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
        
        <p className="text-xs text-gray-500">
          💡 SEO용 태그는 개발노트 연결과 무관합니다
        </p>
      </div>

      {/* 상태 */}
      <Select
        label="상태"
        selectedKeys={[formData.status]}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as string;
          setFormData(prev => ({ ...prev, status: value }));
        }}
      >
        <SelectItem key="released">🚀 출시됨</SelectItem>
        <SelectItem key="in-progress">🔨 개발중</SelectItem>
        <SelectItem key="backend">⚙️ 백엔드</SelectItem>
      </Select>

      {/* 진행률 */}
      {formData.status === "in-progress" && (
        <Input
          type="number"
          label="진행률 (%)"
          value={String(formData.progress)}
          onValueChange={(value) => setFormData(prev => ({ ...prev, progress: Number(value) }))}
          min="0"
          max="100"
        />
      )}

      {/* 커버 이미지, 앱 링크 */}
      <Input
        label="커버 이미지 URL"
        value={formData.coverImage}
        onValueChange={(value) => setFormData(prev => ({ ...prev, coverImage: value }))}
      />

      <Input
        label="앱/웹 링크"
        value={formData.appLink}
        onValueChange={(value) => setFormData(prev => ({ ...prev, appLink: value }))}
      />

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