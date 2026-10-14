"use client";

// components/admin/factory/useFactoryControl.ts
// 통제실이 /api/admin/factory/control 을 읽는 유일한 길. 카드 여러 개가 같이 쓰면 요청은 한 번(5초마다)만 나간다.
// 쓰는 카드가 하나도 없으면 폴링도 멈춘다. 저장(POST) 응답이 같은 모양의 값이면 publish 로 모두에게 바로 알린다.
import { useCallback, useEffect, useState } from "react";

export const CONTROL_URL = "/api/admin/factory/control";
export const CONTROL_REFRESH_MS = 5000;

type Listener = (data: unknown) => void;

const listeners = new Set<Listener>();
let latest: unknown = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

/** 한 번만 요청한다(이미 가는 중이면 그 요청을 같이 기다림). 못 읽으면 이전 값을 그대로 둔다 */
export function reloadControl(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch(CONTROL_URL, { cache: "no-store" })
    .then(async (res) => {
      if (res.ok) publishControl(await res.json());
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function publishControl(data: unknown) {
  latest = data;
  listeners.forEach((fn) => fn(data));
}

/** 서버 설정 전체(감독 상태 + 설정값). 처음엔 null. */
export function useFactoryControl<T = Record<string, unknown>>(): { data: T | null; reload: () => Promise<void>; publish: (d: unknown) => void } {
  const [data, setData] = useState<T | null>((latest as T | null) ?? null);

  useEffect(() => {
    const fn: Listener = (d) => setData(d as T);

    listeners.add(fn);
    if (latest) setData(latest as T);
    void reloadControl();
    if (!timer) timer = setInterval(() => void reloadControl(), CONTROL_REFRESH_MS);

    return () => {
      listeners.delete(fn);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);

  return { data, reload: useCallback(reloadControl, []), publish: publishControl };
}

/** 저장 요청(POST). 성공이면 응답이 감독 상태 전체이므로 모든 카드에 알린다. 돌려주는 값은 카드가 안내문·응답 값에 쓴다 */
export async function postControl<R = Record<string, unknown>>(body: Record<string, unknown>): Promise<{ ok: boolean; data: R & { message?: string } }> {
  const res = await fetch(CONTROL_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as R & { message?: string };

  if (res.ok) publishControl(data);

  return { ok: res.ok, data };
}
