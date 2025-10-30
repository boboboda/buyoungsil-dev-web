"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { 
  Input, 
  Textarea, 
  Select, 
  SelectItem, 
  Button, 
  Checkbox,
  CheckboxGroup,
  Chip 
} from "@heroui/react";
import { toast } from "react-toastify";
import { createProject, updateProject } from "@/serverActions/projects";
import { generateTempSlug } from "@/lib/utils/slugify";
import type { Project, ProjectTag } from "@/types";

// 🔥 타입 정의 추가
type ProjectStatus = "released" | "in-progress" | "backend";
type ProjectPlatform = "mobile" | "web" | "backend";

// 기술 스택 옵션 (개발노트 카테고리와 매핑)
const TECH_STACK_OPTIONS = [
  { value: "kotlin-compose", label: "🤖 Kotlin + Compose" },
  { value: "swift-swiftui", label: "🍎 Swift + SwiftUI" },
  { value: "flutter", label: "🦋 Flutter" },
  { value: "nextjs-heroui", label: "▲ Next.js + HeroUI" },
  { value: "react", label: "⚛️ React" },
  { value: "nestjs-typescript", label: "🐈 NestJS + TypeScript" },
  { value: "nodejs", label: "💚 Node.js" },
  { value: "python-crawling", label: "🐍 Python 크롤링" },
];

interface ProjectFormProps {
  project?: Project;
}

export default function ProjectForm({ project }: ProjectFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [tagInput, setTagInput] = useState({ name: "", color: "#3b82f6" });

  const [formData, setFormData] = useState({
    name: project?.name || "",
    title: project?.title || "",
    description: project?.description || "",
    coverImage: project?.coverImage || "",
    appLink: project?.appLink || "",
    platform: (project?.platform || "mobile") as ProjectPlatform,  // 🔥 타입 캐스팅
    status: (project?.status || "in-progress") as ProjectStatus,    // 🔥 타입 캐스팅
    progress: project?.progress || 0,
    techStack: project?.techStack || [],
    tags: project?.tags || [],
    databaseId: project?.databaseId || ""
  });

  const handleAddTag = () => {
    if (!tagInput.name.trim()) {
      toast.error("태그 이름을 입력하세요");
      return;
    }

    if (formData.tags.some(t => t.name === tagInput.name.trim())) {
      toast.error("이미 추가된 태그입니다");
      return;
    }

    setFormData(prev => ({
      ...prev,
      tags: [...prev.tags, { 
        id: Date.now().toString(), 
        name: tagInput.name.trim(), 
        color: tagInput.color 
      }]
    }));

    setTagInput({ name: "", color: "#3b82f6" });
  };

  const handleRemoveTag = (tagId: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t.id !== tagId)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title || !formData.description) {
      toast.error("필수 항목을 입력하세요");
      return;
    }

    setLoading(true);

    try {
      if (project) {
        // 수정 시: name 유지
        await updateProject(project.id, formData);
        toast.success("프로젝트가 수정되었습니다");
      } else {
        // 생성 시: name은 서버에서 생성 (slug 제외)
        const { name, ...dataWithoutName } = formData;
        await createProject(dataWithoutName);
        toast.success("프로젝트가 생성되었습니다");
      }
      
      router.push("/admin/projects");
      router.refresh();
    } catch (error) {
      console.error("프로젝트 저장 실패:", error);
      toast.error(project ? "수정 실패" : "생성 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 프로젝트 Name (읽기 전용) */}
      <Input
        label="프로젝트 Name (URL용)"
        value={formData.name}
        isReadOnly
        description={project 
          ? "수정 시에는 name이 변경되지 않습니다" 
          : "저장 시 ID와 함께 자동 생성됩니다 (예: abc123-nalsseu-aep)"
        }
        classNames={{
          input: "bg-gray-50 dark:bg-gray-800"
        }}
      />

      {/* 프로젝트 제목 */}
      <Input
        label="프로젝트 제목"
        placeholder="프로젝트 이름을 입력하세요"
        value={formData.title}
        onValueChange={(value) => {
          setFormData(prev => ({
            ...prev,
            title: value,
            name: generateTempSlug(value)
          }));
        }}
        isRequired
      />

      {/* 설명 */}
      <Textarea
        label="설명"
        placeholder="프로젝트에 대한 설명을 입력하세요"
        value={formData.description}
        onValueChange={(value) => setFormData(prev => ({ ...prev, description: value }))}
        minRows={5}
        isRequired
      />

      {/* 플랫폼 */}
      <Select
        label="플랫폼"
        placeholder="플랫폼 선택"
        selectedKeys={[formData.platform]}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as ProjectPlatform;  // 🔥 타입 캐스팅
          setFormData(prev => ({ ...prev, platform: value }));
        }}
        isRequired
      >
        <SelectItem key="mobile">📱 모바일</SelectItem>
        <SelectItem key="web">💻 웹</SelectItem>
        <SelectItem key="backend">⚙️ 백엔드</SelectItem>
      </Select>

      {/* 상태 */}
      <Select
        label="상태"
        placeholder="상태 선택"
        selectedKeys={[formData.status]}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as ProjectStatus;  // 🔥 타입 캐스팅
          setFormData(prev => ({ ...prev, status: value }));
        }}
        isRequired
      >
        <SelectItem key="released">🚀 출시됨</SelectItem>
        <SelectItem key="in-progress">🔨 개발 중</SelectItem>
        <SelectItem key="backend">⚙️ 백엔드 개발</SelectItem>
      </Select>

      {/* 진행률 */}
      {formData.status === "in-progress" && (
        <Input
          type="number"
          label="진행률 (%)"
          placeholder="0-100"
          value={formData.progress.toString()}
          onValueChange={(value) => {
            const num = parseInt(value) || 0;
            setFormData(prev => ({ 
              ...prev, 
              progress: Math.min(Math.max(num, 0), 100) 
            }));
          }}
          min="0"
          max="100"
        />
      )}

      {/* 기술 스택 */}
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

      {/* SEO 태그 */}
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
          >
            추가
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {formData.tags.map((tag) => (
            <Chip
              key={tag.id}
              onClose={() => handleRemoveTag(tag.id)}
              style={{
                backgroundColor: `${tag.color}20`,
                color: tag.color,
                borderColor: tag.color
              }}
            >
              {tag.name}
            </Chip>
          ))}
        </div>
      </div>

      {/* 커버 이미지 */}
      <Input
        label="커버 이미지 URL"
        placeholder="https://..."
        value={formData.coverImage}
        onValueChange={(value) => setFormData(prev => ({ ...prev, coverImage: value }))}
      />

      {/* 앱 링크 */}
      <Input
        label="앱 링크"
        placeholder="https://..."
        value={formData.appLink}
        onValueChange={(value) => setFormData(prev => ({ ...prev, appLink: value }))}
      />

      {/* Database ID */}
      <Input
        label="Database ID (선택사항)"
        placeholder="Notion 등 외부 DB ID"
        value={formData.databaseId}
        onValueChange={(value) => setFormData(prev => ({ ...prev, databaseId: value }))}
      />

      {/* 버튼 */}
      <div className="flex gap-4">
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
          onClick={() => router.back()}
        >
          취소
        </Button>
      </div>
    </form>
  );
}