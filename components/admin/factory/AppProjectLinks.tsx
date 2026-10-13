// components/admin/factory/AppProjectLinks.tsx
// 공장 앱 ↔ 홈페이지 Project 연결. 프로젝트는 출시 대상 앱에만 둔다(출시 패키지에 추가할 때 고르거나, 출시 카드에서 연결).
// 여기서는 출시 대상 앱만 연결할 수 있고, 출시 대상이 아닌데 연결된 앱은 목록으로만 보여 주며 [연결 풀기]만 둔다(프로젝트는 지우지 않음).
// 고르는 칸은 [출시] 카드와 같은 공용 ProjectLinkSelect. 저장은 이 화면이 쓰던 /api/admin/factory/apps 그대로.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

import { APP_ROLE_LABELS, APP_ROLES, type AppRole } from "@/lib/factory/appRoles";

import ProjectLinkSelect from "./ProjectLinkSelect";

interface AppRow {
  appSlug: string;
  title: string;
  stack: string;
  projectId: string | null;
  projectTitle: string | null;
  storeTarget: boolean;
  role: AppRole;
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

  const targets = data?.apps.filter((a) => a.storeTarget) ?? [];
  // 출시 대상이 아닌데 프로젝트가 연결된 앱(새 앱 승인 때 자동으로 만들던 예전 연결 등)
  const strays = data?.apps.filter((a) => !a.storeTarget && a.projectId) ?? [];
  const unlinkedCount = targets.filter((a) => !a.projectId).length;
  const saveRole = async (appSlug: string, role: AppRole) => {
    setBusy(appSlug);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appRole: { appSlug, role } }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; appRoles?: Record<string, AppRole> };

      if (res.ok) setData((d) => (d ? { ...d, apps: d.apps.map((a) => (a.appSlug === appSlug ? { ...a, role } : a)) } : d));
      setNotice(body.message ?? (res.ok ? "저장했어요." : "저장하지 못했어요."));
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(null);
  };
  const unlink = (a: AppRow) => {
    if (window.confirm(`${a.appSlug} 의 프로젝트 연결을 풀까요?\n(프로젝트는 지워지지 않아요)`)) save(a.appSlug, null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-semibold">홈페이지 프로젝트 연결</span>
          <span className="text-xs text-default-500">
            프로젝트는 출시 대상 앱에만 연결해요. [출시] 탭에서 출시 패키지에 추가할 때 고르거나, 출시 카드나 여기서 기존 프로젝트를 골라 이어 주세요.
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
          ) : targets.length === 0 ? (
            <p className="text-sm text-default-500">출시 대상인 앱이 없어요. [출시] 탭에서 스토어에 올릴 앱을 추가하세요.</p>
          ) : (
            targets.map((a) => (
                <div key={a.appSlug} className="flex flex-col gap-2 border-b border-default-100 pb-3 last:border-0 sm:flex-row sm:items-center">
                  <div className="min-w-0 sm:w-64">
                    <div className="truncate font-medium">{a.title}</div>
                    <div className="font-mono text-xs text-default-500">
                      {a.appSlug} · {a.stack}
                    </div>
                  </div>
                  {a.projectId ? (
                    <div className="flex flex-1 flex-wrap items-center gap-2 text-sm">
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="fx-dot fx-ok" />
                        {a.projectTitle}
                      </span>
                      <Button
                        className="min-h-11 sm:min-h-0"
                        isDisabled={busy !== null}
                        size="sm"
                        variant="light"
                        onPress={() => unlink(a)}
                      >
                        연결 풀기
                      </Button>
                    </div>
                  ) : (
                    <ProjectLinkSelect
                      appName={a.title}
                      appSlug={a.appSlug}
                      busy={busy !== null}
                      currentId={null}
                      projects={data.projects}
                      saving={busy === a.appSlug}
                      onLink={(projectId) => save(a.appSlug, projectId)}
                    />
                  )}
                </div>
              ))
          )}
          {strays.length > 0 && (
            <div className="space-y-2 rounded-lg border border-warning-200 p-2">
              <div className="text-sm font-medium">출시 대상이 아닌데 프로젝트가 연결된 앱 ({strays.length}개)</div>
              <p className="text-xs text-default-500">
                연결만 풀 수 있어요. 프로젝트는 지워지지 않으니, 홈페이지에 보이는 게 불편하면 관리자 프로젝트 화면에서 직접 지우거나 고치세요.
              </p>
              {strays.map((a) => (
                <div key={a.appSlug} className="flex flex-wrap items-center gap-2 text-sm">
                  <span>
                    {a.title} <span className="text-xs text-default-500">({a.appSlug})</span> → {a.projectTitle}
                  </span>
                  <Button className="min-h-11 sm:min-h-0" isDisabled={busy !== null} size="sm" variant="light" onPress={() => unlink(a)}>
                    연결 풀기
                  </Button>
                </div>
              ))}
            </div>
          )}
          {data && data.apps.length > 0 && (
            <div className="space-y-2 rounded-lg border border-default-200 p-2" data-app-roles>
              <div className="text-sm font-medium">앱 역할</div>
              <p className="text-xs text-default-500">제품(앱·게임)만 [스튜디오] 프로젝트 목록에 나와요. 도구·플랫폼은 이름만 접어서 보여 줘요. 일감은 그대로 보낼 수 있어요.</p>
              {data.apps.map((a) => (
                <label key={a.appSlug} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 break-all font-mono sm:w-64">{a.appSlug}</span>
                  <select
                    aria-label={`${a.appSlug} 역할`}
                    className="min-h-11 rounded border border-default-300 bg-transparent px-2 sm:min-h-0"
                    disabled={busy !== null}
                    value={a.role}
                    onChange={(e) => saveRole(a.appSlug, e.target.value as AppRole)}
                  >
                    {APP_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {APP_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          {notice && <p className="text-sm text-default-600">{notice}</p>}
        </CardBody>
      )}
    </Card>
  );
}
