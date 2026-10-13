// components/admin/users/MembersView.tsx
// 관리자 '가입자 명단'(/admin/users) 화면(훅 없음, 서버에서 그린다). 검색·필터는 주소(GET 폼), 쪽 이동은 링크.
// 넓은 화면은 표, 좁은 화면(md 미만)은 카드 목록이라 360px 에서도 가로로 넘치지 않는다.
import Link from "next/link";

import { Digits } from "@/components/admin/ui/meters";
import {
  EMPTY_MEMBER_QUERY,
  MEMBER_METHODS,
  MEMBER_ROLES,
  METHOD_LABELS,
  MEMBERS_MAX_Q,
  MEMBERS_PAGE_SIZE,
  ROLE_LABELS,
  type MemberItem,
  type MemberPage,
  type MemberQuery,
  type MemberSummary,
} from "@/lib/admin/members";

const BASE = "/admin/users";

/** 지금 조건을 유지한 주소(기본값은 뺀다) */
export function membersHref(query: MemberQuery, change: Partial<MemberQuery> = {}) {
  const next = { ...query, ...change };
  const sp = new URLSearchParams();
  if (next.q) sp.set("q", next.q);
  if (next.role) sp.set("role", next.role);
  if (next.method) sp.set("method", next.method);
  if (next.limit !== MEMBERS_PAGE_SIZE) sp.set("limit", String(next.limit));
  if (next.page > 1) sp.set("page", String(next.page));
  const s = sp.toString();

  return s ? `${BASE}?${s}` : BASE;
}

