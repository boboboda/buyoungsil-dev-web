// components/admin/factory/KeyVault.tsx
// 설정 → 키 보관함: 업로드(서명) 키를 모아 두고 배포 계정(기본 키)·앱(이 앱이 쓸 키)이 골라 쓴다.
// - [새 공용 키 만들기]: 작업 PC 가 keytool 로 만든다(JKS·RSA 2048·10000일). 대상 경로에 파일이 있으면 덮어쓰지 않고 멈춘다.
// - [기존 키 등록]: 경로·별칭·비밀번호만 등록(파일은 만들거나 옮기거나 바꾸지 않음). 확장자 없는 파일도 된다(예: Untitled).
// - [조회]: 작업 PC 가 그 파일 하나를 확인(있음·크기·형식·별칭·SHA-1·git 추적). 비밀번호는 다시 보여 주지 않는다(등록 상태만).
// - 운영 키는 삭제·다시 만들기 불가. 삭제는 보관함 항목만 지우고 PC 파일은 지우지 않는다.
"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader, Chip } from "@heroui/react";

import Field from "./Field";
import KeyPasswordForm from "./KeyPasswordForm";
import { fmtSize, postRelease, type KeyCheck, type ReleaseOverview, type VaultKey } from "./releaseTypes";

const input = "w-full rounded-lg border border-default-200 bg-transparent px-3 py-2 text-base sm:text-sm";
const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("ko-KR") : "-");
const fileName = (name: string) => name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "upload";

/** PC 에서 확인된 정보(출시 카드에서도 쓴다) */
export function KeyCheckView({ check, alias }: { check: KeyCheck | null; alias: string }) {
  if (!check) return <p className="text-xs text-default-500">아직 PC 에서 확인하지 않았어요. [조회]를 누르세요.</p>;
  if (!check.exists) return <p className="text-sm font-semibold text-danger">❌ 파일 없음 (확인 {fmt(check.at)})</p>;

  return (
    <div className="space-y-1 text-xs">
      <div>
        ✅ 파일 있음 · {fmtSize(check.size)} · 수정 {fmt(check.mtime)} · 형식 <b>{check.type ?? "?"}</b> · 확인 {fmt(check.at)}
      </div>
      {check.aliases.length > 0 ? (
        check.aliases.map((a) => (
          <div key={a.alias} className="pl-2 text-default-600">
            별칭 {a.alias}
            {a.alias.toLowerCase() === alias.toLowerCase() ? " (지정한 별칭)" : ""} · SHA-1 <code className="break-all">{a.sha1 ?? "-"}</code>
          </div>
        ))
      ) : (
        <div className="pl-2 text-default-500">별칭·지문을 읽지 못했어요</div>
      )}
      {check.aliasFound === false && <div className="font-semibold text-danger">⚠️ 지정한 별칭 &apos;{alias}&apos; 가 파일 안에 없어요</div>}
      {check.passwordOk === true && <div className="text-success-600">🔒 등록한 비밀번호로 열려요</div>}
      {check.passwordOk === false && <div className="font-semibold text-danger">⚠️ 등록한 비밀번호가 틀려요</div>}
      {check.gitTracked && <div className="font-semibold text-danger">⚠️ {check.inApp} 앱 폴더의 git 이 이 키 파일을 추적 중이에요(커밋에서 빼세요)</div>}
      {check.note && <div className="text-default-500">{check.note}</div>}
    </div>
  );
}

/** 마지막 오류(비밀번호는 서버가 가림). 출시 일감 실패 표시와 같은 모양 */
export function KeyError({ text, at }: { text: string | null; at?: string | null }) {
  if (!text) return null;

  return (
    <div className="whitespace-pre-wrap break-words rounded-lg border border-danger-200 bg-danger-50 p-2 text-sm dark:bg-danger-50/10">
      ❌ {text}
      {at ? <span className="text-xs text-default-500"> ({fmt(at)})</span> : null}
    </div>
  );
}

const CREATE_TEXT: Record<string, string> = {
  requested: "⏳ 만들기 요청됨(작업 PC 가 15초 안에 가져가요)",
  creating: "⏳ 작업 PC 가 만드는 중…",
  failed: "❌ 만들기 실패",
};

