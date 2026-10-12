"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import { isAiEngine, type AiEngine } from "@/lib/factory/ai";
import AiEngineSelect from "./AiEngineSelect";

export default function DefaultAiSettings() {
  const [engine, setEngine] = useState<AiEngine>("claude");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/factory/control", { cache: "no-store" }).then(async res => {
      if (!res.ok) throw new Error("주사용 AI 설정을 읽지 못했어요.");
      const data = await res.json();
      if (alive && isAiEngine(data.defaultAiEngine)) { setEngine(data.defaultAiEngine); setLoaded(true); }
    }).catch(e => { if (alive) setNotice(e.message); });
    return () => { alive = false; };
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/factory/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultAiEngine: engine }) });
      const data = await res.json();
      setNotice(data.message || "저장하지 못했어요.");
      if (res.ok) window.dispatchEvent(new Event("factory-default-ai-changed"));
    } catch { setNotice("서버에 연결하지 못했어요."); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-lg border border-default-200 p-4">
      <h2 className="font-semibold">주사용 AI</h2>
      <p className="text-sm text-default-500">새 앱·수정·출시·정비 지시에 기본으로 사용할 AI예요. 지시마다 다른 AI를 고를 수 있고, 이미 등록한 작업은 그대로 유지돼요.</p>
      <div className="flex flex-wrap items-center gap-3">
        <AiEngineSelect label="주사용 AI" value={engine} onChange={setEngine} disabled={!loaded || busy} />
        <Button size="sm" variant="flat" isDisabled={!loaded || busy} onPress={save}>설정 저장</Button>
      </div>
      <p className="text-sm text-default-500">Claude·Codex 터미널에서 <code>공장: codex 지시내용</code> 또는 <code>공장: claude 지시내용</code>으로 정비를 보낼 수 있어요. AI를 생략하면 주사용 AI를 따르며, 등록된 지시는 승인 후 감독 프로그램이 처리해요.</p>
      <p className="text-xs text-default-500">Codex 지시 훅은 처음 한 번 터미널의 <code>/hooks</code>에서 공장 훅을 허용해 주세요.</p>
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </div>
  );
}
