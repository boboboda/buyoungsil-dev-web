// components/admin/factory/AppSlotsSettings.tsx
// 통제실 [설정] '동시에 만들 앱 수'(1~4). 저장하면 서버 설정에 남고, 감독 프로그램이 다음 /next 확인 때 받아 간다.
// '지금 진행 중 N / 최대 M' 은 감독 프로그램 카드와 같은 /api/admin/factory/control 값이다.
"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/react";

import SettingsCard, { ChoiceRow } from "./SettingsCard";
import { postControl, useFactoryControl } from "./useFactoryControl";

export const APP_SLOT_CHOICES = [1, 2, 3, 4] as const;
export const SLOTS_WARNING =
  "동시에 많이 돌릴수록 PC 메모리·CPU 와 Claude/Codex 한도를 빨리 써요. 기본 모델이 비싼 모델이면 한도가 돌리는 개수만큼(3개면 3배 속도로) 줄 수 있어요.";

export interface SlotsState {
  appSlots?: number; // 예전 서버에는 없다
  appSlotsDefault?: boolean; // true = 통제실에서 정한 적 없음(기본 3)
  running: number;
}

/** 화면에 보일 문장들(시험용으로 따로 둠) */
export function slotsSummary(s: SlotsState) {
  const max = s.appSlots;

  return {
    current: max === undefined ? "이 서버는 아직 이 설정을 몰라요(PC 설정값을 써요)" : `현재 ${max}개${s.appSlotsDefault ? " (정한 적 없어서 기본값)" : ""}`,
    live: max === undefined ? `지금 진행 중 ${s.running}` : `지금 진행 중 ${s.running} / 최대 ${max}`,
    over: max !== undefined && s.running > max ? `값을 줄여서 ${s.running - max}개가 넘치지만 돌던 일감은 끊지 않고, 끝나면서 줄어요.` : "",
  };
}

