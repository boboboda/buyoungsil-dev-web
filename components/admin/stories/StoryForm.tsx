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
    category: story?.category || ("삽질기" as StoryCategory), // 🔥 타입 캐스팅
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

  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9가-힣-]/g, '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.title || !formData.content) {
      toast.error("제목과 내용은 필수입니다");
      return;
    }

    if (!formData.slug) {
      setFormData(prev => ({
        ...prev,
        slug: generateSlug(prev.title)
      }));
    }

    setLoading(true);

    try {
      if (story) {
        await updateStory(story.id, formData);
        toast.success("스토리가 수정되었습니다");
      } else {
        await createStory({
          ...formData,
          slug: formData.slug || generateSlug(formData.title)
        });
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
            slug: generateSlug(value)
          }));
        }}
        isRequired
      />

      {/* Slug */}
      <Input
        label="URL Slug"
        placeholder="my-story-title"
        value={formData.slug}
        onValueChange={(value) => setFormData(prev => ({ ...prev, slug: value }))}
        description="URL에 사용될 고유 식별자 (자동 생성됨)"
      />

      {/* 카테고리 🔥 수정 */}
      <Select
        label="카테고리"
        placeholder="카테고리 선택"
        selectedKeys={[formData.category]}
        onSelectionChange={(keys) => {
          const value = Array.from(keys)[0] as StoryCategory; // 🔥 타입 캐스팅
          setFormData(prev => ({ ...prev, category: value }));
        }}
        isRequired
      >
        {categories.map((cat) => (
          <SelectItem key={cat.value}> {/* 🔥 value 제거 */}
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
        description="HTML 태그를 사용할 수 있습니다"
      />

      {/* 태그 */}
      <div>
        <label className="block text-sm font-medium mb-2">태그</label>
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
          <Button onPress={handleAddTag} color="primary">
            추가
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {formData.tags.map((tag) => (
            <Chip
              key={tag}
              onClose={() => handleRemoveTag(tag)}
              variant="flat"
            >
              #{tag}
            </Chip>
          ))}
        </div>
      </div>

      {/* SEO 메타데이터 */}
      <div className="border-t pt-6">
        <h3 className="text-lg font-bold mb-4">SEO 설정</h3>
        
        <div className="space-y-4">
          <Input
            label="메타 제목"
            placeholder="SEO용 제목 (비워두면 기본 제목 사용)"
            value={formData.metaTitle}
            onValueChange={(value) => setFormData(prev => ({ ...prev, metaTitle: value }))}
          />

          <Textarea
            label="메타 설명"
            placeholder="SEO용 설명"
            value={formData.metaDescription}
            onValueChange={(value) => setFormData(prev => ({ ...prev, metaDescription: value }))}
            minRows={2}
          />
        </div>
      </div>

      {/* 공개 여부 */}
      <Switch
        isSelected={formData.isPublished}
        onValueChange={(checked) => setFormData(prev => ({ ...prev, isPublished: checked }))}
      >
        {formData.isPublished ? "🟢 공개" : "🔴 비공개"}
      </Switch>

      {/* 제출 버튼 */}
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
          onPress={() => router.back()}
        >
          취소
        </Button>
      </div>
    </form>
  );
}