// components/admin/factory/KeyPasswordForm.tsx
// 업로드 키 비밀번호 입력 칸. 보내면 서버가 암호화해 잠깐 보관하고, 작업 PC 가 가져가 secrets.env 에 저장하면 서버에서 지운다.
// 값은 다시 보여 주지 않는다(등록 상태만). 보낸 뒤 입력 칸은 바로 비운다.
"use client";

import { useState } from "react";
import { Button } from "@heroui/react";

import Field from "./Field";
import { KEY_PASSWORD_TEXT, postRelease, type KeyPasswordState, type ReleaseOverview } from "./releaseTypes";

const input = "w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm";

export default function KeyPasswordForm({
  target,
  state,
  onSaved,
}: {
  target: { accountId: string } | { appSlug: string };
  state: KeyPasswordState;
  onSaved: (d: Partial<ReleaseOverview>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [store, setStore] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setNotice(null);
    const { ok, data } = await postRelease({ action: "setKeyPassword", ...target, storePassword: store, keyPassword: key });

    setStore("");
    setKey("");
    if (ok) {
      setOpen(false);
      onSaved(data);
    }
    setNotice(data.message ?? (ok ? "등록했어요." : "등록하지 못했어요."));
    setBusy(false);
  };

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span>{state === "none" ? "⬜" : "🔒"} {KEY_PASSWORD_TEXT[state]}</span>
        <Button size="sm" variant="light" onPress={() => setOpen((v) => !v)}>
          {state === "none" ? "비밀번호 등록" : "비밀번호 바꾸기"}
        </Button>
      </div>
      {open && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-start">
          <Field help=".jks 파일을 여는 비밀번호. 6자 이상." label="키 저장소 비밀번호">
            <input autoComplete="new-password" className={input} type="password" value={store} onChange={(e) => setStore(e.target.value)} />
          </Field>
          <Field help="키 별칭의 비밀번호. 비우면 위와 같게 써요." label="키 비밀번호">
            <input autoComplete="new-password" className={input} type="password" value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Button className="min-h-11 sm:mt-5 sm:min-h-0" color="primary" isDisabled={busy || store.length < 6} size="sm" onPress={submit}>
            등록
          </Button>
          <p className="text-xs text-default-500 sm:col-span-3">
            키 파일이 아직 없으면 첫 출시 때 작업 PC 가 이 비밀번호로 한 번만 만들어요. 이미 있는 키라면 그 키의 실제 비밀번호를 넣으세요. 등록한 값은
            다시 볼 수 없으니 비밀번호 관리자에도 꼭 따로 적어 두세요.
          </p>
        </div>
      )}
      {notice && <p className="text-default-600">{notice}</p>}
    </div>
  );
}