export default function AppSlotsSettings() {
  const { data: s } = useFactoryControl<SlotsState>();
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (s) setPick((p) => p ?? s.appSlots ?? null);
  }, [s]);

  const save = async () => {
    if (pick === null) return;
    setBusy(true);
    try {
      const { ok, data } = await postControl<SlotsState>({ appSlots: pick });

      setNotice(data.message ?? (ok ? "저장했어요." : "저장하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return <AppSlotsView busy={busy} notice={notice} pick={pick} s={s} onPick={setPick} onSave={save} />;
}

/** 화면만 그린다(상태는 AppSlotsSettings 가 들고 있음. 시험·미리보기가 값을 넣어 볼 수 있게 따로 뺌) */
export function AppSlotsView({
  s,
  pick,
  busy = false,
  notice = "",
  onPick = () => {},
  onSave = () => {},
}: {
  s: SlotsState | null;
  pick: number | null;
  busy?: boolean;
  notice?: string;
  onPick?: (n: number) => void;
  onSave?: () => void;
}) {
  const sum = s ? slotsSummary(s) : null;
  const supported = s?.appSlots !== undefined;

  return (
    <SettingsCard
      attrs={{ "data-title": "settings · 동시에 만들 앱 수", "data-app-slots": "" }}
      description="승인된 앱 일감을 한 번에 몇 개까지 같이 만들지 정해요(1~4개). 같은 앱의 일감은 개수가 남아도 하나씩만 돌고, 공장 정비가 대기·진행 중이어도 앱 일감은 계속 돌아요(감독 프로그램 업데이트·서버 배포를 앞두고 진행 중 일감이 끝나길 기다릴 때만 새 일감을 받지 않아요)."
      help={[
        "이 값은 감독 프로그램이 다음 확인 때 받아 가요(보통 15초 안, 재시작은 필요 없어요). 줄여도 이미 도는 일감은 끊지 않고, 늘리면 대기 중인 승인된 일감을 다음 확인 때 더 가져가요.",
        "통제실에서 정한 적이 없으면 3개로 돌아요. 단 이 PC 설정 파일에 slots 를 1이나 4처럼 따로 정해 둔 경우는 통제실에서 저장하기 전까지 그 값을 써요.",
      ]}
      notice={notice}
      title="동시에 만들 앱 수"
    >
      <div className="flex flex-wrap items-center gap-3">
        <ChoiceRow label="동시에 만들 앱 수">
          {APP_SLOT_CHOICES.map((n) => (
            <Button
              key={n}
              aria-pressed={pick === n}
              className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
              color={pick === n ? "primary" : "default"}
              data-slot-choice={n}
              isDisabled={!supported || busy}
              size="sm"
              variant={pick === n ? "solid" : "flat"}
              onPress={() => onPick(n)}
            >
              {n}개
            </Button>
          ))}
        </ChoiceRow>
        <Button data-slots-save="" isDisabled={!supported || busy || pick === null || pick === s?.appSlots} size="sm" variant="flat" onPress={onSave}>
          저장
        </Button>
      </div>
      {sum && (
        <div className="space-y-1 text-sm" data-slots-status="">
          <p data-slots-current="">{sum.current}</p>
          <p className="font-mono font-semibold" data-slots-live="">{sum.live}</p>
          {sum.over && <p className="text-default-500">{sum.over}</p>}
        </div>
      )}
      <p className="text-sm font-medium text-warning-600" data-slots-warning="">{SLOTS_WARNING}</p>
      <p className="text-sm">
        <a className="underline" data-slots-usage-link="" href="/admin/factory?tab=usage">
          [사용량] 탭에서 한도 게이지와 장비 상태(RAM) 보기
        </a>
      </p>
    </SettingsCard>
  );
}

export const PER_APP_CHOICES = [1, 2, 3, 4] as const;

/**
 * 통제실 [설정] '같은 앱에서 같이 돌릴 수'(병행 그룹 일감 기준, 1~4, 기본 2). 서버가 일감을 내줄 때 바로 쓴다(감독 프로그램 재시작 필요 없음).
 * 공장 전체 동시 실행 수는 위의 '동시에 만들 앱 수'(기본 3)가 정한다. 병행 일감도 그 수에 하나씩 센다.
 */
export function ParallelPerAppSettings() {
  const { data } = useFactoryControl<{ parallelPerApp?: number; parallelPerAppDefault?: boolean }>();
  const current = typeof data?.parallelPerApp === "number" ? { value: data.parallelPerApp, isDefault: data.parallelPerAppDefault === true } : null;
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (typeof data?.parallelPerApp === "number") setPick((p) => p ?? data.parallelPerApp ?? null);
  }, [data]);

  const save = async () => {
    if (pick === null) return;
    setBusy(true);
    try {
      const { ok, data: d } = await postControl({ parallelPerApp: pick });

      setNotice(d.message ?? (ok ? "저장했어요." : "저장하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      attrs={{ "data-title": "settings · 같은 앱에서 같이 돌릴 수", "data-per-app": "" }}
      description="앱 대기열에서 [같이 돌리기]로 묶은 수정 일감을 같은 앱에서 동시에 몇 개까지 돌릴지 정해요(1~4개, 기본 2개). 묶지 않은 일감은 지금처럼 앱당 1개예요. 병행 일감은 앱 폴더가 아니라 작업 사본(git worktree)에서 돌고, 끝난 순서대로 기본 브랜치에 합쳐요. 공장 전체 동시 실행 수는 위의 ‘동시에 만들 앱 수’가 정해요."
      notice={notice}
      title="같은 앱에서 같이 돌릴 수"
    >
      <div className="flex flex-wrap items-center gap-3">
        <ChoiceRow label="같은 앱에서 같이 돌릴 수">
          {PER_APP_CHOICES.map((n) => (
            <Button key={n} aria-pressed={pick === n} className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" color={pick === n ? "primary" : "default"} data-per-app-choice={n} isDisabled={busy || current === null} size="sm" variant={pick === n ? "solid" : "flat"} onPress={() => setPick(n)}>
              {n}개
            </Button>
          ))}
        </ChoiceRow>
        <Button data-per-app-save="" isDisabled={busy || pick === null || pick === current?.value} size="sm" variant="flat" onPress={save}>
          저장
        </Button>
      </div>
      {current && <p className="text-sm" data-per-app-current="">{`현재 ${current.value}개${current.isDefault ? " (정한 적 없어서 기본값)" : ""}`}</p>}
    </SettingsCard>
  );
}

export const APPROVAL_WAIT_CHOICES = [0, 30, 60, 120, 300] as const;

/**
 * 통제실 [설정] '승인 직후 다른 승인 기다리는 시간'(0~300초, 기본 60초). 같은 앱에 승인 대기 수정 일감이 또 있으면, 방금 승인된 일감을 바로 시작하지 않고
 * 마지막 승인 뒤 이 시간만큼 기다려요(연달아 승인하면 지휘자가 묶을 수 있게). 0이면 기다리지 않아요. 자동 묶기가 꺼져 있거나 같은 앱 동시 수가 1이면 기다리지 않아요.
 */
export function ApprovalWaitSettings() {
  const { data } = useFactoryControl<{ approvalWaitSec?: number; approvalWaitSecDefault?: boolean }>();
  const current = typeof data?.approvalWaitSec === "number" ? { value: data.approvalWaitSec, isDefault: data.approvalWaitSecDefault === true } : null;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (typeof data?.approvalWaitSec === "number") setText((t) => (t === "" ? String(data.approvalWaitSec) : t));
  }, [data]);

  const n = /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : NaN;
  const valid = Number.isInteger(n) && n >= 0 && n <= 300;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const { ok, data: d } = await postControl({ approvalWaitSec: n });

      setNotice(d.message ?? (ok ? "저장했어요." : "저장하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      attrs={{ "data-title": "settings · 승인 직후 기다리는 시간", "data-approval-wait": "" }}
      description="같은 앱에 승인 대기 중인 수정 일감이 또 있으면, 방금 승인한 일감을 바로 시작하지 않고 마지막 승인 뒤 이 시간만큼 기다려요(0~300초, 기본 60초). 그동안 연달아 승인하면 지휘자가 겹치는지 보고 같이 돌릴 수 있어요. 0이면 승인 즉시 시작해요. 자동 묶기가 꺼져 있거나 같은 앱에서 같이 돌릴 수가 1이면 기다리지 않아요."
      notice={notice}
      title="승인 직후 기다리는 시간"
    >
      <div className="flex flex-wrap items-center gap-3">
        <ChoiceRow label="승인 직후 기다리는 시간">
          {APPROVAL_WAIT_CHOICES.map((c) => (
            <Button key={c} aria-pressed={text.trim() === String(c)} className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" color={text.trim() === String(c) ? "primary" : "default"} data-approval-wait-choice={c} isDisabled={busy || current === null} size="sm" variant={text.trim() === String(c) ? "solid" : "flat"} onPress={() => setText(String(c))}>
              {c === 0 ? "기다리지 않음" : `${c}초`}
            </Button>
          ))}
        </ChoiceRow>
        <label className="flex items-center gap-1 text-sm">
          직접 입력
          <input aria-label="승인 직후 기다리는 시간(초)" className="w-20 rounded border border-default-300 px-2 py-1" data-approval-wait-input="" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} />초
        </label>
        <Button data-approval-wait-save="" isDisabled={busy || !valid || n === current?.value} size="sm" variant="flat" onPress={save}>
          저장
        </Button>
      </div>
      {current && <p className="text-sm" data-approval-wait-current="">{current.value === 0 ? "현재: 기다리지 않음" : `현재 ${current.value}초`}{current.isDefault ? " (정한 적 없어서 기본값)" : ""}</p>}
      {text !== "" && !valid && <p className="text-sm text-danger-600">0~300 사이 정수로 적어 주세요.</p>}
    </SettingsCard>
  );
}

export const UPDATE_BUNDLE_CHOICES = [0, 15, 30, 60, 120, 180] as const;

/**
 * 통제실 [설정] '감독 업데이트 묶는 시간'(0~180분, 기본 60분). 감독 프로그램 새 버전이 있어도 일감이 돌고 있으면 새 커밋을 이 시간까지 모았다가 한 번에 받아요
 * (그동안 일감은 막지 않아요). 공장이 비어 있으면 바로 받고, 받을 때는 진행 중인 AI 를 안전한 지점에서 잠깐 멈췄다가 새 버전에서 같은 세션으로 이어서 해요.
 * 0이면 묶지 않고 바로 받아요. 통제실 [지금 업데이트]는 이 시간을 기다리지 않아요.
 */
export function UpdateBundleSettings() {
  const { data } = useFactoryControl<{ updateBundleMin?: number; updateBundleMinDefault?: boolean }>();
  const current = typeof data?.updateBundleMin === "number" ? { value: data.updateBundleMin, isDefault: data.updateBundleMinDefault === true } : null;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (typeof data?.updateBundleMin === "number") setText((t) => (t === "" ? String(data.updateBundleMin) : t));
  }, [data]);

  const n = /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : NaN;
  const valid = Number.isInteger(n) && n >= 0 && n <= 180;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const { ok, data: d } = await postControl({ updateBundleMin: n });

      setNotice(d.message ?? (ok ? "저장했어요." : "저장하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      attrs={{ "data-title": "settings · 감독 업데이트 묶는 시간", "data-update-bundle-settings": "" }}
      description="감독 프로그램 새 버전이 있어도 일감이 돌고 있으면 새 커밋을 이 시간까지 모았다가 한 번에 받아요(0~180분, 기본 60분). 모으는 동안 일감은 막지 않아요. 공장이 비어 있으면 바로 받고, 받을 때는 진행 중인 AI 를 안전한 지점에서 잠깐 멈췄다가 새 버전에서 같은 세션으로 이어서 해요. 0이면 묶지 않고 바로 받아요. [지금 업데이트]는 기다리지 않아요."
      notice={notice}
      title="감독 업데이트 묶는 시간"
    >
      <div className="flex flex-wrap items-center gap-3">
        <ChoiceRow label="묶는 시간">
          {UPDATE_BUNDLE_CHOICES.map((c) => (
            <Button key={c} aria-pressed={text.trim() === String(c)} className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" color={text.trim() === String(c) ? "primary" : "default"} data-update-bundle-choice={c} isDisabled={busy || current === null} size="sm" variant={text.trim() === String(c) ? "solid" : "flat"} onPress={() => setText(String(c))}>
              {c === 0 ? "바로 받기" : `${c}분`}
            </Button>
          ))}
        </ChoiceRow>
        <label className="flex items-center gap-1 text-sm">
          직접 입력
          <input aria-label="업데이트 묶는 시간(분)" className="w-20 rounded border border-default-300 px-2 py-1" data-update-bundle-input="" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} />분
        </label>
        <Button data-update-bundle-save="" isDisabled={busy || !valid || n === current?.value} size="sm" variant="flat" onPress={save}>
          저장
        </Button>
      </div>
      {current && <p className="text-sm" data-update-bundle-current="">{current.value === 0 ? "현재: 묶지 않고 바로 받기" : `현재 최대 ${current.value}분 모음`}{current.isDefault ? " (정한 적 없어서 기본값)" : ""}</p>}
      {text !== "" && !valid && <p className="text-sm text-danger-600">0~180 사이 정수로 적어 주세요.</p>}
    </SettingsCard>
  );
}

