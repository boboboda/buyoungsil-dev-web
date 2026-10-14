// components/admin/factory/ProjectConnections.tsx
// 앱별 배포·저장소 연결 표(읽기 + 직접 입력). git 원격·브랜치·서버 컨테이너는 작업 PC 가 읽어 보낸 값(하루 1회, [새로 읽기]로 바로),
// 도메인·배포 방법·컨테이너 이름·연결된 서비스·비고는 여기서 입력한다. 통일은 하지 않고 기록만 한다.
// 경고: 원격이 없는 앱 / 배포 서버는 있는데 컨테이너를 못 찾은 앱 / git 이 아닌 폴더.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

import { DEPLOY_SERVERS, PURPOSE_LABELS, SERVER_LABELS, type DeployServer, type LinksView, type LinkRow } from "@/lib/factory/projectLinks";

type View = LinksView & { message?: string };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "아직 못 읽음");

export default function ProjectConnections() {
  const [data, setData] = useState<View | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/project-links", { cache: "no-store" });

      if (res.ok) setData((await res.json()) as View);
    } catch {
      /* 못 읽으면 그대로 둔다 */
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/factory/project-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) as Partial<View>;

      if (res.ok && out.rows) setData(out as View);
      setNotice(out.message ?? (res.ok ? "저장했어요." : "저장하지 못했어요."));
      if (res.ok) setEditing(null);
    } catch {
      setNotice("서버에 연결하지 못했어요.");
    }
    setBusy(false);
  };

  const startEdit = (r: LinkRow) => {
    setEditing(r.appSlug);
    setForm({ deployServer: r.deployServer ?? "", deployMethod: r.deployMethod ?? "", domain: r.domain ?? "", containerName: r.containerName ?? "", services: r.services.join(", "), notes: r.notes ?? "" });
  };
  const field = (key: string, label: string, placeholder = "") => (
    <label className="flex flex-col gap-1 text-xs">
      {label}
      <input
        className="min-h-11 rounded border border-default-300 bg-transparent px-2 text-sm sm:min-h-0"
        placeholder={placeholder}
        value={form[key] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </label>
  );

  return (
    <Card data-project-connections="">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-semibold">앱별 배포·저장소 연결</span>
          <span className="text-xs text-default-500">
            앱마다 git 원격, 배포 서버·방법, 도메인, 도커 컨테이너를 한 곳에 기록해요(기록만 하고 바꾸지 않아요).
            {data ? ` · 마지막 읽기: ${fmt(data.reportAt)}${data.reportStale ? " (오래됨)" : ""}` : ""}
          </span>
        </div>
        <Button className="min-h-11 w-full sm:min-h-0 sm:w-auto" size="sm" variant="flat" onPress={() => setOpen((v) => !v)}>
          {open ? "접기" : data ? `열기 (경고 ${data.warningCount}개)` : "열기"}
        </Button>
      </CardHeader>
      {open && (
        <CardBody className="space-y-3">
          {!data ? (
            <p className="text-sm text-default-500">읽는 중…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs text-default-500">
                <Button isDisabled={busy} size="sm" variant="flat" onPress={() => post({ refresh: true })}>
                  새로 읽기
                </Button>
                <span>서버1 컨테이너 목록: {data.servers.serverpc === "ok" ? "읽음" : "못 읽음"}</span>
                <span>서버2 컨테이너 목록: {data.servers.serverpc2 === "ok" ? "읽음" : "못 읽음"}</span>
              </div>
              {notice && <p className="text-xs text-default-500">{notice}</p>}
              {data.rows.map((r) => (
                <div key={r.appSlug} className="space-y-1 border-b border-default-100 pb-3 text-sm last:border-0" data-app-connection={r.appSlug}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-medium">{r.appSlug}</span>
                    <span className="text-xs text-default-500">
                      {r.stack ?? "종류 모름"} · 브랜치 {r.branch ?? "?"} · 폴더 {r.hasFolder === false ? "없음" : r.isGit === false ? "git 아님" : "있음"}
                    </span>
                    <Button className="min-h-11 sm:min-h-0" isDisabled={busy} size="sm" variant="light" onPress={() => (editing === r.appSlug ? setEditing(null) : startEdit(r))}>
                      {editing === r.appSlug ? "닫기" : "수정"}
                    </Button>
                  </div>
                  <div className="text-xs">
                    배포: {r.deployServer ? SERVER_LABELS[r.deployServer as DeployServer] : "미정"}
                    {r.deployMethod ? ` · ${r.deployMethod}` : ""}
                    {r.domain ? ` · ${r.domain}` : ""}
                    {r.containerName ? ` · 컨테이너 ${r.containerName}${r.containersFound === true ? " ✓" : r.containersFound === false ? " ✗" : ""}` : ""}
                    {r.services.length ? ` · 서비스 ${r.services.join(", ")}` : ""}
                  </div>
                  <div className="text-xs text-default-500">
                    원격{r.remotesSource === "initial" ? "(초기값)" : ""}:{" "}
                    {r.remotes.length ? r.remotes.map((x) => `${x.name}→${x.host}(${PURPOSE_LABELS[x.purpose]})`).join(", ") : "없음"}
                  </div>
                  {r.notes && <div className="text-xs text-default-500">비고: {r.notes}</div>}
                  {r.warnings.map((w) => (
                    <p key={w.kind + w.text} className="text-xs text-warning-600" data-link-warning={w.kind}>
                      ⚠ {w.text}
                    </p>
                  ))}
                  {editing === r.appSlug && (
                    <div className="grid gap-2 rounded-lg border border-default-200 p-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs">
                        배포 서버
                        <select
                          className="min-h-11 rounded border border-default-300 bg-transparent px-2 text-sm sm:min-h-0"
                          value={form.deployServer ?? ""}
                          onChange={(e) => setForm((f) => ({ ...f, deployServer: e.target.value }))}
                        >
                          <option value="">미정</option>
                          {DEPLOY_SERVERS.map((s) => (
                            <option key={s} value={s}>
                              {SERVER_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      </label>
                      {field("deployMethod", "배포 방법", "prod push / origin push / 수동")}
                      {field("domain", "도메인", "app.example.com")}
                      {field("containerName", "도커 컨테이너 이름")}
                      {field("services", "연결된 서비스(컨테이너 이름, 쉼표로)")}
                      {field("notes", "비고")}
                      <Button className="min-h-11 sm:min-h-0 sm:col-span-2" color="primary" isDisabled={busy} size="sm" onPress={() => post({ appSlug: r.appSlug, ...form })}>
                        저장
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </CardBody>
      )}
    </Card>
  );
}
