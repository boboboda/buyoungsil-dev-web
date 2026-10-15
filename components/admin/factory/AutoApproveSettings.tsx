// components/admin/factory/AutoApproveSettings.tsx
// 통제실 [설정] '자동 승인 규칙'(5-3). 조건을 만족하는 일감은 승인 대기를 건너뛰고 바로 대기열에 들어간다. 규칙마다 켜고 끌 수 있고 기본은 모두 꺼짐.
// 출시 일감과 서버 배포는 절대 자동 승인하지 않는다(여기에 규칙 자체가 없다). 자동 승인된 일감은 [현황]에 표시되고 텔레그램으로 한 줄 알려 준다.
"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";

import SettingsCard from "./SettingsCard";
import { AUTO_RULE_HINTS, AUTO_RULE_KEYS, AUTO_RULE_LABELS, DEFAULT_AUTO_RULES, type AutoApproveRules } from "@/lib/factory/autoApprove";
import { TEMPLATE_KIND_LABELS } from "@/lib/factory/jobTemplates";
import { useTemplateSnapshot } from "./TemplateSender";

export default function AutoApproveSettings() {
  const { snap } = useTemplateSnapshot();
  const [rules, setRules] = useState<AutoApproveRules>(DEFAULT_AUTO_RULES);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const r = (snap as unknown as { rules?: AutoApproveRules } | null)?.rules;

    if (r && !loaded) {
      setRules(r);
      setLoaded(true);
    }
  }, [snap, loaded]);

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/factory/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rules", rules }) });
      const data = (await res.json().catch(() => ({}))) as { message?: string; rules?: AutoApproveRules };

      if (res.ok && data.rules) setRules(data.rules);
      setNotice(data.message ?? (res.ok ? "저장했어요." : "저장하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const templates = (snap?.templates ?? []).filter((t) => t.kind === "revision" || t.kind === "lab" || t.kind === "tool");

  return (
    <SettingsCard
      attrs={{ "data-title": "settings · 자동 승인 규칙", "data-auto-approve": "" }}
      description="조건에 맞는 일감은 승인을 기다리지 않고 바로 대기열에 넣어요. 규칙마다 켜고 끌 수 있고 기본은 모두 꺼져 있어요. 출시 일감과 서버 배포는 어떤 규칙으로도 자동 승인하지 않아요. 자동 승인된 일감은 [현황]에 표시하고 텔레그램으로 한 줄 알려요."
      notice={notice}
      title="자동 승인 규칙"
    >
      <div className="space-y-3">
        {AUTO_RULE_KEYS.map((k) => (
          <label key={k} aria-label={AUTO_RULE_LABELS[k]} className="flex items-start gap-2 text-sm" data-auto-rule={k}>
            <input checked={rules[k]} disabled={busy || !loaded} type="checkbox" onChange={(e) => setRules((r) => ({ ...r, [k]: e.target.checked }))} />
            <span>
              <b>{AUTO_RULE_LABELS[k]}</b>
              <span className="block text-xs text-default-500">{AUTO_RULE_HINTS[k]}</span>
            </span>
          </label>
        ))}
        {rules.template ? (
          <div className="space-y-1 pl-6 text-sm" data-auto-templates>
            {templates.length === 0 ? <p className="text-xs text-default-500">템플릿을 읽는 중…</p> : null}
            {templates.map((t) => (
              <label key={t.id} aria-label={t.name} className="flex items-center gap-2">
                <input checked={rules.templateIds.includes(t.id)} disabled={busy} type="checkbox" onChange={(e) => setRules((r) => ({ ...r, templateIds: e.target.checked ? [...r.templateIds, t.id] : r.templateIds.filter((x) => x !== t.id) }))} />
                [{TEMPLATE_KIND_LABELS[t.kind]}] {t.name}
              </label>
            ))}
            {rules.templateIds.length === 0 ? <p className="text-xs text-warning-700">고른 템플릿이 없으면 이 규칙은 아무 일감도 승인하지 않아요.</p> : null}
          </div>
        ) : null}
        <Button color="primary" data-auto-save isDisabled={busy || !loaded} size="sm" onPress={save}>
          {busy ? "저장 중…" : "규칙 저장"}
        </Button>
      </div>
    </SettingsCard>
  );
}
