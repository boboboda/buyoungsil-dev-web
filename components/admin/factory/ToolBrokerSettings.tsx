"use client";

// 도구 요청 중계 스위치: 꺼짐 / 보고만 / 허용 + 일감당 요청 수·도구 제한 시간. 감독 프로그램이 /api/factory/next 폴링 때 받아 간다.
import { useEffect, useState } from "react";
import { Button } from "@heroui/react";
import {
  isToolBrokerMode,
  normalizeToolBroker,
  TOOL_BROKER_DEFAULTS,
  TOOL_BROKER_LIMITS,
  TOOL_BROKER_MODE_LABELS,
  TOOL_BROKER_MODES,
  type ToolBrokerSettings as Settings,
} from "@/lib/factory/toolBroker";

const MODE_HELP: Record<Settings["mode"], string> = {
  off: "요청서를 보지 않아요(지금까지와 같음).",
  report: "요청을 검사해 기록만 하고 실행하지 않아요(denied: 보고만 모드).",
  allow: "허용 목록의 도구(echo, toolkit.run)를 감독 프로그램이 대신 실행해요.",
};

export default function ToolBrokerSettings() {
  const [s, setS] = useState<Settings>(TOOL_BROKER_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/factory/control", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("도구 요청 중계 설정을 읽지 못했어요.");
        const data = await res.json();
        if (alive) {
          setS(normalizeToolBroker(data.toolBroker));
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (alive) setNotice(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    if (s.mode === "allow" && !window.confirm("AI 의 도구 요청을 감독 프로그램이 실행하게 할까요? (허용 목록의 도구만)")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/factory/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolBroker: s }),
      });
      const data = await res.json();
      setNotice(data.message || "저장하지 못했어요.");
      if (res.ok) setS(normalizeToolBroker(data.toolBroker));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  // 비워 두거나 0 이면 제한 없음. 범위 밖 값은 저장할 때 서버가 상한·하한으로 맞춘다
  const num = (k: "maxRequests" | "toolTimeoutSec", label: string) => (
    <label className="flex items-center gap-1 text-sm">
      <span className="text-default-500">{label}</span>
      <input
        className="w-24 rounded border border-default-300 bg-transparent px-2 py-1"
        disabled={!loaded || busy}
        max={TOOL_BROKER_LIMITS[k][1]}
        min={0}
        placeholder="제한 없음"
        type="number"
        value={s[k] > 0 ? s[k] : ""}
        onChange={(e) => setS({ ...s, [k]: Math.max(0, Math.floor(Number(e.target.value)) || 0) })}
      />
    </label>
  );

  return (
    <div className="space-y-3 rounded-lg border border-default-200 p-4">
      <h2 className="font-semibold">도구 요청 중계</h2>
      <p className="text-sm text-default-500">
        AI(Claude·Codex)는 앱 폴더에 요청서만 쓰고, 감독 프로그램이 허용된 도구만 대신 실행해 결과를 폴더에 돌려줘요. AI 의 샌드박스·네트워크 권한은 그대로예요.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1 text-sm">
          <span className="text-default-500">모드</span>
          <select
            className="rounded border border-default-300 bg-transparent px-2 py-1"
            disabled={!loaded || busy}
            value={s.mode}
            onChange={(e) => isToolBrokerMode(e.target.value) && setS({ ...s, mode: e.target.value })}
          >
            {TOOL_BROKER_MODES.map((m) => (
              <option key={m} value={m}>
                {TOOL_BROKER_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        {num("maxRequests", "일감당 요청")}
        {num("toolTimeoutSec", "제한 시간(초)")}
        <Button isDisabled={!loaded || busy} size="sm" variant="flat" onPress={save}>
          설정 저장
        </Button>
      </div>
      <p className="text-xs text-default-500">{MODE_HELP[s.mode]}</p>
      <p className="text-xs text-default-500">
        일감당 요청·제한 시간은 비워 두면 제한 없음이에요. 제한이 없어도 일감이 끝나거나 취소되거나 감독 프로그램이 꺼지면 돌던 도구는 정리돼요.
      </p>
      {notice && (
        <p className="text-sm" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
