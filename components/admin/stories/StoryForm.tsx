"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Input,
  Textarea,
  Select,
  SelectItem,
  Switch,
  Button,
  Chip
} from "@heroui/react";
import { toast } from "react-toastify";
import { createStory, updateStory } from "@/serverActions/stories";
import type { Story, StoryCategory } from "@/types";
import { generateTempSlug } from "@/lib/utils/slugify";  // ⭐ 추가

interface StoryFormProps {
  story?: Story;
}

export default function StoryForm({ story }: StoryFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const [formData, setFormData] = useState({
    slug: story?.slug || "",
    title: story?.title || "",
    content: story?.content || "",
    excerpt: story?.excerpt || "",
    category: story?.category || ("삽질기" as StoryCategory),
    tags: story?.tags || [],
    isPublished: story?.isPublished || false,
    metaTitle: story?.metaTitle || "",
    metaDescription: story?.metaDescription || ""
  });

  const categories = [
    { value: "삽질기", label: "😅 삽질기" },
    { value: "꿀팁", label: "💡 꿀팁" },
    { value: "일상", label: "☕ 일상" }
  ];

  const handleAddTag = () => {
    if (!tagInput.trim()) return;
    if (formData.tags.includes(tagInput.trim())) {
      toast.error("이미 추가된 태그입니다");
      return;
    }
    setFormData(prev => ({
      ...prev,
      tags: [...prev.tags, tagInput.trim()]
    }));
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(t => t !== tag)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title || !formData.content) {
      toast.error("제목과 내용은 필수입니다");
      return;
    }

    setLoading(true);

    try {
      if (story) {
        // 수정 시: slug 유지
        await updateStory(story.id, formData);
        toast.success("스토리가 수정되었습니다");
      } else {
        // ⭐ 생성 시: slug는 서버에서 생성
        // slug 필드를 제거하고 전송
        const { slug, ...dataWithoutSlug } = formData;
        await createStory(dataWithoutSlug);
        toast.success("스토리가 작성되었습니다");
      }
      router.push("/admin/stories");
      router.refresh();
    } catch (error) {
      toast.error("저장에 실패했습니다");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 제목 */}
      <Input
        label="제목"
        placeholder="스토리 제목을 입력하세요"
        value={formData.title}
        onValueChange={(value) => {
          setFormData(prev => ({
            ...prev,
            title: value,
            // ⭐ 실시간 미리보기용 (실제 slug는 서버에서 생성)
            slug: generateTempSlug(value)
          }));
        }}
        isRequired
      />

      {/* Slug 미리보기 (읽기 전용) */}
      <Input
        label="URL Slug (미리보기)"
        value={formData.slug}
        isReadOnly
        description={story 
          ? "수정 시에는 slug가 변경되지 않습니다" 
          : "저장 시 ID와 함께 생성됩니다 (예: 123-peuronteuendeu-gaebal)"
        }
        classNames={{
          input: "bg-gray-50 dark:bg-gray-800"
        }}
      />

      {/* 카테고리 */}
      <Select
        label="카테고리"
        placeholder="카테고리 선택"
        selectedKeys={[formData.category]}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as StoryCategory;
          setFormData(prev => ({ ...prev, category: value }));
        }}
        isRequired
      >
        {categories.map((cat) => (
          <SelectItem key={cat.value}>
            {cat.label}
          </SelectItem>
        ))}
      </Select>

      {/* 요약 */}
      <Textarea
        label="요약"
        placeholder="스토리 요약 (목록에 표시됨)"
        value={formData.excerpt}
        onValueChange={(value) => setFormData(prev => ({ ...prev, excerpt: value }))}
        minRows={2}
        maxRows={4}
      />

      {/* 내용 */}
      <Textarea
        label="내용"
        placeholder="스토리 내용을 HTML로 작성하세요"
        value={formData.content}
        onValueChange={(value) => setFormData(prev => ({ ...prev, content: value }))}
        minRows={10}
        isRequired
      />

      {/* 태그 */}
      <div>
        <label className="text-sm font-medium mb-2 block">태그</label>
        <div className="flex gap-2 mb-2">
          <Input
            placeholder="태그 입력 후 Enter"
            value={tagInput}
            onValueChange={setTagInput}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddTag();
              }
            }}
          />
          <Button onClick={handleAddTag} color="primary">
            추가
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {formData.tags.map((tag, index) => (
            <Chip
              key={index}
              onClose={() => handleRemoveTag(tag)}
              variant="flat"
            >
              {tag}
            </Chip>
          ))}
        </div>
      </div>

      {/* SEO */}
      <div className="space-y-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
        <h3 className="font-bold">SEO 설정 (선택사항)</h3>
        
        <Input
          label="Meta Title"
          placeholder="검색 결과에 표시될 제목"
          value={formData.metaTitle}
          onValueChange={(value) => setFormData(prev => ({ ...prev, metaTitle: value }))}
        />

        <Textarea
          label="Meta Description"
          placeholder="검색 결과에 표시될 설명"
          value={formData.metaDescription}
          onValueChange={(value) => setFormData(prev => ({ ...prev, metaDescription: value }))}
          minRows={2}
        />
      </div>

      {/* 공개 여부 */}
      <Switch
        isSelected={formData.isPublished}
        onValueChange={(checked) => setFormData(prev => ({ ...prev, isPublished: checked }))}
      >
        공개
      </Switch>

      {/* 버튼 */}
      <div className="flex gap-4">
        <Button
          type="submit"
          color="primary"
          size="lg"
          isLoading={loading}
          className="flex-1"
        >
          {story ? "수정하기" : "작성하기"}
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