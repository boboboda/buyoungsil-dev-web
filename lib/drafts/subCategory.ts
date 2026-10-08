// 세부 카테고리 이름 처리 (MCP 도구와 초안함 "보내기"가 같이 쓴다)
import type { Prisma, PrismaClient } from "@prisma/client";

export const MAX_SUB_NAME = 30; // 세부 카테고리 이름 길이 상한

// 중복 판정용: 공백, 가운뎃점·하이픈 등 구두점, 대소문자 차이를 무시한다.
export function normalizeName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s·・\-_/.,:;!?()[\]{}'"`~]+/g, "");
}

// 표시용 이름 정리: 연속 공백을 하나로, 앞뒤 공백 제거. 쓸 수 없으면 null.
export function cleanSubName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > MAX_SUB_NAME) return null;
  if (/[\u0000-\u001f<>]/.test(name)) return null;
  return name;
}

type Db = PrismaClient | Prisma.TransactionClient;

// 섹션 안에서 같은 뜻의 이름이 있으면 그걸 돌려주고, 없으면 새로 만든다.
export async function findOrCreateSubCategory(
  db: Db,
  mainCategory: string,
  rawName: string,
): Promise<{ id: string; name: string; created: boolean } | null> {
  const name = cleanSubName(rawName);
  if (!name) return null;

  const existing = await db.noteSubCategory.findMany({
    where: { mainCategory },
    select: { id: true, name: true, order: true },
  });
  const key = normalizeName(name);
  const same = existing.find((s) => normalizeName(s.name) === key);
  if (same) return { id: same.id, name: same.name, created: false };

  const order = existing.reduce((m, s) => Math.max(m, s.order), 0) + 1;
  const created = await db.noteSubCategory.create({
    data: { mainCategory, name, order },
    select: { id: true, name: true },
  });
  return { id: created.id, name: created.name, created: true };
}
