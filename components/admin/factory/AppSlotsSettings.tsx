// components/admin/factory/AppSlotsSettings.tsx
// 통제실 [설정] '동시에 만들 앱 수'(1~4). 저장하면 서버 설정에 남고, 감독 프로그램이 다음 /next 확인 때 받아 간다.
// '지금 진행 중 N / 최대 M' 은 감독 프로그램 카드와 같은 /api/admin/factory/control 값이다.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@heroui/react";

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
  const [s, setS] = useState<SlotsState | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/control", { cache: "no-store" });

      if (!res.ok) throw new Error();
      const data = (await res.json()) as SlotsState;

      setS(data);
      setPick((p) => p ?? data.appSlots ?? null);
    } catch {
      /* 못 읽으면 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);

    return () => clearInterval(t);
  }, [load]);

  const save = async () => {
    if (pick === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/factory/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appSlots: pick }) });
      const data = (await res.json().catch(() => ({}))) as SlotsState & { message?: string };

      setNotice(data.message ?? (res.ok ? "저장했어요." : "저장하지 못했어요."));
      if (res.ok) setS(data);
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
    <div className="space-y-3 rounded-lg border border-default-200 p-4" data-title="settings · 동시에 만들 앱 수" data-app-slots="">
      <h2 className="font-semibold">동시에 만들 앱 수</h2>
      <p className="text-sm text-default-500">승인된 앱 일감을 한 번에 몇 개까지 같이 만들지 정해요(1~4개). 같은 앱의 일감은 개수가 남아도 하나씩만 돌고, 공장 정비가 대기·진행 중이어도 앱 일감은 계속 돌아요(감독 프로그램 업데이트·서버 배포를 앞두고 진행 중 일감이 끝나길 기다릴 때만 새 일감을 받지 않아요).</p>
      <div className="flex flex-wrap items-center gap-3">
        <div aria-label="동시에 만들 앱 수" className="flex gap-2" role="group">
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
        </div>
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
      <p className="text-sm text-default-500">이 값은 감독 프로그램이 다음 확인 때 받아 가요(보통 15초 안, 재시작은 필요 없어요). 줄여도 이미 도는 일감은 끊지 않고, 늘리면 대기 중인 승인된 일감을 다음 확인 때 더 가져가요.</p>
      <p className="text-sm text-default-500">통제실에서 정한 적이 없으면 3개로 돌아요. 단 이 PC 설정 파일에 slots 를 1이나 4처럼 따로 정해 둔 경우는 통제실에서 저장하기 전까지 그 값을 써요.</p>
      <p className="text-sm font-medium text-warning-600" data-slots-warning="">{SLOTS_WARNING}</p>
      <p className="text-sm">
        <a className="underline" data-slots-usage-link="" href="/admin/factory?tab=usage">
          [사용량] 탭에서 한도 게이지와 장비 상태(RAM) 보기
        </a>
      </p>
      {notice && <p className="text-sm" role="status">{notice}</p>}
    </div>
  );
}

export const PER_APP_CHOICES = [1, 2, 3, 4] as const;

/**
 * 통제실 [설정] '같은 앱에서 같이 돌릴 수'(병행 그룹 일감 기준, 1~4, 기본 2). 서버가 일감을 내줄 때 바로 쓴다(감독 프로그램 재시작 필요 없음).
 * 공장 전체 동시 실행 수는 위의 '동시에 만들 앱 수'(기본 3)가 정한다. 병행 일감도 그 수에 하나씩 센다.
 */
export function ParallelPerAppSettings() {
  const [current, setCurrent] = useState<{ value: number; isDefault: boolean } | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/control", { cache: "no-store" });

      if (!res.ok) throw new Error();
      const data = (await res.json()) as { parallelPerApp?: number; parallelPerAppDefault?: boolean };

      if (typeof data.parallelPerApp === "number") {
        setCurrent({ value: data.parallelPerApp, isDefault: data.parallelPerAppDefault === true });
        setPick((p) => p ?? data.parallelPerApp ?? null);
      }
    } catch {
      /* 못 읽으면 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (pick === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/factory/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parallelPerApp: pick }) });
      const data = (await res.json().catch(() => ({}))) as { message?: string; parallelPerApp?: number; parallelPerAppDefault?: boolean };

      setNotice(data.message ?? (res.ok ? "저장했어요." : "저장하지 못했어요."));
      if (res.ok && typeof data.parallelPerApp === "number") setCurrent({ value: data.parallelPerApp, isDefault: data.parallelPerAppDefault === true });
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-default-200 p-4" data-title="settings · 같은 앱에서 같이 돌릴 수" data-per-app="">
      <h2 className="font-semibold">같은 앱에서 같이 돌릴 수</h2>
      <p className="text-sm text-default-500">앱 대기열에서 [같이 돌리기]로 묶은 수정 일감을 같은 앱에서 동시에 몇 개까지 돌릴지 정해요(1~4개, 기본 2개). 묶지 않은 일감은 지금처럼 앱당 1개예요. 병행 일감은 앱 폴더가 아니라 작업 사본(git worktree)에서 돌고, 끝난 순서대로 기본 브랜치에 합쳐요. 공장 전체 동시 실행 수는 위의 &lsquo;동시에 만들 앱 수&rsquo;가 정해요.</p>
      <div className="flex flex-wrap items-center gap-3">
        <div aria-label="같은 앱에서 같이 돌릴 수" className="flex gap-2" role="group">
          {PER_APP_CHOICES.map((n) => (
            <Button key={n} aria-pressed={pick === n} className="min-h-11 min-w-11 sm:min-h-0 sm:min-w-0" color={pick === n ? "primary" : "default"} data-per-app-choice={n} isDisabled={busy || current === null} size="sm" variant={pick === n ? "solid" : "flat"} onPress={() => setPick(n)}>
              {n}개
            </Button>
          ))}
        </div>
        <Button data-per-app-save="" isDisabled={busy || pick === null || pick === current?.value} size="sm" variant="flat" onPress={save}>
          저장
        </Button>
      </div>
      {current && <p className="text-sm" data-per-app-current="">{`현재 ${current.value}개${current.isDefault ? " (정한 적 없어서 기본값)" : ""}`}</p>}
      {notice && <p className="text-sm" role="status">{notice}</p>}
    </div>
  );
}
