"use client";

// 통제실 [스튜디오] 프로젝트 상세의 "도구 설정" 카드: pixel-art 가 읽는 프로젝트 설정(방식·결과·규격·스타일·모션·비용·참고 그림·대상 별칭)을 묶음별 폼으로 고친다.
// 불러오기·저장·되돌리기는 /api/admin/factory/tool-settings. 저장 전에 같은 스키마로 한 번 검증한다(서버가 다시 검증).
// 비워 둔 칸 = 도구 기본값. 요청에 적은 말 > 프로젝트 설정 > 도구 기본값 순으로 적용돼요.
import { useCallback, useEffect, useState } from "react";

import {
  cleanProjectSettings,
  HISTORY_LIMIT,
  METHOD_LABELS,
  METHODS,
  RESULT_KIND_LABELS,
  RESULT_KINDS,
  type ProjectToolSettings,
} from "@/lib/factory/projectToolSettings";

interface HistoryItem {
  version: number;
  note: string;
  createdAt: string;
  createdBy: string;
  changed: string[];
  empty: boolean;
}
interface Record_ {
  version: number;
  settings: ProjectToolSettings;
  updatedAt: string;
  updatedBy: string;
}
interface Snapshot {
  record: Record_ | null;
  history: HistoryItem[];
  schemaWarning: string | null;
  message?: string;
  errors?: string[];
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const FIELD = "mt-1 w-full min-w-0 rounded border border-default-300 bg-transparent px-2 py-1 text-sm";
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")}(UTC)`;

/** 별칭 글 "싹이 = 감자, ssagi" (한 줄에 대상 하나) ↔ { 싹이: ["감자","ssagi"] } */
export function parseAliases(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};

  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");

    if (i < 0) continue;
    const name = line.slice(0, i).trim();
    const list = line.slice(i + 1).split(",").map((x) => x.trim()).filter(Boolean);

