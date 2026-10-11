// components/admin/factory/ReleaseAccounts.tsx
// 키 보관함(KeyVault)과 배포 계정 A/B 프로필·준비 상태 체크리스트. 계정의 서명 키는 '기본 키: 보관함에서 선택'으로 고른다
// (예전 서명 키 경로·별칭은 서버가 첫 로드 때 보관함 항목으로 가져온다). 키 비밀번호는 보관함 항목마다 보내기만 하고 다시 받지 않는다.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

import Field from "./Field";
import KeyVault, { KeyCheckView, KeyError } from "./KeyVault";
import { KEY_PASSWORD_TEXT, postRelease, type ReleaseAccount, type ReleaseOverview } from "./releaseTypes";

type Form = {
  label: string;
  name: string;
  requiresTesting: boolean;
  developerName: string;
  contactEmail: string;
  defaultKeyId: string;
  serviceAccountKeyPath: string;
  developerAccountId: string;
  accountType: string;
  loginEmail: string;
  notes: string;
};

const LABELS = ["A", "B"];

const toForm = (label: string, a?: ReleaseAccount): Form => ({
  label,
  name: a?.name ?? "",
  requiresTesting: a?.requiresTesting ?? label === "A",
  developerName: a?.developerName ?? "",
  contactEmail: a?.contactEmail ?? "",
  defaultKeyId: a?.defaultKeyId ?? "",
  serviceAccountKeyPath: a?.serviceAccountKeyPath ?? "",
  developerAccountId: a?.developerAccountId ?? "",
  accountType: a?.accountType ?? "",
  loginEmail: a?.loginEmail ?? "",
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

  // 키 보관함·비밀번호 등록 뒤: 화면 데이터만 바꾸고 입력 중인 계정 칸은 그대로 둔다(보관함에서 지운 기본 키만 비움)
  const onSaved = (d: Partial<ReleaseOverview>) => {
    if (!d.accounts || !d.apps || !d.keys) return;
    const ids = new Set(d.keys.map((k) => k.id));

    setData(d as ReleaseOverview);
    setForms((fs) => Object.fromEntries(Object.entries(fs).map(([l, f]) => [l, f.defaultKeyId && !ids.has(f.defaultKeyId) ? { ...f, defaultKeyId: "" } : f])));
  };

  // 키 만들기·조회를 기다리는 동안 10초마다 새로 읽는다(입력 중인 계정 칸은 그대로)
  const waiting = !!data?.keys.some((k) => k.checking || k.untracking || k.createState === "requested" || k.createState === "creating");

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/admin/factory/release", { cache: "no-store" });

        if (res.ok) onSaved((await res.json()) as ReleaseOverview);
      } catch {
        /* 그대로 */
      }
    }, 10_000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const set = (label: string, patch: Partial<Form>) => setForms((f) => ({ ...f, [label]: { ...f[label], ...patch } }));
  const pc = (key: string) => data?.pcStatus?.items.find((i) => i.key === key) ?? null;

  const Check = ({ ok, unknown, text }: { ok: boolean; unknown?: boolean; text: string }) => (
    <li className="flex gap-2">
      <span>{unknown ? "⏳" : ok ? "✅" : "⬜"}</span>
      <span className={ok ? "" : "text-default-600"}>{text}</span>
    </li>
  );

  return (
    <>
    {data && <KeyVault data={data} onSaved={onSaved} />}
    <Card>
      <CardHeader className="flex flex-col items-start gap-1">
        <span className="font-semibold">🚀 배포 계정 (출시)</span>
        <span className="text-xs text-default-500">
          앱마다 어느 계정으로 낼지 출시 패키지 화면에서 골라요. 서명 키는 위 키 보관함에서 골라요(비밀번호는 PC 의 secrets.env 에만).
        </span>
      </CardHeader>
      <CardBody className="space-y-6">
        {!data ? (
          <p className="text-sm text-default-500">읽는 중…</p>
        ) : (
          LABELS.map((label) => {
            const f = forms[label];
            const acc = data.accounts.find((a) => a.label === label);
            const dk = data.keys.find((k) => k.id === acc?.defaultKeyId) ?? null;
            const sa = pc(`${label}.serviceAccount`);

            if (!f) return null;

            return (
              <div key={label} className="space-y-3 border-t border-default-200 pt-4 first:border-0 first:pt-0">
                <div className="font-semibold">계정 {label}</div>
                <p className="text-sm text-default-600">처음 한 번만 채우면 돼요. 아래 목록이 모두 ✅ 가 되면 준비 끝이에요.</p>
                <ul className="space-y-1 text-sm">
                  <Check ok={!!acc?.name} text="내가 알아볼 별명" />
                  <Check ok={!!acc?.developerName && !!acc?.contactEmail} text="개발자 이름·연락 이메일" />
                  <Check ok={!!acc?.developerAccountId} text="Play Console 개발자 계정 ID" />
                  <Check ok={!!acc?.accountType} text="계정 유형(개인/조직)" />
                  <Check ok={!!acc?.loginEmail} text="Play Console 로그인 구글 이메일" />
                  <Check ok={!!dk} text={`기본 키 선택${dk ? `: ${dk.name}` : " (키 보관함에서)"}`} />
                  <Check
                    ok={!!acc?.serviceAccountKeyPath}
                    text={`서비스 계정 키 경로 등록${acc?.serviceAccountKeyPath ? `: ${acc.serviceAccountKeyPath}` : " (비공개 테스트 자동 업로드에 필요)"}`}
                  />
                </ul>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field help="출시 패키지 화면의 계정 선택에 이 이름이 나와요. 짧은 별명만 넣으세요(숫자 ID·이메일 넣지 않기)." label="내가 알아볼 별명">
                    <input className={input} placeholder="예: 개인 계정, 조직 계정" value={f.name} onChange={(e) => set(label, { name: e.target.value })} />
                  </Field>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs font-medium text-default-700">비공개 테스트</span>
                    <label className="flex items-center gap-2 text-sm">
                      <input checked={f.requiresTesting} type="checkbox" onChange={(e) => set(label, { requiresTesting: e.target.checked })} />
                      비공개 테스트 필요(테스터 12명·14일)
                    </label>
                    <span className="break-words text-xs text-default-500">
                      개인 계정(2023년 11월 이후 생성)은 보통 체크, 조직 계정은 보통 해제. Play Console 에서 확인.
                    </span>
                  </div>
                  <Field help="Play Console 개발자 계정 페이지의 '개발자 이름'(스토어에 공개되는 이름) 그대로." label="스토어 개발자 이름">
                    <input className={input} placeholder="예: 코지 소프트" value={f.developerName} onChange={(e) => set(label, { developerName: e.target.value })} />
                  </Field>
                  <Field help="스토어에 공개돼도 괜찮은 연락 이메일. 법적 이름·주소는 넣지 않기." label="연락 이메일">
                    <input className={input} placeholder="예: contact@example.com" type="email" value={f.contactEmail} onChange={(e) => set(label, { contactEmail: e.target.value })} />
                  </Field>
                  <Field help="19자리 숫자. 개발자 계정 페이지 또는 Console 주소 /developers/<이 숫자>/ 에서 확인." label="Play Console 개발자 계정 ID">
                    <input
                      className={input}
                      inputMode="numeric"
                      placeholder="예: 1234567890123456789"
                      value={f.developerAccountId}
                      onChange={(e) => set(label, { developerAccountId: e.target.value })}
                    />
                  </Field>
                  <Field help="Console 개발자 계정 페이지의 '계정 유형'." label="계정 유형">
                    <select className={input} value={f.accountType} onChange={(e) => set(label, { accountType: e.target.value })}>
                      <option value="">고르기…</option>
                      <option value="personal">개인</option>
                      <option value="organization">조직</option>
                    </select>
                  </Field>
                  <Field className="sm:col-span-2" help="Console 에 로그인하는 구글 계정(계정 소유자)." label="Play Console 로그인 구글 이메일">
                    <input className={input} placeholder="예: me@gmail.com" type="email" value={f.loginEmail} onChange={(e) => set(label, { loginEmail: e.target.value })} />
                  </Field>
                  <Field
                    className="sm:col-span-2"
                    help="이 계정의 앱이 따로 고르지 않으면 쓰는 업로드 키. 위 키 보관함에서 만들거나 등록한 키 중에서 골라요(비밀번호도 보관함에서)."
                    label="기본 키: 보관함에서 선택"
                  >
                    <select className={input} value={f.defaultKeyId} onChange={(e) => set(label, { defaultKeyId: e.target.value })}>
                      <option value="">없음</option>
                      {data.keys.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.name} · {k.kindLabel}
                          {k.production ? " · 운영 키" : ""} ({k.keystorePath})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    className="sm:col-span-2"
                    help="Play API 용 서비스 계정 JSON 파일 경로(PC). 아직 없으면 비워 두세요(비공개 테스트 자동 업로드·스토어 자료 업로드 때 필요)."
                    label="서비스 계정 키 경로"
                  >
                    <input
                      className={input}
                      placeholder="예: ~/keys/play-sa.json"
                      value={f.serviceAccountKeyPath}
                      onChange={(e) => set(label, { serviceAccountKeyPath: e.target.value })}
                    />
                  </Field>
                  <Field className="sm:col-span-2" help="자유 메모." label="메모">
                    <textarea className={input} rows={2} value={f.notes} onChange={(e) => set(label, { notes: e.target.value })} />
                  </Field>
                </div>
                <Button className="min-h-11 sm:min-h-0" color="primary" isDisabled={busy || !f.name.trim()} size="sm" onPress={() => save(label)}>
                  계정 {label} 저장
                </Button>
                {acc?.playConsoleUrl && (
                  <a className="block text-sm text-primary underline" href={acc.playConsoleUrl} rel="noopener noreferrer" target="_blank">
                    ▶ Play Console 앱 목록 열기 (계정 {label}
                    {acc.loginEmail ? ` · ${acc.loginEmail} 로 로그인` : ""})
                  </a>
                )}
                {acc && (dk || acc.serviceAccountKeyPath) && (
                  <ul className="space-y-1 text-sm">
                    {dk && (
                      <li className="space-y-1 rounded-lg border border-default-200 p-2">
                        <div>
                          기본 키 <b>{dk.name}</b> · 비밀번호 {KEY_PASSWORD_TEXT[dk.password]}
                        </div>
                        <KeyError text={dk.lastError} />
                        <KeyCheckView alias={dk.keyAlias} check={dk.check} />
                        <p className="text-xs text-default-500">
                          조회·비밀번호는 위 키 보관함에서 해요. 앱 폴더에 key.properties 가 이미 있는 앱은 자기 키를 그대로 써요. (예전처럼 secrets.env
                          에 <code>{acc.secretNames.keystore}</code>, <code>{acc.secretNames.key}</code> 를 직접 넣어 둔 것도 계속 쓸 수 있어요)
                        </p>
                      </li>
                    )}
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
    </>
  );
}
