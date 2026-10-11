// components/admin/factory/ReleaseAccounts.tsx
// 배포 계정 A/B 프로필과 키 준비 상태 체크리스트. 키 파일은 PC 경로만 저장하고, PC 에 파일이 "있는지"는 감독 프로그램이 알려 준다.
// 키 값·비밀번호는 여기로 오가지 않는다.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

import { fmtDate, postRelease, type ReleaseAccount, type ReleaseOverview } from "./releaseTypes";

type Form = {
  label: string;
  name: string;
  requiresTesting: boolean;
  developerName: string;
  contactEmail: string;
  keystorePath: string;
  keyAlias: string;
  serviceAccountKeyPath: string;
  notes: string;
};

const LABELS = ["A", "B"];

const toForm = (label: string, a?: ReleaseAccount): Form => ({
  label,
  name: a?.name ?? "",
  requiresTesting: a?.requiresTesting ?? label === "A",
  developerName: a?.developerName ?? "",
  contactEmail: a?.contactEmail ?? "",
  keystorePath: a?.keystorePath ?? "",
  keyAlias: a?.keyAlias ?? "",
  serviceAccountKeyPath: a?.serviceAccountKeyPath ?? "",
  notes: a?.notes ?? "",
});

const input = "w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm";

export default function ReleaseAccounts() {
  const [data, setData] = useState<ReleaseOverview | null>(null);
  const [forms, setForms] = useState<Record<string, Form>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = (d: ReleaseOverview) => {
    setData(d);
    setForms(Object.fromEntries(LABELS.map((l) => [l, toForm(l, d.accounts.find((a) => a.label === l))])));
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/release", { cache: "no-store" });

      if (res.ok) apply((await res.json()) as ReleaseOverview);
    } catch {
      /* 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (label: string) => {
    setBusy(true);
    setNotice(null);
    const { ok, data: d } = await postRelease({ action: "saveAccount", ...forms[label] });

    if (ok && d.accounts) apply(d as ReleaseOverview);
    setNotice(d.message ?? (ok ? "저장했어요." : "저장하지 못했어요."));
    setBusy(false);
  };

  const set = (label: string, patch: Partial<Form>) => setForms((f) => ({ ...f, [label]: { ...f[label], ...patch } }));
  const pc = (key: string) => data?.pcStatus?.items.find((i) => i.key === key) ?? null;

  const Check = ({ ok, unknown, text }: { ok: boolean; unknown?: boolean; text: string }) => (
    <li className="flex gap-2">
      <span>{unknown ? "⏳" : ok ? "✅" : "⬜"}</span>
      <span className={ok ? "" : "text-default-600"}>{text}</span>
    </li>
  );

  return (
    <Card>
      <CardHeader className="flex flex-col items-start gap-1">
        <span className="font-semibold">🚀 배포 계정 (출시)</span>
        <span className="text-xs text-default-500">
          앱마다 어느 계정으로 낼지 출시 패키지 화면에서 골라요. 키 파일은 PC 경로만 적고, 비밀번호는 PC 의 secrets.env 에만 넣어요.
        </span>
      </CardHeader>
      <CardBody className="space-y-6">
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm dark:bg-warning-50/10">
          <b>⚠️ 서명 키 백업은 꼭 해 두세요.</b> 업로드 키(.jks)와 비밀번호를 잃으면 앱 업데이트를 올릴 수 없어요(Play App Signing 을
          쓰면 업로드 키는 Play Console 에서 재설정을 요청할 수 있지만 며칠 걸려요). 키 파일을 PC 밖 안전한 곳(암호화한 USB, 비밀번호
          관리자 등) 두 군데 이상에 복사하고, 앱 폴더·git·홈페이지에는 절대 두지 마세요.
        </div>
        {!data ? (
          <p className="text-sm text-default-500">읽는 중…</p>
        ) : (
          LABELS.map((label) => {
            const f = forms[label];
            const acc = data.accounts.find((a) => a.label === label);
            const ks = pc(`${label}.keystore`);
            const sa = pc(`${label}.serviceAccount`);

            if (!f) return null;

            return (
              <div key={label} className="space-y-3 border-t border-default-200 pt-4 first:border-0 first:pt-0">
                <div className="font-semibold">계정 {label}</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input className={input} placeholder="이름 (예: 개인 계정)" value={f.name} onChange={(e) => set(label, { name: e.target.value })} />
                  <label className="flex items-center gap-2 text-sm">
                    <input checked={f.requiresTesting} type="checkbox" onChange={(e) => set(label, { requiresTesting: e.target.checked })} />
                    비공개 테스트 필요(테스터 12명·14일)
                  </label>
                  <input className={input} placeholder="스토어 개발자 이름" value={f.developerName} onChange={(e) => set(label, { developerName: e.target.value })} />
                  <input className={input} placeholder="연락 이메일" value={f.contactEmail} onChange={(e) => set(label, { contactEmail: e.target.value })} />
                  <input className={input} placeholder="서명 키 경로 (예: ~/keys/upload-a.jks)" value={f.keystorePath} onChange={(e) => set(label, { keystorePath: e.target.value })} />
                  <input className={input} placeholder="키 별칭 (예: upload)" value={f.keyAlias} onChange={(e) => set(label, { keyAlias: e.target.value })} />
                  <input
                    className={`${input} sm:col-span-2`}
                    placeholder="서비스 계정 키 경로 (Play Developer API, 예: ~/keys/play-a.json)"
                    value={f.serviceAccountKeyPath}
                    onChange={(e) => set(label, { serviceAccountKeyPath: e.target.value })}
                  />
                  <textarea className={`${input} sm:col-span-2`} placeholder="메모" rows={2} value={f.notes} onChange={(e) => set(label, { notes: e.target.value })} />
                </div>
                <Button className="min-h-11 sm:min-h-0" color="primary" isDisabled={busy || !f.name.trim()} size="sm" onPress={() => save(label)}>
                  계정 {label} 저장
                </Button>
                {acc && (
                  <ul className="space-y-1 text-sm">
                    <Check ok={!!acc.developerName && !!acc.contactEmail} text="개발자 이름·연락 이메일" />
                    <Check ok={!!acc.keystorePath} text={`서명 키 경로 등록${acc.keystorePath ? `: ${acc.keystorePath}` : ""}`} />
                    {acc.keystorePath && (
                      <Check
                        ok={!!ks?.exists}
                        text={ks ? (ks.exists ? `PC 에 서명 키 파일 있음 (${fmtDate(ks.mtime)} 수정)` : "PC 에 서명 키 파일이 없어요") : "PC 확인 기다리는 중(감독 프로그램이 15초 안에 확인)"}
                        unknown={!ks}
                      />
                    )}
                    {acc.keystorePath && (
                      <li className="flex gap-2 text-default-600">
                        <span>ℹ️</span>
                        <span>
                          PC 의 ~/dev/factory/secrets.env 에 <code>{acc.secretNames.keystore}</code>, <code>{acc.secretNames.key}</code> 값을 넣어
                          두세요. 홈페이지는 값을 알 수 없어서 확인하지 못해요(없으면 출시 준비 일감이 시작 전에 멈추고 알려 줘요).
                        </span>
                      </li>
                    )}
                    <Check ok={!!acc.serviceAccountKeyPath} text={`서비스 계정 키 경로 등록${acc.serviceAccountKeyPath ? `: ${acc.serviceAccountKeyPath}` : " (비공개 테스트 자동 업로드에 필요)"}`} />
                    {acc.serviceAccountKeyPath && (
                      <Check
                        ok={!!sa?.exists}
                        text={sa ? (sa.exists ? "PC 에 서비스 계정 키 파일 있음" : "PC 에 서비스 계정 키 파일이 없어요") : "PC 확인 기다리는 중"}
                        unknown={!sa}
                      />
                    )}
                  </ul>
                )}
              </div>
            );
          })
        )}
        {data?.pcStatus && <p className="text-xs text-default-500">PC 확인 시각: {new Date(data.pcStatus.at).toLocaleString("ko-KR")}</p>}
        {notice && <p className="text-sm text-default-600">{notice}</p>}
      </CardBody>
    </Card>
  );
}
