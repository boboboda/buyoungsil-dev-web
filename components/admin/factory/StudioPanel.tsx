// components/admin/factory/StudioPanel.tsx
// 통제실 [스튜디오] 탭: 홈페이지가 아는 앱(일감의 appSlug)을 [게임 스튜디오]·[앱 스튜디오]로 나눠 보이고, 도구 연결·스튜디오 주소를 저장한다.
// 자료: 앱 목록 = factory_jobs(앱마다 가장 최근 일감, 완료된 앱 먼저), 도구 = 도구함이 보고받은 tools.json(ToolkitToolsPanel 과 같은 자료), 종류·연결 = factory_settings.studioProjects.
// 읽기에 실패해도 통제실은 뜬다.
import prisma from "@/lib/prisma";
import { readToolkitView } from "@/lib/factory/toolkit";
import { APP_ROLES_KEY, readAppRoles } from "@/lib/factory/appRoles";
import { buildStudioApps, splitStudioApps, readStudioProjects, STUDIO_PROJECTS_KEY } from "@/lib/factory/studioProjects";

import { STUDIO_REQUEST_SOURCE } from "@/lib/studio/requests";

import StudioWorkbench, { type StudioSentJob, type StudioToolRow } from "./StudioWorkbench";

export default async function StudioPanel() {
  try {
    const [jobs, setting, rolesRow, view, sent] = await Promise.all([
      prisma.factoryJob.findMany({
        where: { kind: { not: "lab" } }, // 실험 일감(appSlug=lab)은 앱이 아니다
        orderBy: { createdAt: "desc" },
        take: 500,
        select: { appSlug: true, title: true, stack: true, status: true, finishedAt: true, kind: true },
      }),
      prisma.factorySetting.findUnique({ where: { key: STUDIO_PROJECTS_KEY } }),
      prisma.factorySetting.findUnique({ where: { key: APP_ROLES_KEY } }),
      readToolkitView(prisma),
      prisma.factoryJob.findMany({ where: { source: STUDIO_REQUEST_SOURCE }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, appSlug: true, title: true, status: true, createdAt: true } }),
    ]);
    const recent: Record<string, StudioSentJob[]> = {};

    for (const j of sent) {
      const list = (recent[j.appSlug] ??= []);

      if (list.length < 5) list.push({ id: j.id, title: j.title, status: j.status, createdAt: j.createdAt.toISOString() });
    }
    const tools: StudioToolRow[] = view.rows.map((r) => ({ id: r.id, desc: r.desc, purpose: r.purpose, purposeSource: r.purposeSource, enabled: r.enabled, layer: r.layer, kinds: view.info?.studioTools.find((s) => s.id === r.id)?.kinds ?? [] }));

    const { products, toolApps } = splitStudioApps(buildStudioApps(jobs), readAppRoles(rolesRow?.value));

    return <StudioWorkbench apps={products} toolApps={toolApps} initial={readStudioProjects(setting?.value)} tools={tools} recent={recent} toolsReported={!!view.info && view.info.state === "ok"} />;
  } catch (error) {
    console.error("[studio] 스튜디오 자료 읽기 실패:", error instanceof Error ? error.name : "unknown");

    return (
      <p className="text-sm fx-muted" role="status">
        ○ 확인 못 함 — 스튜디오 자료를 읽지 못했어요. 다른 탭은 그대로 쓸 수 있어요.
      </p>
    );
  }
}
