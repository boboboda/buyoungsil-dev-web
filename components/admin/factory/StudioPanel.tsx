// components/admin/factory/StudioPanel.tsx
// 통제실 [스튜디오] 탭(3-4 정리 뒤): 위쪽은 새 공용 스튜디오(/studio)로 가는 바로가기와 프로젝트별 요약(분류·카드·검수 대기·최근 생성)만 둔다.
// 새 스튜디오에 아직 없는 편집(분류·바로가기·연결 도구·프로젝트 연결 설정·일감 보내기)은 아래 '예전 방식 편집'에 접어서 남겨 둔다. 옛 스튜디오 화면을 지우는 일은 따로 한다(docs/studio-hub.md 「옛 스튜디오 정리 계획」).
// 예전 설명: 홈페이지가 아는 앱(일감의 appSlug)을 [게임 스튜디오]·[앱 스튜디오]로 나눠 보이고, 도구 연결·스튜디오 주소를 저장한다.
// 자료: 앱 목록 = factory_jobs(앱마다 가장 최근 일감, 완료된 앱 먼저), 도구 = 도구함이 보고받은 tools.json(ToolkitToolsPanel 과 같은 자료), 분류·연결·바로가기 = factory_settings.studioProjects(바로가기가 비어 있으면 코드에서 확인한 기본 주소를 얹어 보여 준다).
// 읽기에 실패해도 통제실은 뜬다.
import Link from "next/link";

import prisma from "@/lib/prisma";
import { readToolkitView } from "@/lib/factory/toolkit";
import { APP_ROLES_KEY, readAppRoles } from "@/lib/factory/appRoles";
import { buildStudioApps, splitStudioApps, readStudioProjects, withDefaultShortcuts, STUDIO_PROJECTS_KEY } from "@/lib/factory/studioProjects";

import { STUDIO_REQUEST_SOURCE } from "@/lib/studio/requests";
import { readStudioOverview } from "@/lib/studio/data";
import { shortDate } from "@/lib/studio/dashboard";

import StudioWorkbench, { type StudioSentJob, type StudioToolRow } from "./StudioWorkbench";

/** 공용 스튜디오(/studio) 바로가기: 카드·도구 블록·키 상태·생성·검수·배치는 거기서 한다 */
function StudioHubLink() {
  return (
    <p className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-studio-hub-link>
      <Link className="fx-btn fx-btn-sm" href="/studio">
        공용 스튜디오로 이동 →
      </Link>
      <span className="fx-muted">카드·도구 블록·키 상태, 생성, 검수·내보내기·일정, 배치는 공용 스튜디오에서 해요.</span>
    </p>
  );
}

interface SummaryRow {
  appSlug: string;
  title: string;
  kindLabel: string;
  cardCount: number;
  pendingReview: number;
  lastGeneratedAt: string | null;
  oldStudioUrl: string | null;
}

/** 프로젝트별 요약 표: 새 스튜디오로 가는 링크와, 있으면 옛 스튜디오 바로가기 */
function StudioSummary({ rows }: { rows: SummaryRow[] }) {
  if (!rows.length) return null;

  return (
    <section className="fx-panel mb-3 min-w-0 space-y-2 p-3" data-studio-summary>
      <h3 className="fx-label">프로젝트 요약</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-left fx-muted">
              <th className="pr-3">프로젝트</th>
              <th className="pr-3">분류</th>
              <th className="pr-3">카드</th>
              <th className="pr-3">검수 대기</th>
              <th className="pr-3">최근 생성</th>
              <th>바로가기</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.appSlug} data-studio-summary-row={r.appSlug}>
                <td className="pr-3">
                  <span className="font-semibold">{r.title}</span> <span className="font-mono text-xs fx-muted">{r.appSlug}</span>
                </td>
                <td className="pr-3">{r.kindLabel}</td>
                <td className="pr-3">{r.cardCount}장</td>
                <td className={`pr-3 ${r.pendingReview ? "fx-warn" : ""}`}>{r.pendingReview}장</td>
                <td className="pr-3">{shortDate(r.lastGeneratedAt)}</td>
                <td className="space-x-2">
                  <Link className="underline" data-studio-summary-open={r.appSlug} href={`/studio/${r.appSlug}`}>
                    새 스튜디오
                  </Link>
                  {r.oldStudioUrl ? (
                    <a className="underline fx-muted" data-studio-summary-old={r.appSlug} href={r.oldStudioUrl} rel="noopener noreferrer" target="_blank">
                      옛 스튜디오 ↗
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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
    const initial = withDefaultShortcuts(readStudioProjects(setting?.value), products.map((a) => a.appSlug));
    const overview = await readStudioOverview().catch(() => null);
    const summary: SummaryRow[] = (overview?.rows ?? []).map((r) => ({ appSlug: r.appSlug, title: r.title, kindLabel: r.kindLabel, cardCount: r.cardCount, pendingReview: r.pendingReview, lastGeneratedAt: r.lastGeneratedAt, oldStudioUrl: initial[r.appSlug]?.studioUrl ?? null }));

    return (
      <>
        <StudioHubLink />
        <StudioSummary rows={summary} />
        {overview ? null : (
          <p className="mb-3 text-sm fx-muted" role="status">
            ○ 확인 못 함 — 프로젝트 요약을 읽지 못했어요. 아래 예전 방식 편집은 그대로 쓸 수 있어요.
          </p>
        )}
        <details data-studio-legacy>
          <summary className="fx-label cursor-pointer">예전 방식 편집 (분류·바로가기·연결 도구·프로젝트 연결 설정·일감 보내기)</summary>
          <p className="my-2 text-xs fx-muted">새 스튜디오에 아직 옮기지 않은 편집이라 남겨 뒀어요. 카드·도구 블록 보기, 생성, 검수, 배치는 위의 새 스튜디오가 대신해요.</p>
          <StudioWorkbench apps={products} toolApps={toolApps} initial={initial} tools={tools} recent={recent} toolsReported={!!view.info && view.info.state === "ok"} />
        </details>
      </>
    );
  } catch (error) {
    console.error("[studio] 스튜디오 자료 읽기 실패:", error instanceof Error ? error.name : "unknown");

    return (
      <>
        <StudioHubLink />
        <p className="text-sm fx-muted" role="status">
          ○ 확인 못 함 — 스튜디오 자료를 읽지 못했어요. 다른 탭은 그대로 쓸 수 있어요.
        </p>
      </>
    );
  }
}
