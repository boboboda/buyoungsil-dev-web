// lib/factory/appChecks.ts
// 앱별 합치기·최종 점검 검사 명령. 병행 일감을 기본 브랜치에 합칠 때와 지휘자 묶음의 마지막 전체 점검 때, stack 기본 검사(예: nestjs 는 tsc) 뒤에 이 명령들을 더 돌린다.
// - 저장: factory_settings 의 appCheckCommands 한 칸(JSON) { [appSlug]: ["python -m unittest discover -s tests -q", ...] }. 앱 레코드와 상관없고 마이그레이션 스키마 변경이 필요 없다.
// - 비어 있으면(저장 안 함) 지금처럼 stack 기본 검사만 돈다.
// - 한 줄 = 명령 하나. 감독 프로그램이 셸 없이 실행한다(공백으로 나누고 큰따옴표로 묶기). 그래서 && | ; > < ` $ % ^ 같은 셸 글자는 받지 않는다.
import prisma from "@/lib/prisma";

export const APP_CHECKS_KEY = "appCheckCommands";
export const MAX_CHECK_COMMANDS = 8;
export const MAX_CHECK_LENGTH = 200;
export const MAX_CHECK_APPS = 200;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const SHELL_CHARS = /[&|;<>`$%^\u0000-\u001f\u007f]/;

export type AppChecks = Record<string, string[]>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 명령 한 줄 검사: 비어 있지 않고, 길이 제한 안이며, 셸 글자가 없고, 따옴표 짝이 맞는다 */
export function cleanCheckLine(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const line = v.trim().replace(/\s+/g, " ");

  if (!line || line.length > MAX_CHECK_LENGTH || SHELL_CHARS.test(line)) return null;
  if ((line.match(/"/g) ?? []).length % 2 !== 0) return null;

  return line;
}

/** 명령 목록 정리: 줄바꿈으로 나눈 글자 또는 배열 → 검사를 통과한 줄만(중복 제거, 최대 8개). 모양이 잘못된 줄이 하나라도 있으면 null */
export function cleanCheckList(v: unknown): string[] | null {
  const raw = typeof v === "string" ? v.split(/\r?\n/) : Array.isArray(v) ? v : null;

  if (!raw) return null;
  const lines = raw.filter((x) => !(typeof x === "string" && x.trim() === ""));
  const out: string[] = [];

  for (const x of lines) {
    const line = cleanCheckLine(x);

    if (line === null) return null;
    if (!out.includes(line)) out.push(line);
  }

  return out.length > MAX_CHECK_COMMANDS ? null : out;
}

/** 저장된 JSON → 표. 이상한 항목은 버린다 */
export function readAppChecks(raw: string | null | undefined): AppChecks {
  if (!raw) return {};
  try {
    const o: unknown = JSON.parse(raw);

    if (!isRecord(o)) return {};
    const out: AppChecks = {};

    for (const [slug, list] of Object.entries(o).slice(0, MAX_CHECK_APPS)) {
      const lines = SLUG_RE.test(slug) && Array.isArray(list) ? cleanCheckList(list) : null;

      if (lines?.length) out[slug] = lines;
    }

    return out;
  } catch {
    return {};
  }
}

export type AppChecksPatchResult = { ok: true; checks: AppChecks; message: string } | { ok: false; message: string };

/** 관리자 입력 { appSlug, commands } 한 건을 합친다. commands 가 비어 있으면 그 앱의 설정을 지운다(stack 기본 검사만) */
export function applyAppChecksPatch(cur: AppChecks, raw: unknown): AppChecksPatchResult {
  if (!isRecord(raw)) return { ok: false, message: "검사 명령 본문이 올바르지 않아요." };
  const slug = typeof raw.appSlug === "string" ? raw.appSlug.trim() : "";

  if (!SLUG_RE.test(slug)) return { ok: false, message: "appSlug 형식이 올바르지 않아요(영문 소문자·숫자·하이픈)." };
  const commands = cleanCheckList(raw.commands ?? "");

  if (!commands) {
    return { ok: false, message: `검사 명령은 한 줄에 하나, 최대 ${MAX_CHECK_COMMANDS}줄·줄마다 ${MAX_CHECK_LENGTH}자 이내여야 하고 && | ; > < \` $ % ^ 같은 셸 글자는 쓸 수 없어요.` };
  }
  const next = { ...cur };

  if (!commands.length) {
    delete next[slug];

    return { ok: true, checks: next, message: `${slug} 의 검사 명령을 비웠어요. 앞으로 stack 기본 검사만 돌아요.` };
  }
  if (!Object.hasOwn(cur, slug) && Object.keys(cur).length >= MAX_CHECK_APPS) return { ok: false, message: `앱별 검사 명령은 ${MAX_CHECK_APPS}개 앱까지 저장해요.` };
  next[slug] = commands;

  return { ok: true, checks: next, message: `${slug} 의 검사 명령 ${commands.length}개를 저장했어요. 다음 합치기·최종 점검부터 stack 기본 검사 뒤에 더 돌아요.` };
}

export async function getAppChecks(): Promise<AppChecks> {
  const row = await prisma.factorySetting.findUnique({ where: { key: APP_CHECKS_KEY } });

  return readAppChecks(row?.value);
}

export async function saveAppChecks(checks: AppChecks): Promise<void> {
  const value = JSON.stringify(checks);

  await prisma.factorySetting.upsert({ where: { key: APP_CHECKS_KEY }, create: { key: APP_CHECKS_KEY, value }, update: { value } });
}
