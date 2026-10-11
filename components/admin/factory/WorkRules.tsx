// components/admin/factory/WorkRules.tsx
// 감독 프로그램이 Claude 에게 주는 작업 규칙(구역별). 고치면 다음 일감부터 적용된다. 고친 게 없으면 기본값.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader, Chip } from "@heroui/react";

interface Section {
  id: string;
  label: string;
  default: string;
  text: string;
  custom: boolean;
}

export default function WorkRules() {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = (list: Section[]) => {
    setSections(list);
    setDrafts(Object.fromEntries(list.map((s) => [s.id, s.text])));
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/rules", { cache: "no-store" });

      if (res.ok) apply(((await res.json()) as { sections: Section[] }).sections);
    } catch {
      /* 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (id: string, text: string | null) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: id, text }),
      });
      const d = (await res.json().catch(() => ({}))) as { message?: string; sections?: Section[] };

      if (res.ok && d.sections) apply(d.sections);
      setNotice(d.message ?? (res.ok ? "저장했어요." : "저장하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-col items-start gap-1">
        <span className="font-semibold">📜 작업 규칙 (Claude 에게 주는 지시)</span>
        <span className="text-xs text-default-500">
          감독 프로그램이 일감을 받을 때 같이 받아 앱 폴더 CLAUDE.md 에 넣어요. 고치면 다음 일감부터 적용돼요. 홈페이지에 연결이 안 되면 PC 코드 안 기본값으로 돌아요.
          자리표시자: {"{{appSlug}} {{title}} {{stack}} {{pkg}} {{ANDROID_SDK}}"}
        </span>
        <span className="text-xs text-warning-600">⚠️ 이 글은 작업 PC 에서 명령을 실행할 수 있는 Claude 에게 그대로 전달돼요.</span>
      </CardHeader>
      <CardBody className="space-y-2">
        {!sections ? (
          <p className="text-sm text-default-500">읽는 중…</p>
        ) : (
          sections.map((s) => (
            <div key={s.id} className="rounded-lg border border-default-200">
              <button className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm" type="button" onClick={() => setOpen(open === s.id ? null : s.id)}>
                <span>{s.label}</span>
                <Chip color={s.custom ? "warning" : "default"} size="sm" variant="flat">
                  {s.custom ? "고침" : "기본값"}
                </Chip>
              </button>
              {open === s.id && (
                <div className="space-y-2 px-3 pb-3">
                  <textarea
                    className="min-h-[200px] w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 font-mono text-xs"
                    value={drafts[s.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button className="min-h-11 sm:min-h-0" color="primary" isDisabled={busy || drafts[s.id] === s.text} size="sm" onPress={() => save(s.id, drafts[s.id])}>
                      저장
                    </Button>
                    <Button
                      className="min-h-11 sm:min-h-0"
                      isDisabled={busy || !s.custom}
                      size="sm"
                      variant="flat"
                      onPress={() => {
                        if (window.confirm("이 구역을 기본값으로 되돌릴까요?")) save(s.id, null);
                      }}
                    >
                      기본값으로
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        {notice && <p className="text-sm text-default-600">{notice}</p>}
      </CardBody>
    </Card>
  );
}
