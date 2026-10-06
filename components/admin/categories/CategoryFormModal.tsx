// components/admin/categories/CategoryFormModal.tsx
// 메인 카테고리 추가/수정 폼 (category 가 null 이면 추가, 있으면 수정)
"use client";

import { useEffect, useRef, useState } from "react";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  SharedSelection,
  Switch,
  Textarea,
} from "@heroui/react";
import { toast } from "react-toastify";

import {
  createCategory,
  updateCategory,
} from "@/serverActions/noteCategoryActions";
import { mediaUploader } from "@/lib/utils/mediaUpload";
import {
  CATEGORY_GRADIENTS,
  CATEGORY_LIMITS,
  CATEGORY_PLATFORMS,
  DEFAULT_GRADIENT_KEY,
  getGradientClasses,
  parseList,
} from "@/lib/note/categoryUtils";

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  platform: string | null;
  gradient: string | null;
  imageUrl: string | null;
  tags: string[];
  metaTitle: string | null;
  metaDescription: string | null;
  metaKeywords: string[];
  order: number;
  isPublished: boolean;
}

const NO_PLATFORM = "none";

const PLATFORM_ITEMS: { value: string; label: string }[] = [
  { value: NO_PLATFORM, label: "없음 (공통)" },
  ...CATEGORY_PLATFORMS,
];

