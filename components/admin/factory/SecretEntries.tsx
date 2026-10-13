// components/admin/factory/SecretEntries.tsx
// 외부 서비스 키(환경변수) 입력·교체·삭제와 상태. 값은 보내기만 하고 다시 보이지 않는다(보낸 뒤 입력 칸을 바로 비운다).
// 서버가 암호화해 잠깐 보관 → 작업 PC 가 secrets.env 의 그 줄만 저장 → 서버 값 삭제. 서명 키 비밀번호는 키 보관함·출시 화면에서만.
// 예외: REVIEW_STATUS_TOKEN_… (검수 상태 토큰)은 PC 로 보내지 않고 홈페이지 서버가 암호화해 보관·직접 쓴다(값은 역시 다시 보이지 않음).
// 아래에 AI 도구 상태(설치·버전·로그인 여부, 읽기 전용)를 한 줄씩 보여 준다.
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader } from "@heroui/react";

import Field from "./Field";

type State = "pending" | "stored" | "delete_pending" | "missing" | "server";

interface Item {
  name: string;
  description: string;
  state: State;
  onPc: boolean | null;
  updatedAt: string | null;
}

interface Data {
  items: Item[];
  pcReportedAt: string | null;
  aiTools: { claude: string | null; codex: string | null; at: string | null };
}

const STATE_TEXT: Record<State, string> = {
  pending: "⏳ 서버 대기 중(PC가 곧 가져가요)",
  stored: "🔒 PC 저장 완료",
  delete_pending: "🗑️ 삭제 대기(PC가 곧 지워요)",
  missing: "⬜ PC 에 없음(이름만 알려진 것)",
  server: "🔒 서버 보관(홈페이지 서버만 써요, PC 로 안 보냄)",
};

const SERVER_PREFIX = "REVIEW_STATUS_TOKEN_";
const isServerName = (n: string) => n.startsWith(SERVER_PREFIX) || n === "STUDIO_KEY_PEPPER";

const NAME_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
const input = "w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-");

