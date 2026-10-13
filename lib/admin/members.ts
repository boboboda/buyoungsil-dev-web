// 관리자 '가입자 명단'(/admin/users 화면, /api/admin/users) 읽기 전용 조회.
// - 회원(User)에서 보여 줄 열만 select 한다. 비밀번호(해시)·세션 버전·세션·OAuth 토큰(Account 의 토큰 열)은 읽지 않는다.
// - 가입 방식: Account.provider(google·github) + 비밀번호가 있으면 '이메일'. 비밀번호는 where 조건에만 쓰고 값은 읽지 않는다.
// - 가입일: User 에 가입 시각 열이 없어 id(Prisma cuid: 'c' 다음 8글자가 만든 시각 ms 의 36진수)에서 읽는다. cuid 가 아니면 null.
//   최신 가입순 = id 내림차순, 신규 가입자 수 = id 가 그 시각의 cuid 앞부분 이상인 행 수.
// - 최근 로그인: 로그인이 JWT 방식이라 DB 에 기록이 없어 보여 주지 않는다.
// - 전체 가입자 수는 홈 '가입자' 카드와 같은 기준(User 전체 행 수, 관리자 포함).
// 로그에는 오류 종류만 남긴다(검색어·이메일 같은 개인정보가 오류 메시지에 섞여 나가지 않게).
import type { Prisma, PrismaClient } from "@prisma/client";

export const MEMBER_ROLES = ["admin", "user"] as const;
export const MEMBER_METHODS = ["email", "google", "github"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type MemberMethod = (typeof MEMBER_METHODS)[number];

export const ROLE_LABELS: Record<MemberRole, string> = { admin: "관리자", user: "회원" };
export const METHOD_LABELS: Record<string, string> = { email: "이메일", google: "Google", github: "GitHub" };

export const MEMBERS_PAGE_SIZE = 25;
export const MEMBERS_MAX_LIMIT = 100;
export const MEMBERS_MAX_Q = 100;
const MAX_PAGE = 100_000;

export type MemberQuery = {
  q: string;
  role: MemberRole | "";
  method: MemberMethod | "";
  page: number;
  limit: number;
};

export type MemberItem = {
  id: string;
  name: string | null;
  email: string | null;
  role: MemberRole;
  methods: string[]; // "email" | "google" | "github" | 그 밖의 provider 이름
  joinedAt: string | null; // ISO, id 에서 읽은 가입 시각
};

export type MemberPage = {
  items: MemberItem[];
  total: number; // 조건에 맞는 수
  page: number;
  pages: number;
  limit: number;
};

// null = 세지 못함(쿼리 실패)
export type MemberSummary = {
  total: number | null;
  today: number | null;
  week: number | null;
  month: number | null;
  byMethod: Record<MemberMethod, number | null>;
  byRole: Record<MemberRole, number | null>;
};

export type MembersDb = {
  user: Pick<PrismaClient["user"], "count" | "findMany">;
};

export const EMPTY_MEMBER_QUERY: MemberQuery = { q: "", role: "", method: "", page: 1, limit: MEMBERS_PAGE_SIZE };

/** 화면·API 주소의 값 검사. 틀린 값이면 error(→ 400). limit 은 100 을 넘으면 100 으로 묶는다 */
export function parseMemberQuery(get: (key: string) => string | null | undefined): { query: MemberQuery; error?: undefined } | { error: string; query?: undefined } {
  const q = (get("q") ?? "").trim();
  if (q.length > MEMBERS_MAX_Q) return { error: `검색어는 ${MEMBERS_MAX_Q}자까지예요.` };

  const role = get("role") ?? "";
  if (role !== "" && !(MEMBER_ROLES as readonly string[]).includes(role)) return { error: "권한은 admin | user 중 하나예요." };

  const method = get("method") ?? "";
  if (method !== "" && !(MEMBER_METHODS as readonly string[]).includes(method)) return { error: "가입 방식은 email | google | github 중 하나예요." };

  const pageText = get("page") ?? "";
  if (pageText !== "" && !/^\d{1,6}$/.test(pageText)) return { error: "page 는 1 이상의 숫자예요." };
  const page = pageText === "" ? 1 : Number(pageText);
  if (page < 1 || page > MAX_PAGE) return { error: "page 는 1 이상의 숫자예요." };

  const limitText = get("limit") ?? "";
  if (limitText !== "" && !/^\d{1,6}$/.test(limitText)) return { error: `limit 은 1~${MEMBERS_MAX_LIMIT} 숫자예요.` };
  const limit = limitText === "" ? MEMBERS_PAGE_SIZE : Number(limitText);
  if (limit < 1) return { error: `limit 은 1~${MEMBERS_MAX_LIMIT} 숫자예요.` };

  return {
    query: { q, role: role as MemberQuery["role"], method: method as MemberQuery["method"], page, limit: Math.min(limit, MEMBERS_MAX_LIMIT) },
  };
}

// ── 가입 시각(cuid) ──
const CUID_RE = /^c[0-9a-z]{24}$/;
const MIN_JOIN = Date.UTC(2020, 0, 1);

/** cuid 의 만든 시각(ms). cuid 가 아니거나 말이 안 되는 시각이면 null */
export function joinedAtFromId(id: string, now = Date.now()): number | null {
  if (!CUID_RE.test(id)) return null;
  const ms = parseInt(id.slice(1, 9), 36);

  return ms >= MIN_JOIN && ms <= now + 24 * 3600_000 ? ms : null;
}

/** 이 시각 이후에 만든 cuid 조건(문자열 비교: 'c' + 36진수 시각 8글자) */
export function joinedSinceWhere(ms: number): Prisma.UserWhereInput {
  return { id: { gte: `c${Math.floor(ms).toString(36)}`, lt: "d" } };
}

const KST = 9 * 3600_000;
const DAY = 24 * 3600_000;

/** 한국 시간 기준 오늘 0시·이번 주 월요일 0시·이번 달 1일 0시(ms) */
export function kstPeriodStarts(now: number) {
  const today = Math.floor((now + KST) / DAY) * DAY - KST;
  const dow = new Date(today + KST).getUTCDay(); // 0=일
  const week = today - ((dow + 6) % 7) * DAY;
  const d = new Date(now + KST);
  const month = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - KST;

  return { today, week, month };
}

// ── 조건 ──
const ROLE_WHERE: Record<MemberRole, Prisma.UserWhereInput> = {
  admin: { role: "admin" },
  // 관리자가 아니면 모두 회원(role 이 비었거나 예전 값이어도). SQL 의 <> 는 NULL 을 빼므로 따로 넣는다
  user: { OR: [{ role: { not: "admin" } }, { role: null }] },
};
const METHOD_WHERE: Record<MemberMethod, Prisma.UserWhereInput> = {
  email: { password: { not: null } },
  google: { accounts: { some: { provider: "google" } } },
  github: { accounts: { some: { provider: "github" } } },
};

/** 검색어는 Prisma contains(파라미터 바인딩)로만 쓴다 */
export function memberWhere(query: Pick<MemberQuery, "q" | "role" | "method">): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [];
  if (query.q)
    and.push({
      OR: [
        { name: { contains: query.q, mode: "insensitive" } },
        { email: { contains: query.q, mode: "insensitive" } },
      ],
    });
  if (query.role) and.push(ROLE_WHERE[query.role]);
  if (query.method) and.push(METHOD_WHERE[query.method]);

  return and.length ? { AND: and } : {};
}

