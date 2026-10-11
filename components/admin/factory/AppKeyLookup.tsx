// components/admin/factory/AppKeyLookup.tsx
// 출시 패키지 앱 카드의 [🔑 키 조회]: 작업 PC 가 이 앱 폴더 하나만 점검해(키 점검과 같은 로직) 결과를 카드에 보여 준다.
// 앱 자체 키(.jks·.keystore 경로·별칭·SHA-1 지문), key.properties 위치, git 추적 여부. 비밀번호는 읽지도 보여 주지도 않는다.
// 앱 자체 키가 있으면 [이 키를 이 앱 키로 지정]으로 '다른 키 사용' 칸(경로·별칭)을 채운다(저장은 사람이 [저장]).
"use client";

import { Button } from "@heroui/react";

import type { KeyScanApp } from "./releaseTypes";

const STALE_MS = 3 * 60 * 1000;
const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("ko-KR") : "-");

export default function AppKeyLookup({
  scan,
  request,
  busy,
  onLookup,
  onUseKey,
}: {
  scan: KeyScanApp | null;
  request: { requestedAt: string; takenAt: string | null } | null;
  busy: boolean;
  onLookup: () => void;
  onUseKey: (path: string, alias: string) => void;
}) {
  const stale = request ? Date.now() - Date.parse(request.requestedAt) > STALE_MS : false;
  const hasOwn = !!scan && !scan.missing && (scan.keys.length > 0 || scan.keyProperties.length > 0);

  return (
    <div className="space-y-2 rounded-lg border border-default-200 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button className="min-h-11 sm:min-h-0" isDisabled={busy || (!!request && !stale)} size="sm" variant="flat" onPress={onLookup}>
          🔑 키 조회
        </Button>
        <span className="text-xs text-default-500">
          {request
            ? stale
              ? `응답이 없어요(요청 ${fmt(request.requestedAt)}). 작업 PC 가 꺼져 있을 수 있어요. 다시 눌러 보세요.`
              : request.takenAt
                ? "작업 PC 가 점검 중이에요…"
                : "점검 요청함: 작업 PC 가 15초 안에 가져가요…"
            : scan?.at
              ? `마지막 조회: ${fmt(scan.at)}`
              : "아직 조회하지 않았어요. 이 앱 폴더의 키만 확인해요(비밀번호는 읽지 않아요)."}
        </span>
      </div>
      {scan &&
        (scan.missing ? (
          <p className="text-sm">📁 작업 PC 에 이 앱 폴더가 없어요.</p>
        ) : !hasOwn ? (
          <p className="text-sm">앱 자체 키 없음 → 계정 공용 키 사용 예정(없으면 첫 출시 때 새로 만듦)</p>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="font-medium">✅ 앱 자체 키 있음</p>
            {scan.keyProperties.map((k) => (
              <div key={k.path} className="text-xs">
                key.properties: <code className="break-all">{k.path}</code>
                {k.gitTracked ? (
                  <b className="text-danger"> ⚠️ git 추적 중(비밀번호가 커밋됐을 수 있어요. git 에서 빼고 비밀번호를 바꾸세요)</b>
                ) : k.gitTracked === false ? (
                  " · git 제외"
                ) : (
                  ""
                )}
                <div className="pl-2 text-default-600">
                  storeFile: {k.storeFile ?? "-"} · keyAlias: {k.keyAlias ?? "-"}
                </div>
              </div>
            ))}
            {scan.keys.map((k) => (
              <div key={k.path} className="text-xs">
                키 파일: <code className="break-all">{k.abs ?? k.path}</code> ({k.type})
                {k.gitTracked ? <b className="text-danger"> ⚠️ git 추적 중(키 파일이 커밋됐어요)</b> : k.gitTracked === false ? " · git 제외" : ""}
                {k.note ? <span className="text-default-500"> — {k.note}</span> : null}
                {k.aliases.map((x) => (
                  <div key={x.alias} className="flex flex-wrap items-center gap-2 pl-2 text-default-600">
                    <span>
                      별칭 {x.alias} · SHA-1 <code className="break-all">{x.sha1 ?? "지문 못 읽음"}</code>
                    </span>
                    <Button
                      className="min-h-11 sm:min-h-0"
                      isDisabled={busy || !k.abs}
                      size="sm"
                      variant="light"
                      onPress={() => k.abs && onUseKey(k.abs, x.alias)}
                    >
                      이 키를 이 앱 키로 지정
                    </Button>
                  </div>
                ))}
                {!k.abs && <div className="pl-2 text-default-500">PC 절대 경로가 없어 지정할 수 없어요(작업 PC 감독 프로그램 업데이트 뒤 다시 조회).</div>}
              </div>
            ))}
            {scan.keyProperties.length > 0 && (
              <p className="text-xs text-default-500">이 앱은 자체 키(key.properties)로 이미 빌드돼요. 지정하지 않아도 돼요.</p>
            )}
          </div>
        ))}
    </div>
  );
}
