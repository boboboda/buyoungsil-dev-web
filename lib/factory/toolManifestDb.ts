// lib/factory/toolManifestDb.ts
// 도구 설명서 보고의 DB 읽기·쓰기(순수 부분은 toolManifest.ts). 저장은 factory_settings 의 toolManifests 한 칸(새 테이블 없음).
// 도구마다 최신 설명서 하나와 판 번호(툴킷 커밋)만 남긴다. 키 값은 어디에도 없다.
import prisma from "@/lib/prisma";
import { knownSecretNames } from "@/lib/factory/secretEntries";
import {
  autoSecretsForPlan,
  buildManifestsView,
  checkPlanLimits,
  checkSettingsLimits,
  parseStoredManifests,
  TOOL_MANIFESTS_KEY,
  type ManifestReport,
  type ManifestsView,
  type ToolManifestEntry,
} from "@/lib/factory/toolManifest";
import { readStoredSettings } from "@/lib/factory/projectToolSettings";

export async function readManifestReport(): Promise<ManifestReport | null> {
  const row = await prisma.factorySetting.findUnique({ where: { key: TOOL_MANIFESTS_KEY } });

  return parseStoredManifests(row?.value);
}

export async function saveManifestReport(report: ManifestReport): Promise<void> {
  const value = JSON.stringify(report);

  await prisma.factorySetting.upsert({ where: { key: TOOL_MANIFESTS_KEY }, create: { key: TOOL_MANIFESTS_KEY, value }, update: { value } });
}

/** 설명서 목록이 없으면(감독이 아직 보고 전) 빈 객체 */
export async function readManifestTools(): Promise<Record<string, ToolManifestEntry>> {
  return (await readManifestReport().catch(() => null))?.tools ?? {};
}

/** 통제실·커넥터용: 설명서 + 방법별 키 준비 상태(키 이름이 등록돼 있는지만) */
export async function readManifestsView(): Promise<ManifestsView> {
  const [report, names] = await Promise.all([readManifestReport(), knownSecretNames().catch(() => [] as { name: string }[])]);

  return buildManifestsView(report, new Set(names.map((n) => n.name)));
}

/** 프로젝트 도구 설정 저장 직전 검사(SettingsGuard): 설명서 한계를 넘는 값이면 이유 목록 */
export async function settingsLimitViolations(settings: unknown): Promise<string[]> {
  const tools = await readManifestTools();

  return checkSettingsLimits(settings, tools);
}

/** 일감 등록 직전 검사: 지시문의 한계 위반(거절 이유)과, 지시문이 부르는 방법에 필요한 키(자동으로 requiredSecrets 에 넣을 이름) */
export async function inspectPlan(appSlug: string, plan: string): Promise<{ violations: string[]; autoSecrets: { name: string; tool: string; method: string }[] }> {
  const tools = await readManifestTools();

  if (!Object.keys(tools).length) return { violations: [], autoSecrets: [] };
  const projectMethods: Record<string, string> = {};
  const row = await prisma.factoryProjectToolSetting.findUnique({ where: { appSlug } }).catch(() => null);
  const settings = row ? readStoredSettings(row.settings) : null;
  const methods = settings && typeof settings.methods === "object" && settings.methods ? (settings.methods as Record<string, { default?: unknown }>) : {};
  const defaults = Object.values(methods).map((m) => m?.default).filter((d): d is string => typeof d === "string");

  if (defaults.length) projectMethods["pixel-art"] = defaults.find((d) => tools["pixel-art"]?.methods.some((m) => m.secrets.length && m.id.toLowerCase() === d.toLowerCase())) ?? "";

  return { violations: checkPlanLimits(plan, tools), autoSecrets: autoSecretsForPlan(plan, tools, projectMethods) };
}