function KeyItem({ k, busy, call, onSaved }: { k: VaultKey; busy: boolean; call: (b: Record<string, unknown>, confirm?: string) => void; onSaved: (d: Partial<ReleaseOverview>) => void }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: k.name, kind: k.kind, description: k.description ?? "", production: k.production });
  const mine = k.check?.aliases.find((a) => a.alias.toLowerCase() === k.keyAlias.toLowerCase());

  return (
    <div className="space-y-2 rounded-lg border border-default-200 p-3">
      <KeyError at={k.lastErrorAt} text={k.lastError} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{k.name}</span>
        <Chip size="sm" variant="flat">
          {k.kindLabel}
        </Chip>
        {k.production && (
          <Chip color="danger" size="sm" variant="flat">
            🛡 운영 키
          </Chip>
        )}
        {k.createState && k.createState !== "done" && <span className="text-xs">{CREATE_TEXT[k.createState] ?? k.createState}</span>}
      </div>
      <div className="text-xs text-default-600">
        <code className="break-all">{k.keystorePath}</code> · 별칭 {k.keyAlias}
        {k.usedBy.accounts.length + k.usedBy.apps.length > 0 && (
          <span> · 쓰는 곳: {[...k.usedBy.accounts.map((a) => `계정 ${a}`), ...k.usedBy.apps].join(", ")}</span>
        )}
      </div>
      {k.description && <p className="whitespace-pre-wrap text-xs text-default-500">{k.description}</p>}
      {k.createState === "done" && (
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-2 text-xs dark:bg-warning-50/10">
          ✅ 새 공용 키를 만들었어요. 별칭 <b>{k.keyAlias}</b>
          {mine?.sha1 ? (
            <>
              {" "}
              · SHA-1 <code className="break-all">{mine.sha1}</code>
            </>
          ) : null}
          <br />
          <b>⚠️ 이 파일과 비밀번호를 PC 밖 안전한 곳 두 군데 이상에 백업하세요</b>(암호화한 USB, 비밀번호 관리자 등). 잃으면 앱 업데이트를 올릴 수 없어요.
        </div>
      )}
      <KeyCheckView alias={k.keyAlias} check={k.check} />
      <KeyPasswordForm state={k.password} target={{ keyId: k.id }} onSaved={onSaved} />
      <div className="flex flex-wrap items-center gap-2">
        <Button className="min-h-11 sm:min-h-0" isDisabled={busy || !!k.checking} size="sm" variant="flat" onPress={() => call({ action: "vaultCheck", keyId: k.id })}>
          {k.checking ? "조회 중…" : "🔍 조회"}
        </Button>
        {k.createState === "failed" && !k.production && (
          <Button
            className="min-h-11 sm:min-h-0"
            isDisabled={busy}
            size="sm"
            variant="flat"
            onPress={() => call({ action: "vaultRetry", keyId: k.id }, "다시 만들기를 요청할까요? 파일이 이미 있으면 덮어쓰지 않고 멈춰요.")}
          >
            다시 만들기
          </Button>
        )}
        <Button className="min-h-11 sm:min-h-0" isDisabled={busy} size="sm" variant="light" onPress={() => setEdit((v) => !v)}>
          고치기
        </Button>
        <Button
          className="min-h-11 sm:min-h-0"
          color="danger"
          isDisabled={busy || k.production}
          size="sm"
          variant="light"
          onPress={() => call({ action: "vaultDelete", keyId: k.id }, `'${k.name}' 를 보관함에서 지울까요? PC 의 키 파일은 지우지 않아요.`)}
        >
          삭제
        </Button>
        {k.production && <span className="text-xs text-default-500">운영 키는 지우거나 다시 만들 수 없어요</span>}
      </div>
      {edit && (
        <div className="grid grid-cols-1 gap-3 border-t border-default-200 pt-2 sm:grid-cols-2">
          <Field label="이름(별명)">
            <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="종류">
            <select className={input} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as VaultKey["kind"] })}>
              <option value="shared">공용 키</option>
              <option value="app">기존 앱 키</option>
            </select>
          </Field>
          <Field className="sm:col-span-2" label="설명">
            <textarea className={input} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input checked={f.production} type="checkbox" onChange={(e) => setF({ ...f, production: e.target.checked })} />
            운영 키(프로덕션 배포에 쓰이는 키: 삭제·다시 만들기 불가)
          </label>
          <p className="text-xs text-default-500 sm:col-span-2">경로·별칭은 바꿀 수 없어요. 다른 파일이면 [기존 키 등록]으로 새로 등록하세요.</p>
          <Button
            className="min-h-11 sm:min-h-0"
            color="primary"
            isDisabled={busy || !f.name.trim()}
            size="sm"
            onPress={() => {
              const off = k.production && !f.production ? "운영 키 표시를 끌까요? 끄면 이 항목을 지울 수 있게 돼요." : undefined;

              call({ action: "vaultUpdate", keyId: k.id, ...f }, off);
              setEdit(false);
            }}
          >
            저장
          </Button>
        </div>
      )}
    </div>
  );
}