    if (name && list.length) out[name] = list;
  }

  return out;
}
export const aliasesToText = (a: unknown) => (isRec(a) ? Object.entries(a).map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join(", ") : ""}`).join("\n") : "");

function getAt(o: unknown, path: string[]): unknown {
  let cur: unknown = o;

  for (const p of path) cur = isRec(cur) ? cur[p] : undefined;

  return cur;
}

/** 불변 갱신: path 위치에 값을 넣고(빈 값이면 지우고) 비어 버린 윗 묶음은 그대로 둔다(저장할 때 검증기가 빈 묶음을 정리) */
function setAt(o: ProjectToolSettings, path: string[], value: unknown): ProjectToolSettings {
  const [head, ...rest] = path;
  const next: Record<string, unknown> = { ...o };

  if (!rest.length) {
    if (value === undefined || value === "" || (Array.isArray(value) && !value.length)) delete next[head];
    else next[head] = value;
  } else next[head] = setAt(isRec(o[head]) ? o[head] : {}, rest, value);

  return next;
}

export default function ProjectToolSettingsCard({ appSlug }: { appSlug: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<ProjectToolSettings>({});
  const [aliasText, setAliasText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);

  const apply = useCallback((s: Snapshot) => {
    setSnap(s);
    setDraft(s.record?.settings ?? {});
    setAliasText(aliasesToText(s.record?.settings.aliases));
  }, []);

  useEffect(() => {
    let alive = true;

    setSnap(null);
    setNotice("");
    setLoadFailed(false);
    fetch(`/api/admin/factory/tool-settings?appSlug=${encodeURIComponent(appSlug)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("load");

        return (await r.json()) as Snapshot;
      })
      .then((s) => alive && apply(s))
      .catch(() => alive && setLoadFailed(true));

    return () => {
      alive = false;
    };
  }, [appSlug, apply]);

  // 별칭 글은 저장·검사할 때만 설정에 합친다
  const withAliases = (): ProjectToolSettings => setAt(draft, ["aliases"], Object.keys(parseAliases(aliasText)).length ? parseAliases(aliasText) : undefined);
  const checked = cleanProjectSettings(withAliases());
  const saved = cleanProjectSettings(snap?.record?.settings ?? {});
  const dirty = !checked.ok || !saved.ok || JSON.stringify(checked.settings) !== JSON.stringify(saved.settings);

  const call = async (method: "PUT" | "POST", body: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/factory/tool-settings", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appSlug, ...body }) });
      const data = (await res.json().catch(() => ({}))) as Snapshot;

      setNotice(data.message || (res.ok ? "저장했어요." : "저장하지 못했어요."));
      if (res.ok) apply(data);
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const set = (path: string[], value: unknown) => setDraft((d) => setAt(d, path, value));
  const num = (path: string[], label: string, hint = "") => {
    const v = getAt(draft, path);

    return (
      <label className="block min-w-0 text-sm">
        <span className="fx-label">{label}</span>
        <input
          className={FIELD}
          data-setting={path.join(".")}
          disabled={busy}
          inputMode="numeric"
          placeholder={hint || "기본값"}
          type="text"
          value={v === undefined ? "" : String(v)}
          onChange={(e) => set(path, /^\d+$/.test(e.target.value.trim()) ? Number(e.target.value.trim()) : e.target.value)}
        />
      </label>
    );
  };
  const text = (path: string[], label: string, hint = "", mono = false) => (
    <label className="block min-w-0 text-sm">
      <span className="fx-label">{label}</span>
      <input className={`${FIELD}${mono ? " font-mono" : ""}`} data-setting={path.join(".")} disabled={busy} placeholder={hint || "기본값"} type="text" value={String(getAt(draft, path) ?? "")} onChange={(e) => set(path, e.target.value)} />
    </label>
  );
  const select = (path: string[], label: string, options: readonly string[], labels: Record<string, string> = {}) => (
    <label className="block min-w-0 text-sm">
      <span className="fx-label">{label}</span>
      <select className={FIELD} data-setting={path.join(".")} disabled={busy} value={String(getAt(draft, path) ?? "")} onChange={(e) => set(path, e.target.value)}>
        <option value="">(기본값)</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  );
  const checks = (path: string[], options: readonly string[], labels: Record<string, string>) => {
    const cur = Array.isArray(getAt(draft, path)) ? (getAt(draft, path) as string[]) : [];

    return (
      <span className="flex flex-wrap gap-x-3 gap-y-1">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1 text-sm">
            <input checked={cur.includes(o)} data-setting={`${path.join(".")}:${o}`} disabled={busy} type="checkbox" onChange={(e) => set(path, options.filter((x) => (x === o ? e.target.checked : cur.includes(x))))} />
            {labels[o] ?? o}
          </label>
        ))}
      </span>
    );
  };
  const group = (key: string, title: string, hint: string, body: React.ReactNode) => (
    <fieldset key={key} className="min-w-0 space-y-2 rounded border border-default-300 p-2" data-setting-group={key}>
      <legend className="fx-label px-1">{title}</legend>
      <p className="text-xs fx-muted">{hint}</p>
      {body}
    </fieldset>
  );

  const approved = getAt(draft, ["references", "approved"]);

  return (
    <section aria-label="도구 설정" className="min-w-0 space-y-3 border-t border-default-300 pt-3" data-project-tool-settings={appSlug}>
      <h4 className="fx-label">도구 설정 (pixel-art)</h4>
      <p className="text-sm fx-muted">
        부영실이 &quot;○○ 만들어&quot;처럼만 말해도 방식·규격·스타일을 다시 묻지 않게 하는 값이에요. 적용 순서는 요청에 적은 말 &gt; 이 설정 &gt; 도구 기본값이고, 비워 둔 칸은 도구 기본값이에요. 새로 시작하는 일감부터 적용돼요.
      </p>
      {loadFailed ? <p className="text-sm fx-bad">○ 확인 못 함 — 도구 설정을 불러오지 못했어요.</p> : null}
      {!snap && !loadFailed ? <p className="text-sm fx-muted">불러오는 중…</p> : null}
      {snap ? (
        <>
          <p className="text-sm" data-settings-status>
            {snap.record ? (
              <>
                버전 {snap.record.version} · 수정 {when(snap.record.updatedAt)} · 수정자 {snap.record.updatedBy || "알 수 없음"}
              </>
            ) : (
              <span className="fx-muted">저장된 설정이 없어요(= 도구 기본값).</span>
            )}
          </p>
          {snap.schemaWarning ? (
            <p className="text-sm fx-warn" data-settings-warning role="status">
              ⚠ {snap.schemaWarning}
            </p>
          ) : null}

          {group(
            "methods",
            "방식",
            `결과 종류별로 쓸 수 있는 방식(허용)과 요청에 방식이 없을 때 쓰는 기본 방식. PixelLab 을 허용하지 않으려면 허용 목록에서 빼세요.`,
            <div className="grid gap-3">
              {RESULT_KINDS.map((k) => (
                <div key={k} className="min-w-0 space-y-1" data-method-kind={k}>
                  <p className="text-sm font-semibold">
                    {RESULT_KIND_LABELS[k]} <span className="fx-muted font-mono text-xs">{k}</span>
                  </p>
                  {checks(["methods", k, "allowed"], METHODS, METHOD_LABELS)}
                  {select(["methods", k, "default"], "기본 방식", METHODS, METHOD_LABELS)}
                </div>
              ))}
            </div>,
          )}
          {group(
            "results",
            "결과",
            "이 프로젝트에서 만들 수 있는 결과 종류와 기본 종류.",
            <div className="grid gap-2">
              {checks(["results", "allowed_kinds"], RESULT_KINDS, RESULT_KIND_LABELS)}
              {select(["results", "default_kind"], "기본 종류", RESULT_KINDS, RESULT_KIND_LABELS)}
            </div>,
          )}
          {group(
            "spec",
            "규격",
            "칸 크기(8~256 px)·장면 캔버스(64~1254 px).",
            <div className="grid gap-2 sm:grid-cols-3">
              {num(["spec", "cell_size"], "칸 크기(px)", "32")}
              {text(["spec", "size_group"], "크기 그룹", "예: small")}
              {num(["spec", "canvas"], "캔버스(px)", "1024")}
            </div>,
          )}
          {group(
            "style",
            "스타일",
            "외곽선 색은 #RRGGBB, 최대 색 수는 2~256.",
            <div className="grid gap-2 sm:grid-cols-3">
              {text(["style", "outline_color"], "외곽선 색", "#3a2820", true)}
              {num(["style", "max_colors"], "최대 색 수", "16")}
              {text(["style", "preset"], "스타일 프리셋", "예: ssagi")}
              <label className="block min-w-0 text-sm sm:col-span-3">
                <span className="fx-label">스타일 메모</span>
                <textarea className={FIELD} data-setting="style.notes" disabled={busy} rows={2} value={String(getAt(draft, ["style", "notes"]) ?? "")} onChange={(e) => set(["style", "notes"], e.target.value)} />
              </label>
            </div>,
          )}
          {group(
            "motion",
            "모션",
            "프레임 수·속도·반복, 그리고 Claude 방식의 pixel-motion 값.",
            <div className="grid gap-2 sm:grid-cols-4">
              {select(["motion", "preset"], "프리셋", ["walk", "idle", "bounce", "sway"])}
              {num(["motion", "frames"], "프레임 수", "2~64")}
              {num(["motion", "fps"], "속도(fps)", "8")}
              {select(["motion", "loop"], "반복", ["pingpong", "forward"], { pingpong: "왕복(pingpong)", forward: "정방향(forward)" })}
              {num(["motion", "pixel_motion", "stride"], "stride")}
              {num(["motion", "pixel_motion", "lift"], "lift")}
              {num(["motion", "pixel_motion", "bob"], "bob")}
              {num(["motion", "pixel_motion", "sway"], "sway")}
              {select(["motion", "pixel_motion", "facing"], "facing", ["right", "left"])}
            </div>,
          )}
          {group(
            "cost",
            "비용",
            "PixelLab 호출 수 한도. 넘으면 시작 전에 멈추고 승인을 물어요(이때만 사람에게 물어요). 비워 두면 도구 기본값이에요.",
            <div className="grid gap-2 sm:grid-cols-2">
              {num(["cost", "pixellab_per_job"], "일감당 한도", "제한 없음")}
              {num(["cost", "pixellab_per_month"], "월 한도", "제한 없음")}
            </div>,
          )}
          {group(
            "references",
            "참고 그림",
            "요청에 고른 그림 다음에 자동으로 붙일 참고 그림의 최대 수(0~4, 기본 4).",
            <div className="grid gap-2 sm:grid-cols-2">
              {num(["references", "auto_max"], "자동 참고 최대 수", "4")}
              <p className="text-sm fx-muted">승인된 그림 {Array.isArray(approved) ? approved.length : 0}개(목록 편집은 다음 단계에서 지원해요. 저장해도 지워지지 않아요).</p>
            </div>,
          )}
          {group(
            "aliases",
            "대상 별칭",
            "한 줄에 하나: 대표 이름 = 별칭, 별칭. 요청의 대상이 별칭이면 대표 이름으로 합쳐요. 예: 싹이 = 감자, ssagi",
            <textarea className={`${FIELD} font-mono`} data-setting="aliases" disabled={busy} rows={3} value={aliasText} onChange={(e) => setAliasText(e.target.value)} />,
          )}

          {checked.ok === false ? (
            <ul className="text-sm fx-bad" data-settings-errors>
              {checked.errors.slice(0, 5).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded border border-default-300 px-3 py-1 font-semibold" data-settings-save disabled={busy || !checked.ok || !dirty} type="button" onClick={() => checked.ok && void call("PUT", { settings: checked.settings })}>
              [도구 설정 저장]
            </button>
            <button className="rounded border border-default-300 px-3 py-1" data-settings-reset disabled={busy || !dirty} type="button" onClick={() => apply(snap)}>
              [변경 취소]
            </button>
            {dirty ? <span className="text-sm fx-muted">저장하지 않은 변경이 있어요.</span> : null}
          </div>

          <div data-settings-history>
            <h5 className="fx-label">변경 이력 (최근 {HISTORY_LIMIT}개)</h5>
            {snap.history.length ? (
              <ul className="mt-1 grid gap-1 text-sm">
                {snap.history.map((h) => (
                  <li key={h.version} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-history-version={h.version}>
                    <span className="font-mono">v{h.version}</span>
                    <span className="min-w-0 break-words fx-muted">
                      {when(h.createdAt)} · {h.createdBy || "알 수 없음"} · {h.empty ? "비움(도구 기본값)" : h.changed.length ? `${h.changed.join("·")} 변경` : "변경 없음"}
                      {h.note ? ` · ${h.note}` : ""}
                    </span>
                    {snap.record?.version === h.version ? (
                      <span className="text-xs fx-muted">(현재)</span>
                    ) : (
                      <button className="rounded border border-default-300 px-2 py-0.5" data-history-revert={h.version} disabled={busy} type="button" onClick={() => void call("POST", { revert: h.version })}>
                        [이 버전으로 되돌리기]
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm fx-muted">아직 없어요.</p>
            )}
          </div>
        </>
      ) : null}
      {notice ? (
        <p className="text-sm fx-muted" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
