"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { CLAUDE_MODEL_LABELS, CLAUDE_MODELS, isAiEngine, isClaudeModel, type AiEngine, type ClaudeModel } from "@/lib/factory/ai";
import AiEngineSelect from "./AiEngineSelect";

export default function DefaultAiSettings() {
  const [engine, setEngine] = useState<AiEngine>("claude");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // 기본 모델: 승인 때 '기본 설정 사용'을 고른 Claude Code 일감이 시작할 때 쓰는 모델(null = 지정 안 함, Claude Code 자체 기본)
  const [model, setModel] = useState<ClaudeModel | null>(null);
  const [savedModel, setSavedModel] = useState<ClaudeModel | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/factory/control", { cache: "no-store" }).then(async res => {
      if (!res.ok) throw new Error("주사용 AI 설정을 읽지 못했어요.");
      const data = await res.json();
      if (alive && isAiEngine(data.defaultAiEngine)) { setEngine(data.defaultAiEngine); setLoaded(true); }
      if (alive) { const m = isClaudeModel(data.defaultClaudeModel) ? data.defaultClaudeModel : null; setModel(m); setSavedModel(m); }
    }).catch(e => { if (alive) setNotice(e.message); });
    return () => { alive = false; };
  }, []);
  const save = async (body: Record<string, unknown> = { defaultAiEngine: engine }) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/factory/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      setNotice(data.message || "저장하지 못했어요.");
      if (res.ok) {
        if ("defaultClaudeModel" in body) setSavedModel(isClaudeModel(data.defaultClaudeModel) ? data.defaultClaudeModel : null);
        window.dispatchEvent(new Event("factory-default-ai-changed"));
      }
    } catch { setNotice("서버에 연결하지 못했어요."); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-lg border border-default-200 p-4">
      <h2 className="font-semibold">주사용 AI</h2>
      <p className="text-sm text-default-500">새 앱·수정·출시·정비 지시에 기본으로 사용할 AI예요. 지시마다 다른 AI를 고를 수 있고, 이미 등록한 작업은 그대로 유지돼요.</p>
      <div className="flex flex-wrap items-center gap-3">
        <AiEngineSelect label="주사용 AI" value={engine} onChange={setEngine} disabled={!loaded || busy} />
        <Button size="sm" variant="flat" isDisabled={!loaded || busy} onPress={() => save()}>설정 저장</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3" data-default-model="">
        <label className="flex w-full min-w-0 flex-wrap items-center gap-2 text-sm sm:w-auto">
          <span>기본 모델 (Claude Code)</span>
          <select
            aria-label="기본 모델 (Claude Code)"
            className="min-h-11 w-full min-w-0 max-w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:min-h-0 sm:w-auto sm:text-sm"
            disabled={!loaded || busy}
            value={model ?? ""}
            onChange={(e) => setModel(isClaudeModel(e.target.value) ? e.target.value : null)}
          >
            <option value="">지정 안 함 — Claude Code 자체 기본</option>
            {CLAUDE_MODELS.map((m) => <option key={m} value={m}>{CLAUDE_MODEL_LABELS[m]}</option>)}
          </select>
        </label>
        <Button size="sm" variant="flat" isDisabled={!loaded || busy || model === savedModel} onPress={() => save({ defaultClaudeModel: model })}>기본 모델 저장</Button>
      </div>
      <p className="text-sm text-default-500">승인할 때 모델을 &apos;기본 설정 사용&apos;으로 두면 이 모델로 실행해요(Claude Code 일감만, Codex 에는 적용 안 함). 이미 시작한 일감은 그대로예요. 모델은 승인 화면([현황] 승인·배포 할 일, [일감] 상세, 공장 정비)과 텔레그램 [🧠 모델 골라 승인]에서 일감마다 고를 수 있어요.</p>
      <p className="text-sm text-default-500">Claude·Codex 터미널에서 <code>공장: codex 지시내용</code> 또는 <code>공장: claude 지시내용</code>으로 정비를 보낼 수 있어요. AI를 생략하면 주사용 AI를 따르며, 등록된 지시는 승인 후 감독 프로그램이 처리해요.</p>
      <p className="text-xs text-default-500">Codex 지시 훅은 처음 한 번 터미널의 <code>/hooks</code>에서 공장 훅을 허용해 주세요.</p>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </div>
  );
}
