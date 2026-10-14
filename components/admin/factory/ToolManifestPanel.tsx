// components/admin/factory/ToolManifestPanel.tsx
// 통제실 [설정] 도구함의 '도구 설명서'(읽기 전용). 작업 PC 의 game-toolkit/tools/manifests 를 감독 프로그램이 읽어 보낸 값을 도구마다 보여 준다:
// 방법(엔진), 방법마다 필요한 키와 준비 상태(키 '이름'이 등록돼 있는지만, 값은 보여 주지 않음), 한계, 입력 항목.
// 서버에서 그린다(펼침은 <details>). 못 읽어도 통제실은 뜬다.
import { buildManifestsView, limitLines, type ManifestsView, type ToolManifestView } from "@/lib/factory/toolManifest";
import { readManifestReport } from "@/lib/factory/toolManifestDb";
import { knownSecretNames } from "@/lib/factory/secretEntries";

function MethodBlock({ m }: { m: ToolManifestView["methods"][number] }) {
  const limits = limitLines(m);

  return (
    <li className="break-words" data-manifest-method={m.id}>
      <span className="font-semibold">{m.label}</span> <span className="font-mono fx-muted">({m.id})</span>
      <span> · </span>
      {m.secretStates.length ? (
        <span data-method-ready={m.ready ? "yes" : "no"}>
          <b className={m.ready ? "" : "fx-bad"}>{m.ready ? "키 준비됨" : "키 없음"}</b>{" "}
          {m.secretStates.map((s, i) => (
            <span className="font-mono" data-secret-state={s.ready ? "ready" : "missing"} key={s.name}>
              {i ? ", " : ""}
              {s.name}({s.ready ? "등록됨" : "없음"})
            </span>
          ))}
        </span>
      ) : (
        <span className="fx-muted">키 필요 없음</span>
      )}
      <span className="fx-muted"> · {m.network ? "인터넷 사용" : "인터넷 안 씀"}</span>
      {limits.length ? <div className="fx-muted" data-method-limits>한계: {limits.join(" · ")}</div> : null}
      {m.cost ? <div className="fx-muted">비용 단위: {m.cost.unit}{m.cost.perCall !== undefined ? ` (호출당 ${m.cost.perCall})` : ""}</div> : null}
      {m.notes ? <div className="fx-muted">{m.notes}</div> : null}
    </li>
  );
}

function ToolBlock({ t }: { t: ToolManifestView }) {
  return (
    <li className="fx-panel min-w-0 p-3" data-manifest-tool={t.name}>
      <details>
        <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 break-all font-mono font-semibold">{t.name}</span>
          <span className="min-w-0 break-words text-sm">
            {t.label} · 방법 {t.methods.length}개
            {t.source === "fallback" ? <span className="fx-muted" data-manifest-source="fallback"> · 최소 설명서(도구함 정보로 만듦)</span> : <span className="fx-muted" data-manifest-source="file"> · 설명서 v{t.version}</span>}
          </span>
          <span className="w-full min-w-0 break-words text-sm fx-muted">{t.description || "설명 없음"}</span>
        </summary>
        <div className="mt-2 grid gap-2 text-sm">
          <div>
            <p className="fx-label">방법 · 필요한 키(이름만, 값은 안 보여요) · 한계</p>
            <ul className="grid gap-1">
              {t.methods.map((m) => (
                <MethodBlock key={m.id} m={m} />
              ))}
            </ul>
          </div>
          {t.inputs.length ? (
            <div data-manifest-inputs>
              <p className="fx-label">입력 항목 {t.inputs.length}개</p>
              <ul className="grid gap-0.5">
                {t.inputs.map((i) => (
                  <li className="break-words" data-manifest-input={i.name} key={i.name}>
                    <span className="font-mono font-semibold">{i.name}</span>
                    <span className="fx-muted">
                      {" "}
                      · {i.type}
                      {i.required ? " · 필수" : ""}
                      {i.range ? ` · ${i.range.min ?? "?"}~${i.range.max ?? "?"}` : ""}
                      {i.choices?.length ? ` · ${i.choices.join("|")}` : ""}
                      {i.methods?.length ? ` · 방법 ${i.methods.join(",")} 전용` : ""}
                      {i.description ? ` · ${i.description}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {t.outputs.formats.length || t.outputs.resultFile ? (
            <p className="break-words fx-muted">
              결과: {t.outputs.formats.join(", ") || "?"}
              {t.outputs.resultFile ? ` · 요약 파일 ${t.outputs.resultFile}` : ""}
            </p>
          ) : null}
        </div>
      </details>
    </li>
  );
}

export function ToolManifestsView({ view, failed = false }: { view: ManifestsView; failed?: boolean }) {
  return (
    <section aria-label="도구 설명서" className="fx-hud scroll-mt-24" id="toolkit-manifests">
      <header className="fx-hud-head">
        <h2 className="fx-hud-title">toolkit · 도구 설명서</h2>
        <span className="text-sm fx-muted">읽기 전용 · 키 값은 보여 주지 않아요</span>
      </header>
      {failed ? (
        <p className="text-sm fx-muted" role="status">○ 확인 못 함 — 도구 설명서를 읽지 못했어요. 다른 설정 패널은 그대로 쓸 수 있어요.</p>
      ) : !view.tools.length ? (
        <p className="text-sm fx-muted" role="status">○ 아직 못 받았어요 — 감독 프로그램이 새 버전으로 켜지면 곧 설명서를 보내요.</p>
      ) : (
        <>
          <p className="mb-2 break-words text-sm" data-manifest-count={view.tools.length}>
            도구 <b>{view.tools.length}개</b> · 설명서 파일 {view.tools.filter((t) => t.source === "file").length}개
            <span className="fx-muted"> · 툴킷 판 {view.commit || "모름"} · 받은 시각 {view.reportedAt ? `${view.reportedAt.slice(0, 16).replace("T", " ")}(UTC)` : "?"}</span>
          </p>
          <ul className="grid gap-2">
            {view.tools.map((t) => (
              <ToolBlock key={t.name} t={t} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default async function ToolManifestPanel() {
  try {
    const [report, names] = await Promise.all([readManifestReport(), knownSecretNames().catch(() => [] as { name: string }[])]);

    return <ToolManifestsView view={buildManifestsView(report, new Set(names.map((n) => n.name)))} />;
  } catch {
    return <ToolManifestsView failed view={{ commit: "", reportedAt: null, tools: [] }} />;
  }
}
