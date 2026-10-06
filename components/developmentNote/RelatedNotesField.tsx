// components/developmentNote/RelatedNotesField.tsx
// 글쓰기 화면: 글 하단 "관련 글"로 보여줄 노트를 고른다. (최대 6개, 고른 순서대로 표시)
"use client";

import { Select, SelectItem, SharedSelection } from "@heroui/react";

import type { NoteLinkOption } from "@/serverActions/noteLinkActions";
import { MAX_RELATED_NOTES } from "@/lib/note/noteUtils";

export default function RelatedNotesField({
  options,
  value,
  currentNoteId,
  onChange,
}: {
  options: NoteLinkOption[];
  value: number[];
  currentNoteId?: number | null;
  onChange: (ids: number[]) => void;
}) {
  const selectable = options.filter((option) => option.noteId !== currentNoteId);

  const handleChange = (keys: SharedSelection) => {
    if (keys === "all") return;

    const picked = new Set(Array.from(keys).map((key) => Number(key)));

    // 이미 고른 순서는 유지하고, 새로 고른 것만 뒤에 붙인다
    const kept = value.filter((id) => picked.has(id));
    const added = Array.from(picked).filter((id) => !kept.includes(id));

    onChange([...kept, ...added].slice(0, MAX_RELATED_NOTES));
  };

  return (
    <Select
      className="w-full"
      description={`글 아래에 "함께 보면 좋은 글"로 표시됩니다 (최대 ${MAX_RELATED_NOTES}개)`}
      items={selectable}
      label="관련 글"
      placeholder="선택 안 함"
      selectedKeys={new Set(value.map(String))}
      selectionMode="multiple"
      onSelectionChange={handleChange}
    >
      {(option) => (
        <SelectItem
          key={String(option.noteId)}
          textValue={option.title}
        >
          <span className="block text-sm">{option.title}</span>
          <span className="text-xs text-gray-500">
            {option.mainCategory}
            {!option.isPublished && " · 비공개"}
          </span>
        </SelectItem>
      )}
    </Select>
  );
}