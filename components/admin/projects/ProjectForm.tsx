"use client";

import { useRef, useState } from "react";
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
import { mediaUploader } from "@/lib/utils/mediaUpload";
import { buildPrivacyTemplate, hasUnfilledPlaceholder } from "@/lib/privacy/template";
import PrivacyPolicyView from "@/components/project/PrivacyPolicyView";
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
  const [isUploading, setIsUploading] = useState(false);
  const coverFileInput = useRef<HTMLInputElement>(null);

  // 🔒 개인정보처리방침 템플릿 옵션 / 미리보기
  const [templateOptions, setTemplateOptions] = useState({
    contactEmail: "",
    usesAds: false,
    usesAnalytics: false,
  });
  const [showPrivacyPreview, setShowPrivacyPreview] = useState(false);

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
    databaseId: project?.databaseId || "",
    privacyPolicy: project?.privacyPolicy || ""
  });

  const handleCoverFile = async (file: File | undefined) => {
    if (!file) return;

    setIsUploading(true);

    try {
      const result = await mediaUploader.uploadImage(file);

      if (result.success && result.url) {
        setFormData(prev => ({ ...prev, coverImage: result.url as string }));
        toast.success("이미지를 올렸습니다. 저장해야 반영됩니다");
      } else {
        toast.error(
          result.error ?? "이미지 업로드에 실패했습니다 (5MB 이하 JPG/PNG/WebP/GIF)"
        );
      }
    } catch (error) {
      console.error("프로젝트 커버 이미지 업로드 실패:", error);
      toast.error("이미지 업로드 중 오류가 발생했습니다");
    } finally {
      setIsUploading(false);
      if (coverFileInput.current) coverFileInput.current.value = "";
    }
  };

  const handleLoadPrivacyTemplate = () => {
    if (!formData.title.trim()) {
      toast.error("프로젝트 제목을 먼저 입력하세요");
      return;
    }

    if (
      formData.privacyPolicy.trim() &&
      !window.confirm("입력된 처리방침이 템플릿으로 덮어써집니다. 계속할까요?")
    ) {
      return;
    }

    setFormData(prev => ({
      ...prev,
      privacyPolicy: buildPrivacyTemplate({
        title: prev.title,
        ...templateOptions,
      })
    }));
    toast.info("템플릿을 불러왔습니다. [[ ]] 표시된 부분을 채워 주세요");
  };

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

    // 🔒 템플릿의 [[ ]] 자리표시자가 남은 채로 공개되는 것을 방지
    if (hasUnfilledPlaceholder(formData.privacyPolicy)) {
      toast.error("개인정보처리방침에 [[ ]] 로 표시된 빈칸이 남아 있습니다");
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
          const value = Array.from(keys)[0] as ProjectPlatform | undefined;
          if (!value) return;
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
      <div className="space-y-3">
        <label className="text-sm font-medium">🖼️ 커버 이미지</label>

        {formData.coverImage && (
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="커버 이미지 미리보기"
              className="aspect-video w-full bg-gray-50 object-contain p-3 dark:bg-gray-800"
              src={formData.coverImage}
            />
          </div>
        )}

        <div className="flex gap-2">
          <input
            ref={coverFileInput}
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            type="file"
            onChange={(e) => handleCoverFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            size="sm"
            variant="flat"
            color="primary"
            isLoading={isUploading}
            onPress={() => coverFileInput.current?.click()}
          >
            {formData.coverImage ? "이미지 변경" : "이미지 올리기"}
          </Button>
          {formData.coverImage && (
            <Button
              type="button"
              size="sm"
              variant="light"
              color="danger"
              onPress={() => setFormData(prev => ({ ...prev, coverImage: "" }))}
            >
              이미지 제거
            </Button>
          )}
        </div>

        <Input
          label="커버 이미지 URL"
          placeholder="https://... (직접 입력하거나 위에서 올리면 자동으로 채워져요)"
          value={formData.coverImage}
          onValueChange={(value) => setFormData(prev => ({ ...prev, coverImage: value }))}
          description="16:9 비율(예: 1200×675), 5MB 이하 JPG/PNG/WebP/GIF"
        />
      </div>

      {/* 앱 링크 */}
      <Input
        label="앱 링크"
        placeholder="https://..."
        value={formData.appLink}
        onValueChange={(value) => setFormData(prev => ({ ...prev, appLink: value }))}
      />

      {/* 🔒 개인정보처리방침 */}
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">🔒 개인정보처리방침 (마크다운)</label>
          <p className="text-xs text-gray-500 mt-1">
            비워 두면 상세 페이지의 "개인정보처리방침" 탭이 표시되지 않습니다.
            저장하면 <code>/project/{formData.name || "[name]"}/privacy</code> 주소로도 공개되며,
            스토어 등록 시 이 주소를 입력하세요.
          </p>
        </div>

        <div className="flex flex-col gap-3 p-4 rounded-lg bg-gray-50 dark:bg-gray-800">
          <Input
            size="sm"
            type="email"
            label="문의 이메일 (템플릿용)"
            placeholder="블로그용 별도 메일 권장"
            value={templateOptions.contactEmail}
            onValueChange={(value) =>
              setTemplateOptions(prev => ({ ...prev, contactEmail: value }))
            }
          />
          <div className="flex flex-wrap gap-4">
            <Checkbox
              size="sm"
              isSelected={templateOptions.usesAds}
              onValueChange={(v) => setTemplateOptions(prev => ({ ...prev, usesAds: v }))}
            >
              광고 SDK 사용 (AdMob 등)
            </Checkbox>
            <Checkbox
              size="sm"
              isSelected={templateOptions.usesAnalytics}
              onValueChange={(v) => setTemplateOptions(prev => ({ ...prev, usesAnalytics: v }))}
            >
              분석·오류 수집 사용 (Firebase 등)
            </Checkbox>
          </div>
          <Button
            type="button"
            size="sm"
            variant="flat"
            color="primary"
            onClick={handleLoadPrivacyTemplate}
            className="self-start"
          >
            기본 템플릿 불러오기
          </Button>
        </div>

        <Textarea
          placeholder="# 앱 이름 개인정보처리방침 ..."
          value={formData.privacyPolicy}
          onValueChange={(value) => setFormData(prev => ({ ...prev, privacyPolicy: value }))}
          minRows={12}
          maxRows={40}
          classNames={{ input: "font-mono text-sm" }}
        />

        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">
            {project?.privacyUpdatedAt
              ? `현재 시행일: ${project.privacyUpdatedAt} (내용을 수정해 저장하면 오늘 날짜로 갱신됩니다)`
              : "저장하는 날짜가 시행일로 기록됩니다"}
          </p>
          <Button
            type="button"
            size="sm"
            variant="light"
            isDisabled={!formData.privacyPolicy.trim()}
            onClick={() => setShowPrivacyPreview(prev => !prev)}
          >
            {showPrivacyPreview ? "미리보기 닫기" : "미리보기"}
          </Button>
        </div>

        {showPrivacyPreview && formData.privacyPolicy.trim() && (
          <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
            <PrivacyPolicyView policy={formData.privacyPolicy} />
          </div>
        )}
      </div>

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