export default function KeyVault({ data, onSaved }: { data: ReleaseOverview; onSaved: (d: Partial<ReleaseOverview>) => void }) {
  const [mode, setMode] = useState<"none" | "create" | "register">("none");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [c, setC] = useState({ name: "", keystorePath: "", keyAlias: "upload", dname: "", description: "", password: "", password2: "" });
  const [r, setR] = useState({ name: "", kind: "app", keystorePath: "", keyAlias: "upload", description: "", production: false, storePassword: "", keyPassword: "" });

  // 출시 카드의 '키 파일 후보'에서 넘어오면(?registerPath=…) 등록 칸을 채워 둔다
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("registerPath");

    if (p) {
      setR((x) => ({ ...x, keystorePath: p, keyAlias: q.get("registerAlias") || x.keyAlias, name: q.get("registerName") || x.name }));
      setMode("register");
      document.getElementById("key-vault")?.scrollIntoView();
    }
  }, []);

  const call = async (body: Record<string, unknown>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return false;
    setBusy(true);
    setNotice(null);
    const { ok, data: d } = await postRelease(body);

    if (ok) onSaved(d);
    setNotice(d.message ?? (ok ? "처리했어요." : "처리하지 못했어요."));
    setBusy(false);

    return ok;
  };

  const createPath = c.keystorePath.trim() || `~/keys/${fileName(c.name)}.jks`;
  const pwOk = c.password.length >= 6 && c.password === c.password2;

  return (
    <Card id="key-vault">
      <CardHeader className="flex flex-col items-start gap-1">
        <span className="font-semibold">🔑 키 보관함</span>
        <span className="text-xs text-default-500">
          업로드(서명) 키를 모아 두고, 배포 계정의 기본 키와 앱마다 쓸 키를 여기서 골라요. 서버에는 경로·별칭·지문만 있고, 비밀번호는 작업 PC 의
          secrets.env 에만 남아요.
        </span>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm dark:bg-warning-50/10">
          <b>⚠️ 서명 키 백업은 꼭 해 두세요.</b> 업로드 키와 비밀번호를 잃으면 앱 업데이트를 올릴 수 없어요(Play App Signing 을 쓰면 업로드 키
          재설정을 요청할 수 있지만 며칠 걸려요). 키 파일을 PC 밖 안전한 곳 두 군데 이상에 복사하고, 앱 폴더·git·홈페이지에는 두지 마세요.
          출시 일감은 키를 새로 만들지 않아요(키 파일이 없으면 실패로 멈춤).
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11 sm:min-h-0" color={mode === "create" ? "primary" : "default"} size="sm" variant="flat" onPress={() => setMode(mode === "create" ? "none" : "create")}>
            ➕ 새 공용 키 만들기
          </Button>
          <Button
            className="min-h-11 sm:min-h-0"
            color={mode === "register" ? "primary" : "default"}
            size="sm"
            variant="flat"
            onPress={() => setMode(mode === "register" ? "none" : "register")}
          >
            📥 기존 키 등록
          </Button>
        </div>

        {mode === "create" && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-default-200 p-3 sm:grid-cols-2">
            <p className="text-xs text-default-500 sm:col-span-2">
              작업 PC 가 keytool 로 새 키를 만들어요(JKS · RSA 2048 · 유효기간 10000일). 그 경로에 파일이 이미 있으면 절대 덮어쓰지 않고 &apos;이미
              있어요&apos;로 멈춰요.
            </p>
            <Field help="보관함에서 알아볼 이름. 예: 공용 키 2026" label="이름(별명)">
              <input className={input} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
            </Field>
            <Field help={`비우면 ${createPath}`} label="키 파일 경로(PC)">
              <input className={input} placeholder={createPath} value={c.keystorePath} onChange={(e) => setC({ ...c, keystorePath: e.target.value })} />
            </Field>
            <Field help="키 이름. 보통 upload." label="별칭">
              <input className={input} value={c.keyAlias} onChange={(e) => setC({ ...c, keyAlias: e.target.value })} />
            </Field>
            <Field help="인증서에 들어갈 이름(CN). 비우면 App Factory. 글자·숫자·공백·. _ - 만." label="인증서 이름 (선택)">
              <input className={input} value={c.dname} onChange={(e) => setC({ ...c, dname: e.target.value })} />
            </Field>
            <Field help="6자 이상. 키 저장소·키 비밀번호에 같이 써요. 다시 볼 수 없으니 비밀번호 관리자에 꼭 적어 두세요." label="비밀번호">
              <input autoComplete="new-password" className={input} type="password" value={c.password} onChange={(e) => setC({ ...c, password: e.target.value })} />
            </Field>
            <Field help={c.password2 && c.password !== c.password2 ? "⚠️ 위 비밀번호와 달라요" : "확인용으로 한 번 더."} label="비밀번호 확인">
              <input autoComplete="new-password" className={input} type="password" value={c.password2} onChange={(e) => setC({ ...c, password2: e.target.value })} />
            </Field>
            <Field className="sm:col-span-2" label="설명 (선택)">
              <input className={input} value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} />
            </Field>
            <Button
              className="min-h-11 sm:min-h-0"
              color="primary"
              isDisabled={busy || !c.name.trim() || !pwOk}
              size="sm"
              onPress={async () => {
                const ok = await call({ action: "vaultCreate", ...c, keystorePath: createPath });

                setC((x) => ({ ...x, password: "", password2: "" }));
                if (ok) {
                  setC({ name: "", keystorePath: "", keyAlias: "upload", dname: "", description: "", password: "", password2: "" });
                  setMode("none");
                }
              }}
            >
              만들기
            </Button>
          </div>
        )}

        {mode === "register" && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-default-200 p-3 sm:grid-cols-2">
            <p className="text-xs text-default-500 sm:col-span-2">
              이미 있는 키 파일을 등록만 해요(만들거나 옮기거나 바꾸지 않음). 확장자가 없어도 돼요(예: ~/keys/Untitled). 등록하면 작업 PC 가 바로
              조회해요.
            </p>
            <Field help="예: investcalculator 운영 키" label="이름(별명)">
              <input className={input} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
            </Field>
            <Field help="공용 키: 여러 앱이 같이 씀 / 기존 앱 키: 한 앱 전용" label="종류">
              <select className={input} value={r.kind} onChange={(e) => setR({ ...r, kind: e.target.value })}>
                <option value="app">기존 앱 키</option>
                <option value="shared">공용 키</option>
              </select>
            </Field>
            <Field help="PC 의 키 파일 경로. 예: ~/keys/investcalculator.jks" label="키 파일 경로(PC)">
              <input className={input} value={r.keystorePath} onChange={(e) => setR({ ...r, keystorePath: e.target.value })} />
            </Field>
            <Field help="파일 안의 키 이름. 모르면 [조회] 결과의 별칭 목록을 보세요." label="별칭">
              <input className={input} value={r.keyAlias} onChange={(e) => setR({ ...r, keyAlias: e.target.value })} />
            </Field>
            <Field help="그 키 파일의 실제 비밀번호. 6자 이상." label="키 저장소 비밀번호">
              <input autoComplete="new-password" className={input} type="password" value={r.storePassword} onChange={(e) => setR({ ...r, storePassword: e.target.value })} />
            </Field>
            <Field help="키 별칭의 비밀번호. 비우면 위와 같게 써요." label="키 비밀번호 (선택)">
              <input autoComplete="new-password" className={input} type="password" value={r.keyPassword} onChange={(e) => setR({ ...r, keyPassword: e.target.value })} />
            </Field>
            <Field className="sm:col-span-2" label="설명 (선택)">
              <input className={input} value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input checked={r.production} type="checkbox" onChange={(e) => setR({ ...r, production: e.target.checked })} />
              운영 키(이미 프로덕션 배포에 쓰인 키: 삭제·다시 만들기 불가)
            </label>
            <Button
              className="min-h-11 sm:min-h-0"
              color="primary"
              isDisabled={busy || !r.name.trim() || !r.keystorePath.trim() || r.storePassword.length < 6}
              size="sm"
              onPress={async () => {
                const ok = await call({ action: "vaultRegister", ...r });

                setR((x) => ({ ...x, storePassword: "", keyPassword: "" }));
                if (ok) {
                  setR({ name: "", kind: "app", keystorePath: "", keyAlias: "upload", description: "", production: false, storePassword: "", keyPassword: "" });
                  setMode("none");
                }
              }}
            >
              등록
            </Button>
          </div>
        )}

        {notice && <p className="text-sm text-default-600">{notice}</p>}
        {data.keys.length === 0 ? (
          <p className="text-sm text-default-500">아직 키가 없어요.</p>
        ) : (
          <div className="space-y-3">
            {data.keys.map((k) => (
              <KeyItem key={`${k.id}:${k.name}:${k.kind}:${k.production}`} busy={busy} call={call} k={k} onSaved={onSaved} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
