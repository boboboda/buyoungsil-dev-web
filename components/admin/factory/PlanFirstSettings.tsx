// components/admin/factory/PlanFirstSettings.tsx
// 통제실 [설정] '승인 방식' 기본값(5-1). 새 앱·수정 일감을 승인할 때 '바로 시작'(기본)과 '계획 먼저' 중 무엇이 기본으로 골라져 있을지 정한다.
// 승인할 때 일감마다 체크로 바꿀 수 있다. 계획 먼저: 읽기 전용 AI 가 계획(3~6줄)을 내고 사람이 [이대로 진행]·[수정 지시]·[취소]를 고른 뒤 작업자가 시작한다.
"use client";

import { useState } from "react";
import { Button } from "@heroui/react";

import SettingsCard, { ChoiceRow } from "./SettingsCard";
import { postControl, useFactoryControl } from "./useFactoryControl";

export default function PlanFirstSettings() {
  const { data } = useFactoryControl<{ planFirstDefault?: boolean }>();
  const current = typeof data?.planFirstDefault === "boolean" ? data.planFirstDefault : null;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const save = async (value: boolean) => {
    setBusy(true);
    try {
      const { ok, data: d } = await postControl({ planFirstDefault: value });

      setNotice(d.message ?? (ok ? "저장했어요." : "저장하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      attrs={{ "data-title": "settings · 승인 방식", "data-plan-first": "" }}
      description="새 앱·수정 일감을 승인할 때 기본으로 어느 쪽을 고를지 정해요. '바로 시작'은 승인하면 곧 작업을 시작해요(기본). '계획 먼저'는 승인하면 읽기 전용 AI 가 먼저 고칠 파일·순서·위험·예상 시간을 3~6줄로 내고, 통제실과 텔레그램에서 [이대로 진행]·[수정 지시]·[취소]를 고른 뒤에 시작해요. 승인할 때 일감마다 체크로 바꿀 수 있어요. 출시·실험·도구 일감은 늘 바로 시작해요."
      notice={notice}
      title="승인 방식"
    >
      <ChoiceRow label="기본 승인 방식">
        <Button aria-pressed={current === false} color={current === false ? "primary" : "default"} data-plan-first-choice="off" isDisabled={busy || current === null} size="sm" variant={current === false ? "solid" : "flat"} onPress={() => save(false)}>
          바로 시작
        </Button>
        <Button aria-pressed={current === true} color={current === true ? "primary" : "default"} data-plan-first-choice="on" isDisabled={busy || current === null} size="sm" variant={current === true ? "solid" : "flat"} onPress={() => save(true)}>
          계획 먼저
        </Button>
      </ChoiceRow>
      {current !== null && <p className="text-sm" data-plan-first-current="">현재 기본: {current ? "계획 먼저" : "바로 시작"}</p>}
    </SettingsCard>
  );
}
