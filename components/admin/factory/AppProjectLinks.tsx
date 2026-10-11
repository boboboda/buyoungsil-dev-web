// components/admin/factory/AppProjectLinks.tsx
// 공장 앱 ↔ 홈페이지 Project 연결. 새 앱은 승인할 때 자동으로 만들어지고, 그 전에 만든 앱(saessak-hub 등)은 여기서 기존 Project 를 골라 잇는다.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

interface AppRow {
  appSlug: string;
  title: string;
  stack: string;
  projectId: string | null;
  projectTitle: string | null;
}

interface ProjectRow {
  id: string;
  title: string;
  name: string;
  platform: string;
  status: string;
  linkedApp: string | null;
}

interface Data {
  apps: AppRow[];
  projects: ProjectRow[];
  message?: string;
}

export default function AppProjectLinks() {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/apps", { cache: "no-store" });

      if (res.ok) setData((await res.json()) as Data);
    } catch {
      /* 못 읽으면 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const save = async (appSlug: string, projectId: string | null) => {
    setBusy(appSlug);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appSlug, projectId }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Data>;

      if (res.ok && body.apps && body.projects) setData({ apps: body.apps, projects: body.projects });
      setNotice(body.message ?? (res.ok ? "저장했어요." : "저장하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(null);
  };

  const unlinkedCount = data?.apps.filter((a) => !a.projectId).length ?? 0;

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-semibold">🔗 홈페이지 프로젝트 연결</span>
          <span className="text-xs text-default-500">
            새 앱은 승인할 때 프로젝트가 자동으로 만들어져요. 그 전에 만든 앱은 여기서 기존 프로젝트를 골라 이어 주세요.
          </span>
        </div>
        <Button className="min-h-11 w-full sm:min-h-0 sm:w-auto" size="sm" variant="flat" onPress={() => setOpen((v) => !v)}>
          {open ? "접기" : data ? `열기 (연결 안 된 앱 ${unlinkedCount}개)` : "열기"}
        </Button>
      </CardHeader>
      {open && (
        <CardBody className="space-y-3">
          {!data ? (
            <p className="text-sm text-default-500">읽는 중…</p>
          ) : data.apps.length === 0 ? (
            <p className="text-sm text-default-500">아직 공장 앱이 없어요.</p>
          ) : (
            data.apps.map((a) => {
              const selected = choice[a.appSlug] ?? "";

              return (
                <div key={a.appSlug} className="flex flex-col gap-2 border-b border-default-100 pb-3 last:border-0 sm:flex-row sm:items-center">
                  <div className="min-w-0 sm:w-64">
                    <div className="truncate font-medium">{a.title}</div>
                    <div className="text-xs text-default-500">
                      {a.appSlug} · {a.stack}
                    </div>
                  </div>
                  {a.projectId ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2 text-sm">
                      <span>✅ {a.projectTitle}</span>
                      <Button
                        className="min-h-11 sm:min-h-0"
                        isDisabled={busy !== null}
                        size="sm"
                        variant="light"
                        onPress={() => {
                          if (window.confirm(`${a.appSlug} 의 프로젝트 연결을 풀까요?\n(프로젝트는 지워지지 않아요)`)) save(a.appSlug, null);
                        }}
                      >
                        연결 풀기
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        className="w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:flex-1 sm:text-sm"
                        value={selected}
                        onChange={(e) => setChoice((c) => ({ ...c, [a.appSlug]: e.target.value }))}
                      >
                        <option value="">프로젝트 고르기…</option>
                        {data.projects.map((p) => (
                          <option key={p.id} disabled={!!p.linkedApp} value={p.id}>
                            {p.title} ({p.platform}, {p.status}){p.linkedApp ? ` — ${p.linkedApp} 에 연결됨` : ""}
                          </option>
                        ))}
                      </select>
                      <Button
                        className="min-h-11 sm:min-h-0"
                        color="primary"
                        isDisabled={!selected || busy !== null}
                        size="sm"
                        onPress={() => save(a.appSlug, selected)}
                      >
                        {busy === a.appSlug ? "저장 중…" : "연결"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
          {notice && <p className="text-sm text-default-600">{notice}</p>}
        </CardBody>
      )}
    </Card>
  );
}
