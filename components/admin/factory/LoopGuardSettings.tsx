// components/admin/factory/LoopGuardSettings.tsx
// 통제실 [설정] '일감 시간 낭비 막기'(1-3): 같은 시험·빌드 명령 반복 감지(경고 → 막힘)와 스크린샷 단계 시간 상한.
// 저장하면 서버 설정에 남고, 감독 프로그램이 다음 /next 확인 때 받아 간다.
"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";

import SettingsCard, { ChoiceRow } from "./SettingsCard";
import { postControl, useFactoryControl } from "./useFactoryControl";

export interface LoopGuardState {
  enabled: boolean;
  repeatMax: number;
  judge: "any" | "result" | "count";
  minChangedFiles: number;
  screenshotMaxMin: number;
}

export const LOOP_JUDGE_LABELS: Record<LoopGuardState["judge"], string> = {
  any: "바뀐 파일이 적거나 결과가 같으면",
  result: "결과가 같을 때만",
  count: "횟수만 보고",
};

const intOrNaN = (t: string) => (/^\d{1,3}$/.test(t.trim()) ? Number(t.trim()) : NaN);

export default function LoopGuardSettings() {
  const { data } = useFactoryControl<{ loopGuard?: LoopGuardState; loopGuardDefault?: boolean }>();
  const cur = data?.loopGuard ?? null;
  const [enabled, setEnabled] = useState(true);
  const [judge, setJudge] = useState<LoopGuardState["judge"]>("any");
  const [repeat, setRepeat] = useState("");
  const [changed, setChanged] = useState("");
  const [shots, setShots] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!cur) return;
    setEnabled((e) => (repeat === "" ? cur.enabled : e));
    setJudge((j) => (repeat === "" ? cur.judge : j));
    setRepeat((t) => (t === "" ? String(cur.repeatMax) : t));
    setChanged((t) => (t === "" ? String(cur.minChangedFiles) : t));
    setShots((t) => (t === "" ? String(cur.screenshotMaxMin) : t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const r = intOrNaN(repeat);
  const c = intOrNaN(changed);
  const s = intOrNaN(shots);
  const valid = r >= 2 && r <= 20 && c >= 0 && c <= 50 && s >= 1 && s <= 120;
  const same = !!cur && cur.enabled === enabled && cur.judge === judge && cur.repeatMax === r && cur.minChangedFiles === c && cur.screenshotMaxMin === s;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const { ok, data: d } = await postControl({ loopGuard: { enabled, judge, repeatMax: r, minChangedFiles: c, screenshotMaxMin: s } });

      setNotice(d.message ?? (ok ? "저장했어요." : "저장하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      attrs={{ "data-title": "settings · 일감 시간 낭비 막기", "data-loop-guard-settings": "" }}
      description="앱 일감이 같은 시험·빌드 명령(e2e, 스크린샷 스크립트, 측정 스크립트, 빌드 등)을 정해진 횟수 넘게 반복하는데 그 사이 바뀐 파일이 적거나 결과가 같으면, AI 에게 '지금 상태로 정리하고 막힌 점을 보고하라'를 한 번 보내요. 그래도 또 반복하면 일감을 '막힘'으로 끝내요(작업 파일은 그대로). 스크린샷 단계는 시간 상한을 넘으면 찍힌 것까지만 올리고 넘어가요."
      notice={notice}
      title="일감 시간 낭비 막기"
    >
      <div className="flex flex-wrap items-center gap-3">
        <ChoiceRow label="반복 시험 감지">
          <Button aria-pressed={enabled} color={enabled ? "primary" : "default"} data-loop-guard-enabled={enabled ? "on" : "off"} isDisabled={busy || cur === null} size="sm" variant={enabled ? "solid" : "flat"} onPress={() => setEnabled((v) => !v)}>
            {enabled ? "켜짐" : "꺼짐"}
          </Button>
        </ChoiceRow>
        <ChoiceRow label="판정">
          {(Object.keys(LOOP_JUDGE_LABELS) as LoopGuardState["judge"][]).map((j) => (
            <Button key={j} aria-pressed={judge === j} color={judge === j ? "primary" : "default"} data-loop-guard-judge={j} isDisabled={busy || cur === null} size="sm" variant={judge === j ? "solid" : "flat"} onPress={() => setJudge(j)}>
              {LOOP_JUDGE_LABELS[j]}
            </Button>
          ))}
        </ChoiceRow>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1 text-sm">
          반복 횟수
          <input aria-label="반복 횟수 기준" className="w-16 rounded border border-default-300 px-2 py-1" data-loop-guard-repeat="" inputMode="numeric" value={repeat} onChange={(e) => setRepeat(e.target.value)} />회 넘게
        </label>
        <label className="flex items-center gap-1 text-sm">
          바뀐 파일
          <input aria-label="바뀐 파일이 적다고 볼 개수" className="w-16 rounded border border-default-300 px-2 py-1" data-loop-guard-changed="" inputMode="numeric" value={changed} onChange={(e) => setChanged(e.target.value)} />개 이하면 적음
        </label>
        <label className="flex items-center gap-1 text-sm">
          스크린샷 단계 상한
          <input aria-label="스크린샷 단계 상한(분)" className="w-16 rounded border border-default-300 px-2 py-1" data-loop-guard-shots="" inputMode="numeric" value={shots} onChange={(e) => setShots(e.target.value)} />분
        </label>
        <Button data-loop-guard-save="" isDisabled={busy || !valid || same} size="sm" variant="flat" onPress={save}>
          저장
        </Button>
      </div>
      {cur && (
        <p className="text-sm" data-loop-guard-current="">
          현재: 반복 감지 {cur.enabled ? "켜짐" : "꺼짐"} · {LOOP_JUDGE_LABELS[cur.judge]} · {cur.repeatMax}회 넘게 · 스크린샷 {cur.screenshotMaxMin}분{data?.loopGuardDefault ? " (정한 적 없어서 기본값)" : ""}
        </p>
      )}
      {(repeat !== "" || changed !== "" || shots !== "") && !valid && <p className="text-sm text-danger-600">반복 횟수 2~20, 바뀐 파일 0~50, 스크린샷 상한 1~120분 정수로 적어 주세요.</p>}
    </SettingsCard>
  );
}