// 화면에 보여 줄 열만. 비밀번호·세션 버전·토큰은 여기에 넣지 않는다
export const MEMBER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  accounts: { select: { provider: true } },
} satisfies Prisma.UserSelect;

/** 최신 가입순 한 쪽 */
export async function listMembers(db: MembersDb, query: MemberQuery, now = Date.now()): Promise<MemberPage> {
  const where = memberWhere(query);
  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: MEMBER_SELECT,
    }),
  ]);
  // 이메일(비밀번호) 가입 여부: 비밀번호 값은 읽지 않고 '있는 행의 id' 만 받는다
  const ids = rows.map((r) => r.id);
  const withPassword = ids.length
    ? new Set((await db.user.findMany({ where: { id: { in: ids }, password: { not: null } }, select: { id: true } })).map((r) => r.id))
    : new Set<string>();

  const items = rows.map((r): MemberItem => {
    const providers = [...new Set(r.accounts.map((a) => a.provider))];
    const joined = joinedAtFromId(r.id, now);

    return {
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role === "admin" ? "admin" : "user",
      methods: [...(withPassword.has(r.id) ? ["email"] : []), ...providers],
      joinedAt: joined === null ? null : new Date(joined).toISOString(),
    };
  });

  return { items, total, page: query.page, pages: Math.max(1, Math.ceil(total / query.limit)), limit: query.limit };
}

async function safeCount(run: () => PromiseLike<number>): Promise<number | null> {
  try {
    return await run();
  } catch (error) {
    console.error("가입자 집계 실패:", error instanceof Error ? error.name : "unknown");

    return null;
  }
}

/** 상단 요약: 하나가 실패해도 그 칸만 null */
export async function memberSummary(db: MembersDb, now = Date.now()): Promise<MemberSummary> {
  const { today, week, month } = kstPeriodStarts(now);
  const count = (where?: Prisma.UserWhereInput) => safeCount(() => db.user.count(where ? { where } : undefined));
  const [total, t, w, m, email, google, github, admin, user] = await Promise.all([
    count(), // 홈 '가입자' 카드와 같은 기준: prisma.user.count()
    count(joinedSinceWhere(today)),
    count(joinedSinceWhere(week)),
    count(joinedSinceWhere(month)),
    count(METHOD_WHERE.email),
    count(METHOD_WHERE.google),
    count(METHOD_WHERE.github),
    count(ROLE_WHERE.admin),
    count(ROLE_WHERE.user),
  ]);

  return { total, today: t, week: w, month: m, byMethod: { email, google, github }, byRole: { admin, user } };
}