export default function SecretEntries() {
  const [data, setData] = useState<Data | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/factory/secrets", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));

      if (res.ok) setData(d);
      else setMessage(d.message ?? "목록을 읽지 못했어요.");
    } catch {
      setMessage("서버에 연결하지 못했어요.");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000); // PC 가 가져가면 상태가 바뀐다

    return () => clearInterval(t);
  }, [load]);

  const trimmed = name.trim().toUpperCase();
  const existing = data?.items.find((i) => i.name === trimmed);
  const replacing = existing ? existing.state === "stored" || existing.state === "pending" || existing.state === "server" : false;
  const valueOk = value.length >= 8 && value.length <= 4096;

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/factory/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, description: desc.trim(), value }),
      });
      const d = await res.json().catch(() => ({}));

      setMessage(d.message ?? (res.ok ? "등록했어요." : "등록하지 못했어요."));
      if (res.ok) {
        setName("");
        setDesc("");
      }
    } catch {
      setMessage("서버에 연결하지 못했어요.");
    } finally {
      setValue(""); // 값은 성공·실패와 상관없이 바로 비운다
      setBusy(false);
      load();
    }
  };

  const remove = async (n: string) => {
    const confirmText = isServerName(n)
      ? `${n} 을(를) 홈페이지 서버에서 지울까요?\n되돌릴 수 없어요.`
      : `${n} 을(를) 작업 PC 의 secrets.env 에서 지울까요?\n그 줄만 지우고 다른 키는 그대로 둬요. 되돌릴 수 없어요.`;

    if (!window.confirm(confirmText)) return;
    const res = await fetch("/api/admin/factory/secrets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};

    setMessage(d.message ?? (res?.ok ? "삭제를 요청했어요." : "삭제를 요청하지 못했어요."));
    load();
  };

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <h2 className="text-lg font-bold">🧩 외부 서비스 키(환경변수)</h2>
        <p className="text-xs text-default-500">
          PIXELLAB_TOKEN 같은 키 값을 여기서 넣으면 서버가 암호화해 잠깐 보관하고, 작업 PC 감독 프로그램이 가져가 secrets.env 에 그 줄만
          저장한 뒤 서버에서 지워요. 값은 다시 볼 수 없으니 원본은 비밀번호 관리자에 따로 두세요. 서명 키 비밀번호는 키 보관함·출시 화면에서만
          다뤄요. 단, 출시 카드의 검수 상태 토큰(REVIEW_STATUS_TOKEN_앱이름)과 Studio 접근 키용 비밀값(STUDIO_KEY_PEPPER)은 PC 로 보내지 않고 홈페이지 서버가 암호화해 보관해요.
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        {message && <p className="break-words text-sm text-default-600">{message}</p>}

        <div className="space-y-2">
          {data?.items.length === 0 && <p className="text-sm text-default-500">아직 알려진 키가 없어요.</p>}
          {data?.items.map((i) => (
            <div key={i.name} className="flex flex-col gap-1 rounded-lg border border-default-200 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-0.5">
                <div className="break-all font-mono font-semibold">{i.name}</div>
                {i.description && <div className="break-words text-default-500">{i.description}</div>}
                <div className="text-xs text-default-500">
                  {STATE_TEXT[i.state]} · 마지막 변경 {when(i.updatedAt)}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="light" onPress={() => setName(i.name)}>
                  {i.state === "missing" ? "값 넣기" : "교체"}
                </Button>
                {i.state !== "delete_pending" && (
                  <Button color="danger" size="sm" variant="light" onPress={() => remove(i.name)}>
                    삭제
                  </Button>
                )}
              </div>
            </div>
          ))}
          {data && (
            <p className="text-xs text-default-400">
              PC 이름 보고: {data.pcReportedAt ? when(data.pcReportedAt) : "아직 없음(감독 프로그램이 업데이트되면 1시간마다 이름만 알려요)"}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 border-t border-default-200 pt-3 sm:grid-cols-2">
          <Field help="대문자·숫자·_ 3~64자. RELEASE_·FACTORY_ 등 내부 이름은 안 돼요." label="이름">
            <input
              autoCapitalize="characters"
              autoComplete="off"
              className={`${input} font-mono`}
              maxLength={64}
              placeholder="PIXELLAB_TOKEN"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field help="선택. 100자까지. 채팅의 AI가 이 설명을 보고 키를 골라요." label="설명">
            <input className={input} maxLength={100} placeholder="도트 이미지 생성" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </Field>
          <Field className="sm:col-span-2" help="8~4096자. 줄바꿈·앞뒤 공백·따옴표로 감싼 값은 안 돼요. 붙여넣기 가능." label="값">
            <input autoComplete="new-password" className={`${input} font-mono`} spellCheck={false} type="password" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button className="min-h-11 sm:min-h-0" color="primary" isDisabled={busy || !NAME_RE.test(trimmed) || !valueOk} size="sm" onPress={submit}>
              {replacing ? "교체" : "등록"}
            </Button>
            {trimmed && !NAME_RE.test(trimmed) && <span className="text-xs text-danger">이름 형식이 맞지 않아요.</span>}
            {replacing && <span className="text-xs text-default-500">이미 있는 이름이라 값을 바꿔요.</span>}
          </div>
        </div>

        <div className="space-y-1 border-t border-default-200 pt-3 text-sm">
          <h3 className="font-semibold">🤖 AI 도구 상태(작업 PC, 읽기 전용)</h3>
          <div className="break-words">Claude Code: {data?.aiTools.claude ?? "확인 안 함"}</div>
          <div className="break-words">Codex: {data?.aiTools.codex ?? "확인 안 함"}</div>
          <p className="text-xs text-default-500">
            {data?.aiTools.at ? `확인 ${when(data.aiTools.at)} · ` : ""}감독 프로그램이 1시간마다 --version 과 공식 로그인 상태 명령 결과만 알려요.
            로그인은 PC 에서 직접 하세요.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
