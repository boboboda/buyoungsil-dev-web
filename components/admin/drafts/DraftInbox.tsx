"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, Input, Select, SelectItem, Textarea } from "@heroui/react";
import { toast } from "react-toastify";

export interface DraftItem {
  id: string;
  title: string;
  markdown: string;
  recommendedTarget: string | null;
  recommendedSection: string | null;
  recommendedCategory: string | null;
  level: string;
  tags: string[];
  source: string | null;
  createdAt: string;
}

interface Props {
  drafts: DraftItem[];
  categories: { slug: string; name: string }[];
  subCategories: { mainCategory: string; name: string }[];
}

const LEVELS = [
  { value: "BEGINNER", label: "🟢 초급" },
  { value: "INTERMEDIATE", label: "🟡 중급" },
  { value: "ADVANCED", label: "🔴 고급" },
];

const STORY_CATEGORIES = [
  { value: "삽질기", label: "😅 삽질기" },
  { value: "꿀팁", label: "💡 꿀팁" },
  { value: "일상", label: "☕ 일상" },
];

export default function DraftInbox({ drafts, categories, subCategories }: Props) {
  const [items, setItems] = useState(drafts);
  const [selectedId, setSelectedId] = useState<string | null>(drafts[0]?.id ?? null);

  const selected = items.find((d) => d.id === selectedId) ?? null;

  const removeItem = (id: string) => {
    setItems((prev) => {
      const next = prev.filter((d) => d.id !== id);
      setSelectedId(next[0]?.id ?? null);
      return next;
    });
  };

  if (items.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 p-12 text-center text-gray-500">
        대기 중인 초안이 없어요.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <ul className="space-y-2">
        {items.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => setSelectedId(d.id)}
              className={`w-full text-left rounded-lg border-2 p-4 transition-colors ${
                d.id === selectedId
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-400"
              }`}
            >
              <p className="font-semibold line-clamp-2">{d.title}</p>
              <p className="text-xs text-gray-500 mt-1">
                {new Date(d.createdAt).toLocaleString("ko-KR")}
                {d.source ? ` · ${d.source}` : ""}
              </p>
            </button>
          </li>
        ))}
      </ul>

      {selected && (
        <DraftEditor
          key={selected.id}
          draft={selected}
          categories={categories}
          subCategories={subCategories}
          onDone={() => removeItem(selected.id)}
        />
      )}
    </div>
  );
}

function DraftEditor({
  draft,
  categories,
  subCategories,
  onDone,
}: {
  draft: DraftItem;
  categories: Props["categories"];
  subCategories: Props["subCategories"];
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const [target, setTarget] = useState<"note" | "story">(
    draft.recommendedTarget === "story" ? "story" : "note",
  );
  const [title, setTitle] = useState(draft.title);
  const [markdown, setMarkdown] = useState(draft.markdown);
  const [level, setLevel] = useState(draft.level);

  // 스킬이 추천한 섹션/카테고리는 실제 목록에 있을 때만 미리 선택해 둔다 (이름 또는 슬러그 모두 허용)
  const presetSection =
    categories.find(
      (c) => c.slug === draft.recommendedSection || c.name === draft.recommendedSection,
    )?.slug ?? "";
  const [mainCategory, setMainCategory] = useState(presetSection);
  const subOptions = useMemo(
    () => subCategories.filter((s) => s.mainCategory === mainCategory),
    [subCategories, mainCategory],
  );
  const [subCategory, setSubCategory] = useState(
    subCategories.find((s) => s.mainCategory === presetSection && s.name === draft.recommendedCategory)?.name ?? "",
  );
  const [storyCategory, setStoryCategory] = useState(
    STORY_CATEGORIES.find((c) => c.value === draft.recommendedCategory)?.value ?? "",
  );

  const call = async (payload: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/drafts/${draft.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "요청에 실패했어요.");
    return data;
  };

  const handleSend = async () => {
    if (target === "note" && !mainCategory) return toast.error("섹션을 골라주세요");
    if (target === "story" && !storyCategory) return toast.error("스토리 분류를 골라주세요");

    setBusy(true);
    try {
      const data = await call({
        action: "send",
        target,
        title,
        markdown,
        level,
        tags: draft.tags,
        mainCategory,
        subCategory: subCategory || null,
        storyCategory,
      });
      toast.success("비공개 글로 저장했어요. 에디터에서 다듬어 주세요");
      onDone();
      router.push(data.editUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "보내기에 실패했어요");
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    if (!confirm("이 초안을 버릴까요?")) return;
    setBusy(true);
    try {
      await call({ action: "discard" });
      toast.success("초안을 버렸어요");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "버리기에 실패했어요");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 p-6">
      <Input label="제목" value={title} onValueChange={setTitle} />

      <div className="flex flex-wrap gap-2">
        {draft.tags.map((t) => (
          <Chip key={t} size="sm" variant="flat">
            #{t}
          </Chip>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="보낼 곳"
          selectedKeys={[target]}
          disallowEmptySelection
          onSelectionChange={(keys) => setTarget(Array.from(keys)[0] as "note" | "story")}
        >
          <SelectItem key="note">📚 개발노트</SelectItem>
          <SelectItem key="story">😅 스토리</SelectItem>
        </Select>

        {target === "note" ? (
          <Select
            label="난이도"
            selectedKeys={[level]}
            disallowEmptySelection
            onSelectionChange={(keys) => setLevel(Array.from(keys)[0] as string)}
          >
            {LEVELS.map((l) => (
              <SelectItem key={l.value}>{l.label}</SelectItem>
            ))}
          </Select>
        ) : (
          <Select
            label="스토리 분류"
            selectedKeys={storyCategory ? [storyCategory] : []}
            onSelectionChange={(keys) => setStoryCategory((Array.from(keys)[0] as string) ?? "")}
          >
            {STORY_CATEGORIES.map((c) => (
              <SelectItem key={c.value}>{c.label}</SelectItem>
            ))}
          </Select>
        )}

        {target === "note" && (
          <>
            <Select
              label="섹션"
              description={
                draft.recommendedSection && !presetSection
                  ? `추천: ${draft.recommendedSection} (목록에 없어요)`
                  : undefined
              }
              selectedKeys={mainCategory ? [mainCategory] : []}
              onSelectionChange={(keys) => {
                setMainCategory((Array.from(keys)[0] as string) ?? "");
                setSubCategory("");
              }}
            >
              {categories.map((c) => (
                <SelectItem key={c.slug}>{c.name}</SelectItem>
              ))}
            </Select>

            <Select
              label="세부 카테고리 (선택)"
              description={
                draft.recommendedCategory && !subCategory
                  ? `추천: ${draft.recommendedCategory}`
                  : undefined
              }
              isDisabled={subOptions.length === 0}
              selectedKeys={subCategory ? [subCategory] : []}
              onSelectionChange={(keys) => setSubCategory((Array.from(keys)[0] as string) ?? "")}
            >
              {subOptions.map((s) => (
                <SelectItem key={s.name}>{s.name}</SelectItem>
              ))}
            </Select>
          </>
        )}
      </div>

      <Textarea
        label="본문 (마크다운)"
        minRows={14}
        maxRows={30}
        value={markdown}
        onValueChange={setMarkdown}
      />

      <div className="flex justify-end gap-3">
        <Button color="danger" variant="flat" isDisabled={busy} onPress={handleDiscard}>
          🗑 버리기
        </Button>
        <Button color="primary" isLoading={busy} onPress={handleSend}>
          ✉️ 보내기 (비공개로 저장)
        </Button>
      </div>
    </div>
  );
}