interface ConductorState {
  autoGroup: boolean;
  model: string;
  modelIsDefault: boolean;
  sharedFiles: string[];
  sharedFilesIsDefault: boolean;
  log: { at: string; appSlug: string; model: string | null; ok: boolean; outcome: string; ms: number | null; costUsd: number | null }[];
}

export const CONDUCTOR_MODELS = ["haiku", "sonnet", "opus"] as const;

/**
 * 통제실 [설정] '지휘자(자동 묶기)'(단계 C-2): 같은 앱에 승인된 수정 일감이 2개 이상 쌓이면 읽기 전용 AI 가 겹치는지 보고 안전할 때만 자동으로 '같이 돌리기'로 묶는다.
 * 켜기·끄기(기본 켜기), 모델(기본 haiku), 공용 파일 목록(건드리면 순서대로 두는 파일 패턴), 최근 판단 기록(지휘자 턴을 따로 표시).
 */
export function ConductorSettings() {
  const { data } = useFactoryControl<{ conductor?: ConductorState }>();
  const s = data?.conductor ?? null;
  const [files, setFiles] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (s) setFiles((f) => f ?? s.sharedFiles.join("\n"));
  }, [s]);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const { ok, data: d } = await postControl<{ conductor?: ConductorState }>(body);

      setNotice(d.message ?? (ok ? "저장했어요." : "저장하지 못했어요."));
      if (ok && d.conductor) setFiles(d.conductor.sharedFiles.join("\n"));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      attrs={{ "data-title": "settings · 지휘자(자동 묶기)", "data-conductor": "" }}
      description="같은 앱에 승인된 수정 일감이 2개 이상 쌓이면, 읽기 전용 AI 가 일감이 서로 겹치지 않는지 보고 안전할 때만 자동으로 ‘같이 돌리기’로 묶어요. 예상 파일이 겹치거나, 확신이 높지 않거나, 의존성·라우터·스키마·번역 같은 공용 파일을 건드리면 묶지 않고 순서대로 둬요. 끄면 사람이 묶은 것만 같이 돌아요. 사람이 직접 묶거나 푼 일감은 지휘자가 바꾸지 않아요."
      notice={notice}
      title="지휘자(자동 묶기)"
    >
      {s ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button aria-pressed={s.autoGroup} color={s.autoGroup ? "primary" : "default"} data-conductor-toggle="" isDisabled={busy} size="sm" variant={s.autoGroup ? "solid" : "flat"} onPress={() => send({ conductorAutoGroup: !s.autoGroup })}>
              {s.autoGroup ? "자동 묶기 켜짐" : "자동 묶기 꺼짐"}
            </Button>
            <ChoiceRow label="지휘자 모델">
              {CONDUCTOR_MODELS.map((m) => (
                <Button key={m} aria-pressed={s.model === m} color={s.model === m ? "primary" : "default"} data-conductor-model={m} isDisabled={busy} size="sm" variant={s.model === m ? "solid" : "flat"} onPress={() => send({ conductorModel: m })}>
                  {m}
                </Button>
              ))}
            </ChoiceRow>
            <span className="text-sm" data-conductor-current="">{`모델 ${s.model}${s.modelIsDefault ? " (기본)" : ""}`}</span>
          </div>
          <label className="block text-sm">
            공용 파일 패턴(한 줄에 하나, 건드리면 순서대로 둬요{s.sharedFilesIsDefault ? " · 지금 기본 목록" : ""})
            <textarea className="mt-1 h-32 w-full rounded border border-default-300 p-2 font-mono text-xs" data-conductor-shared="" value={files ?? ""} onChange={(e) => setFiles(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button data-conductor-shared-save="" isDisabled={busy || files === null} size="sm" variant="flat" onPress={() => send({ conductorSharedFiles: files })}>
              목록 저장
            </Button>
            <Button isDisabled={busy} size="sm" variant="flat" onPress={() => send({ conductorSharedFiles: null })}>
              기본값으로
            </Button>
          </div>
          {s.log.length ? (
            <div className="min-w-0 space-y-1 break-words text-xs text-default-500" data-conductor-log="">
              <div className="font-semibold">최근 지휘자 판단(비용 기록에 ‘지휘자’로 따로 표시)</div>
              {s.log.map((r) => (
                <div key={`${r.at}-${r.appSlug}`}>{`[지휘자] ${r.at.slice(5, 16).replace("T", " ")} ${r.appSlug} · ${r.model ?? "?"} · ${r.outcome}${r.costUsd !== null ? ` · $${r.costUsd.toFixed(4)}` : ""}${r.ms !== null ? ` · ${Math.round(r.ms / 1000)}초` : ""}`}</div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </SettingsCard>
  );
}
