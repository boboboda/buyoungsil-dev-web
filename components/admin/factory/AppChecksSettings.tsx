// components/admin/factory/AppChecksSettings.tsx
// 통제실 [설정] '앱별 합치기·최종 점검 검사 명령'. 병행 일감을 합칠 때와 지휘자 묶음의 마지막 전체 점검 때, stack 기본 검사(예: nestjs 는 tsc) 뒤에 이 명령들을 더 돌린다.
// 비어 있으면 지금처럼 stack 기본 검사만 돈다. 저장은 lib/factory/appChecks.ts (factory_settings 의 appCheckCommands 한 칸).
"use client";

import { useState } from "react";
import { Button } from "@heroui/react";

import SettingsCard from "./SettingsCard";
import { postControl, useFactoryControl } from "./useFactoryControl";

type Checks = Record<string, string[]>;

export default function AppChecksSettings() {
  const { data } = useFactoryControl<{ appChecks?: Checks }>();
  const checks = data?.appChecks ?? null;
  const [slug, setSlug] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const pick = (name: string) => {
    setSlug(name);
    setText((checks?.[name] ?? []).join("\n"));
  };

  const save = async () => {
    setBusy(true);
    try {
      const { ok, data: d } = await postControl({ appChecks: { appSlug: slug.trim(), commands: text } });

      setNotice(d.message ?? (ok ? "저장했어요." : "저장하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const entries = Object.entries(checks ?? {});

  return (
    <SettingsCard
      attrs={{ "data-title": "settings · 앱별 검사 명령", "data-app-checks": "" }}
      notice={notice}
      title="앱별 합치기·최종 점검 검사 명령"
      description={
        <>같이 돌린 수정 일감을 기본 브랜치에 합칠 때와 지휘자 묶음의 마지막 전체 점검 때, 앱 종류(stack)의 기본 검사 뒤에 여기 적은 명령을 한 줄에 하나씩 더 돌려요(앱 폴더에서, 셸 없이). 예: python -m unittest discover -s tests -q. 비워 두면 기본 검사만 돌아요. && | ; &gt; &lt; 같은 셸 글자는 쓸 수 없고, 최대 8줄이에요.</>
      }
    >
      {entries.length > 0 && (
        <ul className="space-y-1 text-sm" data-app-checks-list="">
          {entries.map(([name, list]) => (
            <li key={name} className="flex flex-wrap items-center gap-2">
              <button className="font-mono underline" type="button" onClick={() => pick(name)}>
                {name}
              </button>
              <span className="text-default-500">{list.join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          앱 이름
          <input aria-label="검사 명령을 정할 앱 이름" className="w-full max-w-56 rounded border border-default-300 px-2 py-1 font-mono" data-app-checks-slug="" list="app-checks-slugs" value={slug} onChange={(e) => pick(e.target.value)} />
          <datalist id="app-checks-slugs">
            {entries.map(([name]) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <textarea aria-label="검사 명령(한 줄에 하나)" className="h-24 w-full rounded border border-default-300 px-2 py-1 font-mono text-sm" data-app-checks-text="" placeholder="한 줄에 명령 하나 (비우고 저장하면 기본 검사만)" value={text} onChange={(e) => setText(e.target.value)} />
        <Button data-app-checks-save="" isDisabled={busy || slug.trim() === ""} size="sm" variant="flat" onPress={save}>
          저장
        </Button>
      </div>
    </SettingsCard>
  );
}
