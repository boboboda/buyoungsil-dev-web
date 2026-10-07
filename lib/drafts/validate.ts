export const MAX_MARKDOWN_LENGTH = 200_000;

export type DraftInput = {
  title: string;
  markdown: string;
  recommendedTarget: "note" | "story" | null;
  recommendedSection: string | null;
  recommendedCategory: string | null;
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED";
  tags: string[];
  source: string | null;
};

const LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;

const LEVEL_ALIASES: Record<string, (typeof LEVELS)[number]> = {
  초급: "BEGINNER",
  중급: "INTERMEDIATE",
  고급: "ADVANCED",
};

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}

export function parseDraftInput(body: unknown): { ok: true; data: DraftInput } | { ok: false; message: string } {
  if (!body || typeof body !== "object") return { ok: false, message: "JSON 본문이 필요해요." };
  const b = body as Record<string, unknown>;

  const title = str(b.title, 200);
  const markdown = typeof b.markdown === "string" ? b.markdown.trim() : "";

  if (!title) return { ok: false, message: "title 이 필요해요." };
  if (!markdown) return { ok: false, message: "markdown 본문이 필요해요." };
  if (markdown.length > MAX_MARKDOWN_LENGTH) return { ok: false, message: "본문이 너무 길어요." };

  const rawLevel = str(b.level, 20);
  const level = rawLevel ? (LEVEL_ALIASES[rawLevel] ?? rawLevel.toUpperCase()) : "BEGINNER";
  if (!(LEVELS as readonly string[]).includes(level)) {
    return { ok: false, message: "level 은 BEGINNER / INTERMEDIATE / ADVANCED 중 하나여야 해요." };
  }

  const target = str(b.recommendedTarget, 10);
  const tags = Array.isArray(b.tags)
    ? Array.from(new Set(b.tags.map((t) => str(t, 40)).filter((t): t is string => !!t))).slice(0, 20)
    : [];

  return {
    ok: true,
    data: {
      title,
      markdown,
      recommendedTarget: target === "note" || target === "story" ? target : null,
      recommendedSection: str(b.recommendedSection, 100),
      recommendedCategory: str(b.recommendedCategory, 100),
      level: level as DraftInput["level"],
      tags,
      source: str(b.source, 200),
    },
  };
}