export default function CategoryFormModal({
  isOpen,
  onOpenChange,
  category,
  onSaved,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategoryRow | null;
  onSaved: () => void;
}) {
  const isEdit = category !== null;
  const fileInput = useRef<HTMLInputElement>(null);

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📝");
  const [description, setDescription] = useState("");
  const [platform, setPlatform] = useState(NO_PLATFORM);
  const [gradient, setGradient] = useState(DEFAULT_GRADIENT_KEY);
  const [imageUrl, setImageUrl] = useState("");
  const [tags, setTags] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [metaKeywords, setMetaKeywords] = useState("");
  const [order, setOrder] = useState("");
  const [isPublished, setIsPublished] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 모달이 열릴 때마다 대상 카테고리 값으로 폼을 채운다
  useEffect(() => {
    if (!isOpen) return;

    setSlug(category?.slug ?? "");
    setName(category?.name ?? "");
    setIcon(category?.icon ?? "📝");
    setDescription(category?.description ?? "");
    setPlatform(category?.platform ?? NO_PLATFORM);
    setGradient(category?.gradient ?? DEFAULT_GRADIENT_KEY);
    setImageUrl(category?.imageUrl ?? "");
    setTags((category?.tags ?? []).join(", "));
    setMetaTitle(category?.metaTitle ?? "");
    setMetaDescription(category?.metaDescription ?? "");
    setMetaKeywords((category?.metaKeywords ?? []).join(", "));
    setOrder(category ? String(category.order) : "");
    setIsPublished(category?.isPublished ?? false);
  }, [isOpen, category]);

  const handlePlatformChange = (keys: SharedSelection) => {
    if (keys === "all") return;

    const value = Array.from(keys)[0];

    setPlatform(value ? String(value) : NO_PLATFORM);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    setIsUploading(true);

    try {
      const result = await mediaUploader.uploadImage(file);

      if (result.success && result.url) {
        setImageUrl(result.url);
        toast.success("이미지를 올렸습니다. 저장해야 반영됩니다.");
      } else {
        toast.error(
          result.error ?? "이미지 업로드에 실패했습니다. (5MB 이하 JPG/PNG/WebP/GIF)",
        );
      }
    } catch (error) {
      console.error("카테고리 이미지 업로드 실패:", error);
      toast.error("이미지 업로드 중 오류가 발생했습니다.");
    } finally {
      setIsUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const handleSave = async () => {
    if (isSaving) return;

    setIsSaving(true);

    try {
      const payload = {
        slug: slug.trim(),
        name,
        description,
        icon,
        platform: platform === NO_PLATFORM ? null : platform,
        gradient,
        imageUrl: imageUrl.trim() || null,
        tags: parseList(tags, CATEGORY_LIMITS.tags, CATEGORY_LIMITS.tag),
        metaTitle: metaTitle.trim() || null,
        metaDescription: metaDescription.trim() || null,
        metaKeywords: parseList(
          metaKeywords,
          CATEGORY_LIMITS.metaKeywords,
          CATEGORY_LIMITS.metaKeyword,
        ),
        order: order.trim() === "" ? undefined : Number(order),
        isPublished,
      };

      const result = isEdit
        ? await updateCategory(category.id, payload)
        : await createCategory(payload);

      if (!result.success) {
        toast.error(result.error ?? "저장에 실패했습니다.");

        return;
      }

      toast.success(isEdit ? "카테고리를 수정했습니다." : "카테고리를 추가했습니다.");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      console.error("카테고리 저장 실패:", error);
      toast.error("저장 중 오류가 발생했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      placement="center"
      scrollBehavior="inside"
      size="2xl"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader>
              {isEdit ? `카테고리 수정 · ${category.name}` : "메인 카테고리 추가"}
            </ModalHeader>

            <ModalBody className="gap-4">
              {/* 미리보기 */}
              <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt="카드 이미지 미리보기"
                    className="aspect-video w-full object-cover"
                    src={imageUrl}
                  />
                ) : (
                  <div
                    className={`flex aspect-video w-full items-center justify-center bg-gradient-to-br ${getGradientClasses(gradient)}`}
                  >
                    <span className="text-6xl">{icon || "📝"}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 p-3">
                  <span className="truncate font-semibold">
                    {icon} {name || "카테고리 이름"}
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <input
                      ref={fileInput}
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      type="file"
                      onChange={(e) => handleFile(e.target.files?.[0])}
                    />
                    <Button
                      isLoading={isUploading}
                      size="sm"
                      variant="flat"
                      onPress={() => fileInput.current?.click()}
                    >
                      {imageUrl ? "이미지 변경" : "이미지 올리기"}
                    </Button>
                    {imageUrl && (
                      <Button
                        color="danger"
                        size="sm"
                        variant="light"
                        onPress={() => setImageUrl("")}
                      >
                        이미지 제거
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <p className="-mt-2 text-xs text-gray-500">
                16:9 비율(예: 1200×675)에 5MB 이하 JPG/PNG/WebP를 권장합니다. 이미지를 제거하면 아이콘과 색상이 표시됩니다.
              </p>

              {/* 기본 정보 */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  description={
                    isEdit
                      ? "슬러그는 글 주소와 연결돼 있어 바꿀 수 없습니다"
                      : "주소에 쓰입니다. 영문 소문자/숫자/하이픈 (예: kotlin-compose)"
                  }
                  isDisabled={isEdit}
                  isRequired={!isEdit}
                  label="슬러그"
                  maxLength={CATEGORY_LIMITS.slug}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                />
                <Input
                  isRequired
                  label="이름"
                  maxLength={CATEGORY_LIMITS.name}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Input
                  description="이모지 1~2개"
                  isRequired
                  label="아이콘"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                />
                <Select
                  items={PLATFORM_ITEMS}
                  label="플랫폼"
                  selectedKeys={[platform]}
                  onSelectionChange={handlePlatformChange}
                >
                  {(item) => (
                    <SelectItem key={item.value}>{item.label}</SelectItem>
                  )}
                </Select>
              </div>

              <Textarea
                label="설명 (카드에 표시)"
                maxLength={CATEGORY_LIMITS.description}
                minRows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />

              {/* 색상 프리셋 */}
              <div>
                <p className="mb-2 text-sm font-medium">카드 색상</p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {CATEGORY_GRADIENTS.map((preset) => (
                    <button
                      key={preset.key}
                      aria-label={preset.label}
                      aria-pressed={gradient === preset.key}
                      className={`h-10 rounded-lg bg-gradient-to-r ${preset.classes} ${
                        gradient === preset.key
                          ? "ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-gray-900"
                          : ""
                      }`}
                      title={preset.label}
                      type="button"
                      onClick={() => setGradient(preset.key)}
                    />
                  ))}
                </div>
              </div>

              <Input
                description={`쉼표로 구분, 최대 ${CATEGORY_LIMITS.tags}개 (카드 아래 배지로 표시)`}
                label="태그"
                placeholder="Kotlin, Android, Compose"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />

              {/* SEO */}
              <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <p className="mb-3 text-sm font-medium">검색 노출(SEO) — 비워 두면 이름/설명을 사용합니다</p>
                <div className="flex flex-col gap-3">
                  <Input
                    label="SEO 제목"
                    maxLength={CATEGORY_LIMITS.metaTitle}
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value)}
                  />
                  <Textarea
                    label="SEO 설명"
                    maxLength={CATEGORY_LIMITS.metaDescription}
                    minRows={2}
                    value={metaDescription}
                    onChange={(e) => setMetaDescription(e.target.value)}
                  />
                  <Input
                    description="쉼표로 구분"
                    label="SEO 키워드"
                    value={metaKeywords}
                    onChange={(e) => setMetaKeywords(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-2">
                <Input
                  description="작을수록 먼저 표시 (비우면 맨 뒤)"
                  label="순서"
                  type="number"
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                />
                <Switch
                  color="success"
                  isSelected={isPublished}
                  onValueChange={setIsPublished}
                >
                  {isPublished ? "🟢 공개" : "🔴 비공개 (준비 중)"}
                </Switch>
              </div>
            </ModalBody>

            <ModalFooter>
              <Button variant="light" onPress={() => onOpenChange(false)}>
                취소
              </Button>
              <Button
                color="primary"
                isDisabled={isUploading}
                isLoading={isSaving}
                onPress={handleSave}
              >
                {isEdit ? "수정 저장" : "추가"}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}