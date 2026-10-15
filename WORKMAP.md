# WORKMAP — 일감 시작 때 먼저 읽는 작업 지도 (블로그 developweb)

자세한 구조는 [STRUCTURE.md](STRUCTURE.md). 이 문서는 "어디를 고치나"만 빠르게 찾는 용도다. 코드와 다르면 코드가 맞다.

## 기능 → 파일

| 기능 | 화면 | API / 로직 |
|---|---|---|
| 홈 | `app/(main)/page.tsx`, `lib/admin/dashboardCounts.ts` | `app/api/visitor-record`, `app/api/public` |
| 노트(개발노트) 공개 | `app/note/page.tsx`, `app/note/[slug]`, `app/note/detail` | `lib/note/*`, `app/api/notes`, 모델 DevelopNote·NoteCategory |
| 프로젝트 공개 | `app/project/page.tsx`, `app/project/[name]` | `serverActions/projects.ts`, `lib/projects/createProjectRecord.ts` |
| 이야기 공개 | `app/stories/page.tsx`, `app/stories/[slug]` | 모델 Story |
| 소설 공개(읽기 전용) | `app/novel/page.tsx`, `app/novel/[slug]` | `lib/novel/public.ts`, `lib/novel/rules.ts` |
| 문의·소개·약관 | `app/contact`, `app/about`, `app/privacy` | `app/api/notice`, 모델 WorkRequest |
| 상단 메뉴·공통 레이아웃 | `components/main/navBar.tsx`, `app/layout.tsx`, `config/site.ts` | — |
| 관리자 공통 | `app/admin/layout.tsx`, `app/admin/page.tsx`, `app/admin/admin-ui.css` | `lib/auth/requireAdmin.ts`, `middleware.ts` |
| 관리자 노트·카테고리·글쓰기 | `app/admin/notes`, `categories`, `write`, `app/editor` | `lib/note/*`, `components/editor` |
| 관리자 프로젝트·매출·이야기 | `app/admin/projects`, `revenues`, `stories` | `serverActions/projects.ts` |
| 초안함 | `app/admin/drafts/page.tsx` | `app/api/admin/drafts`, `app/api/drafts`, `lib/drafts/*`, 모델 Draft |
| 게시판(교육·프로젝트 보드) | `app/admin/boards`, `app/admin/edu` | `app/api/admin/edu`, `app/api/edu`, `lib/edu/*`, 모델 EduPost·Post·Comment |
| 가입자·로그 | `app/admin/users`, `app/admin/logs` | `app/api/admin/users`, `lib/admin/members.ts` |
| 분석 화면 | `app/admin/analytics/page.tsx` | `lib/analytics/{stats,liveStats,adStats,serverStats}.ts` |
| 분석 수집 API | — | `app/api/analytics/collect`, `lib/analytics/{ingest,registerApp}.ts` |
| 설정·연결 키 | `app/admin/settings/page.tsx`, `components/admin/settings/ConnectionKeys.tsx` | `app/api/admin/factory/connection-keys`(경로 유지), `lib/connection-keys.ts`, `lib/connect/{adminKeys,guard,pepper}.ts` |
| 초안함 커넥터(도구 4개: `list_categories`, `list_existing_titles`, `create_sub_category`, `save_draft`) | — | `app/api/mcp/route.ts`, `lib/mcp/rpc.ts`, `lib/drafts/mcp.ts` |
| 로그인 | `app/signin`, `app/signup` | `lib/auth/auth.ts`, `app/api/auth` |
| [통제실] 넘김 | 관리자 상단 링크 | `app/api/admin/handoff/route.ts`, `lib/auth/handoff.ts` (`CONTROL_HANDOFF_SECRET`, `CONTROL_PUBLIC_URL`) |
| 리다이렉트 | — | `config/redirects.mjs` (next.config.js에서 사용) |

## 자주 고치는 곳 상위 10개 (git log 최근 400커밋, 남아 있는 파일만)

1. `package.json` 2. `prisma/schema.prisma` 3. `components/main/navBar.tsx` 4. `types/index.ts`
5. `Dockerfile` 6. `config/site.ts` 7. `serverActions/projects.ts` 8. `app/admin/page.tsx`
9. `middleware.ts` 10. `app/layout.tsx` (그다음 `lib/auth/auth.ts`, `components/admin/projects/ProjectForm.tsx`)

## 시험 (남은 9개)

- 위치 `tests/*.test.mjs`: access-control, admin-cleanup, admin-contrast, admin-users, connection-keys, control-handoff, home-stats, mcp-rpc, redirects.
- 실행: `npm test` (전부, 차례로) / `npm test -- <이름 일부>` (일부) / `npm test -- --jobs=4` (동시 4개). 러너는 `scripts/run-all-tests.mjs`.
- lint: `npm run lint`(기존 오류 24개 있음, `components/admin/boards`·`components/editor` 등).

## 빌드 주의점

- `npm run build` = `prisma generate && next build`. 빌드에 가짜 `DATABASE_URL`과 `MONGODB_URI`가 **둘 다** 필요하다(값은 형식만 맞으면 됨).
- `tsc --noEmit` 전에 `.next/types`를 지운다(안 지우면 지워진 경로의 타입 오류가 난다).
- 환경변수 이름: DATABASE_URL, MONGODB_URI, AUTH_SECRET/NEXTAUTH_SECRET, DRAFT_API_TOKEN, CONTROL_HANDOFF_SECRET, CONTROL_PUBLIC_URL, STUDIO_KEY_PEPPER(선택).

## DB

- 블로그는 마이그레이션을 실행하지 않는다. 스키마 주인은 factory-web이고, 여기 `prisma/schema.prisma`는 공유 DB의 사본이다(Dockerfile에서 `migrate deploy` 안 함). 스키마를 바꿔야 하면 factory-web 쪽과 맞춘다.
- 블로그 코드가 쓰는 표: User·Account·Session·VerificationToken, DevelopNote·NoteCategory·NoteSubCategory, Project·ProjectTag·ProjectLog·Tag·App, Revenue, Story, Post·Comment·Reply, EduPost·EduReply, WorkRequest, DailyVisitorCount·TotalVisitorCount, Draft, AnalyticsApp·AnalyticsEvent·AnalyticsInstall·DailyActiveInstall, ControlConnectionKey, NovelWork·NovelEpisode(공개 소설 읽기만).
- 스키마에 있어도 블로그가 안 쓰는 표(Factory*, Studio*, Novel 작업류, Claude*, AiUsageLimit, DeviceStat*)는 factory-web 소유다.

## 이 저장소에 없는 것

- 공장(통제실 화면·API·작업 대기열), 스튜디오, 텔레그램, 소설 작업 실행: factory-web 저장소 (factory.buyoungsilcoding.com).
- 감독 프로그램(작업 PC 실행기·serverctl·정비): factory-supervisor 저장소.
- 블로그에는 [통제실] 로그인 넘김(`/api/admin/handoff`)과 연결 키 발급 화면만 남아 있다.