/** 한국 시간 "YYYY-MM-DD HH:mm" */
export function kstDateTime(iso: string | null) {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "-";

  return new Date(t + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

const num = (v: number | null) => (v === null ? "-" : v.toLocaleString("ko-KR"));
const methodText = (m: MemberItem["methods"]) => (m.length ? m.map((x) => METHOD_LABELS[x] ?? x).join(" · ") : "-");

function RoleBadge({ role }: { role: MemberItem["role"] }) {
  return <span className={`shrink-0 whitespace-nowrap font-mono text-xs ${role === "admin" ? "fx-warn" : "fx-muted"}`}>{role === "admin" ? "▲ 관리자" : "○ 회원"}</span>;
}

function Tile({ label, value, unit = "명" }: { label: string; value: number | null; unit?: string }) {
  return (
    <div className="fx-panel min-w-0 p-3" data-stat={label}>
      <p className="fx-label mb-1">{label}</p>
      <Digits size="md" unit={value === null ? undefined : unit} value={num(value)} />
    </div>
  );
}

function SummaryPanel({ summary }: { summary: MemberSummary | null }) {
  const s = summary;

  return (
    <section aria-label="가입자 요약" className="fx-hud mb-6">
      <header className="fx-hud-head">
        <h2 className="fx-hud-title">summary · 가입자 요약</h2>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="전체 가입자" value={s?.total ?? null} />
        <Tile label="오늘 신규" value={s?.today ?? null} />
        <Tile label="이번 주 신규" value={s?.week ?? null} />
        <Tile label="이번 달 신규" value={s?.month ?? null} />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="fx-label">가입 방식</dt>
          <dd className="font-mono">
            {MEMBER_METHODS.map((m) => `${METHOD_LABELS[m]} ${num(s?.byMethod[m] ?? null)}`).join(" · ")}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="fx-label">권한</dt>
          <dd className="font-mono">{MEMBER_ROLES.map((r) => `${ROLE_LABELS[r]} ${num(s?.byRole[r] ?? null)}`).join(" · ")}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs fx-muted">
        전체 = 회원(User) 전체 수(관리자 포함, 홈 &apos;가입자&apos; 카드와 같은 기준) · 신규는 한국 시간 기준(주는 월요일부터) · 소셜과 이메일을
        같이 쓰는 계정은 방식마다 한 번씩 세요
      </p>
    </section>
  );
}

function FilterForm({ query }: { query: MemberQuery }) {
  return (
    <form action={BASE} className="mb-4 flex flex-wrap items-end gap-2" method="get" role="search">
      <label className="flex min-w-0 grow basis-full flex-col gap-1 sm:basis-64">
        <span className="fx-label">이름·이메일 검색</span>
        <input
          className="h-9 w-full min-w-0 rounded-lg border px-3 text-sm"
          defaultValue={query.q}
          maxLength={MEMBERS_MAX_Q}
          name="q"
          placeholder="이름 또는 이메일 일부"
          type="search"
        />
      </label>
      <label className="flex min-w-0 grow flex-col gap-1 sm:grow-0">
        <span className="fx-label">권한</span>
        <select className="h-9 rounded-lg border px-2 text-sm" defaultValue={query.role} name="role">
          <option value="">전체</option>
          {MEMBER_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 grow flex-col gap-1 sm:grow-0">
        <span className="fx-label">가입 방식</span>
        <select className="h-9 rounded-lg border px-2 text-sm" defaultValue={query.method} name="method">
          <option value="">전체</option>
          {MEMBER_METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      {query.limit !== MEMBERS_PAGE_SIZE ? <input name="limit" type="hidden" value={query.limit} /> : null}
      <div className="flex gap-2">
        <button className="fx-btn h-9" type="submit">
          검색
        </button>
        <Link className="fx-btn h-9" href={BASE}>
          초기화
        </Link>
      </div>
    </form>
  );
}

function MemberTable({ items }: { items: MemberItem[] }) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="px-2 py-2">이름</th>
            <th className="px-2 py-2">이메일</th>
            <th className="px-2 py-2">가입 방식</th>
            <th className="px-2 py-2">권한</th>
            <th className="fx-num px-2 py-2">가입일</th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id} data-member-row="">
              <td className="max-w-[14rem] truncate px-2 py-2 font-medium" title={m.name ?? undefined}>
                {m.name || "-"}
              </td>
              <td className="max-w-[20rem] truncate px-2 py-2 font-mono" title={m.email ?? undefined}>
                {m.email || "-"}
              </td>
              <td className="px-2 py-2">{methodText(m.methods)}</td>
              <td className="px-2 py-2">
                <RoleBadge role={m.role} />
              </td>
              <td className="fx-num whitespace-nowrap px-2 py-2">{kstDateTime(m.joinedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberCards({ items }: { items: MemberItem[] }) {
  return (
    <ul className="grid gap-2 md:hidden">
      {items.map((m) => (
        <li key={m.id} className="fx-panel min-w-0 p-3" data-member-card="">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium">{m.name || "-"}</span>
            <RoleBadge role={m.role} />
          </div>
          <p className="mt-1 break-all font-mono text-sm">{m.email || "-"}</p>
          <p className="mt-1 text-xs fx-muted">
            {methodText(m.methods)} · 가입 <span className="font-mono">{kstDateTime(m.joinedAt)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function Pager({ query, list }: { query: MemberQuery; list: MemberPage }) {
  if (list.pages <= 1) return null;
  const prev = list.page > 1 ? membersHref(query, { page: list.page - 1 }) : null;
  const next = list.page < list.pages ? membersHref(query, { page: list.page + 1 }) : null;

  return (
    <nav aria-label="쪽 이동" className="mt-4 flex items-center justify-between gap-2">
      {prev ? (
        <Link className="fx-btn" href={prev} rel="prev">
          ← 이전
        </Link>
      ) : (
        <span aria-disabled className="fx-btn opacity-40">
          ← 이전
        </span>
      )}
      <span className="font-mono text-sm">
        {list.page} / {list.pages}쪽
      </span>
      {next ? (
        <Link className="fx-btn" href={next} rel="next">
          다음 →
        </Link>
      ) : (
        <span aria-disabled className="fx-btn opacity-40">
          다음 →
        </span>
      )}
    </nav>
  );
}

export default function MembersView({
  summary,
  list,
  query = EMPTY_MEMBER_QUERY,
  error = null,
}: {
  summary: MemberSummary | null;
  list: MemberPage | null;
  query?: MemberQuery;
  error?: string | null;
}) {
  const filtered = Boolean(query.q || query.role || query.method);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
          <span aria-hidden className="fx-dot fx-ok" />
          가입자 명단
        </h1>
        <p className="mt-2 text-sm fx-muted">홈페이지 회원 목록이에요. 읽기 전용이고, 이 화면은 관리자만 볼 수 있어요.</p>
      </header>

      <SummaryPanel summary={summary} />
      <FilterForm query={query} />

      <section aria-label="가입자 목록" className="fx-hud">
        <header className="fx-hud-head">
          <h2 className="fx-hud-title">members · 최신 가입순</h2>
          {list ? (
            <span className="font-mono text-xs fx-muted">
              {filtered ? "검색 결과 " : ""}
              {list.total.toLocaleString("ko-KR")}명
            </span>
          ) : null}
        </header>
        {error ? (
          <p className="fx-bad text-sm" role="alert">
            ✕ {error}{" "}
            <Link className="underline" href={BASE}>
              조건 지우기
            </Link>
          </p>
        ) : !list ? (
          <p className="text-sm fx-muted">가입자 목록을 읽지 못했어요. 잠시 뒤 다시 열어 주세요.</p>
        ) : list.items.length === 0 ? (
          <p className="py-6 text-center text-sm fx-muted" data-empty="">
            {filtered ? "조건에 맞는 가입자가 없어요. 검색어나 필터를 바꿔 보세요." : list.page > 1 ? "이 쪽에는 가입자가 없어요." : "아직 가입자가 없어요."}
          </p>
        ) : (
          <>
            <MemberTable items={list.items} />
            <MemberCards items={list.items} />
            <Pager list={list} query={query} />
          </>
        )}
        <p className="mt-3 text-xs fx-muted">
          가입일은 회원 ID(cuid)에 담긴 생성 시각이에요(한국 시간). 최근 로그인은 로그인 기록을 DB 에 남기지 않아(JWT) 보여 줄 수 없어요.
        </p>
      </section>
    </div>
  );
}
