// components/admin/factory/AppKeyLookup.tsx
// 출시 카드 보조 기능: '이 앱 폴더에서 키 파일 후보 찾기'. 작업 PC 가 이 앱 폴더만 훑어 .jks·.keystore·.p12 와
// 확장자 없는 JKS 파일(2KB~100KB, 매직 0xFEEDFEED. 예: Untitled), key.properties 를 찾아 경로·형식·별칭·SHA-1·git 추적 여부만 알려 준다.
// 후보는 [보관함에 등록]으로 설정 → 키 보관함의 [기존 키 등록] 칸에 경로·별칭을 채워 넘긴다(비밀번호는 거기서 입력).
// 비밀번호는 읽지도 보여 주지도 않는다.
"use client";

import { Button } from "@heroui/react";

import type { KeyScanApp } from "./releaseTypes";

const STALE_MS = 3 * 60 * 1000;
const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("ko-KR") : "-");

const registerHref = (appSlug: string, path: string, alias: string | undefined) =>
  `/admin/factory/settings?${new URLSearchParams({ registerPath: path, registerAlias: alias ?? "upload", registerName: `${appSlug} 키` })}#key-vault`;

export default function AppKeyLookup({
  appSlug,
  scan,
  request,
  busy,
  onLookup,
}: {
  appSlug: string;
  scan: KeyScanApp | null;
  request: { requestedAt: string; takenAt: string | null } | null;
  busy: boolean;
  onLookup: () => void;
}) {
  const stale = request ? Date.now() - Date.parse(request.requestedAt) > STALE_MS : false;
  const found = !!scan && !scan.missing && (scan.keys.length > 0 || scan.keyProperties.length > 0);

  return (
    <details className="rounded-lg border border-default-200 p-2" open={!!request || found}>
      <summary className="cursor-pointer text-xs text-default-600">📂 이 앱 폴더에서 키 파일 후보 찾기 (보조)</summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button className="min-h-11 sm:min-h-0" isDisabled={busy || (!!request && !stale)} size="sm" variant="light" onPress={onLookup}>
            후보 찾기
          </Button>
          <span className="text-xs text-default-500">
            {request
              ? stale
                ? `응답이 없어요(요청 ${fmt(request.requestedAt)}). 작업 PC 가 꺼져 있을 수 있어요. 다시 눌러 보세요.`
                : request.takenAt
                  ? "작업 PC 가 찾는 중…"
                  : "요청함: 작업 PC 가 15초 안에 가져가요…"
              : scan?.at
                ? `마지막으로 찾은 시각: ${fmt(scan.at)}`
                : "키 파일 위치를 모를 때만 쓰세요. 확장자 없는 키 파일(예: Untitled)도 찾아요."}
          </span>
        </div>
        {scan &&
          (scan.missing ? (
            <p className="text-sm">📁 작업 PC 에 이 앱 폴더가 없어요.</p>
          ) : !found ? (
            <p className="text-sm">이 앱 폴더에서 키 파일 후보를 찾지 못했어요.</p>
          ) : (
            <div className="space-y-2 text-xs">
              {scan.keys.map((k) => (
                <div key={k.path}>
                  후보: <code className="break-all">{k.abs ?? k.path}</code> ({k.type})
                  {k.gitTracked ? <b className="text-danger"> ⚠️ git 추적 중(키 파일이 커밋됐어요)</b> : k.gitTracked === false ? " · git 제외" : ""}
                  {k.note ? <span className="text-default-500"> — {k.note}</span> : null}
                  {k.aliases.map((x) => (
                    <div key={x.alias} className="pl-2 text-default-600">
                      별칭 {x.alias} · SHA-1 <code className="break-all">{x.sha1 ?? "지문 못 읽음"}</code>
                    </div>
                  ))}
                  {k.abs ? (
                    <a className="pl-2 text-primary underline" href={registerHref(appSlug, k.abs, k.aliases[0]?.alias)}>
                      보관함에 등록(설정 → 키 보관함 [기존 키 등록])
                    </a>
                  ) : (
                    <div className="pl-2 text-default-500">PC 절대 경로가 없어요(작업 PC 감독 프로그램 업데이트 뒤 다시 찾기).</div>
                  )}
                </div>
              ))}
              {scan.keyProperties.map((k) => (
                <div key={k.path}>
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
              {scan.keyProperties.length > 0 && <p className="text-default-500">이 앱은 자체 키(key.properties)로 이미 빌드돼요. 키를 고르지 않아도 돼요.</p>}
            </div>
          ))}
      </div>
    </details>
  );
}
