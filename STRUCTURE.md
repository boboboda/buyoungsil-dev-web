# 구조 (블로그 developweb)

- 공개: `app/(main)`, `app/note`, `app/project`, `app/stories`, `app/novel`(공개 읽기 전용, `lib/novel/public.ts`+`rules.ts`), `app/contact`, `app/about`.
- 관리자 `/admin/**`: 대시보드·노트·프로젝트·이야기·초안함·카테고리·문의함·외주·가입자·분석·**설정(`/admin/settings`, 연결 키 만들기·폐기)**. 상단 [통제실] 링크는 `/api/admin/handoff?to=/admin/factory`(1회용 토큰으로 factory.buyoungsilcoding.com 로그인 넘김).
- API: `api/admin/{drafts,edu,users,handoff}`, `api/admin/factory/connection-keys`(연결 키 API, 경로 유지), `api/mcp`(초안함 커넥터 도구 4개), `api/drafts`, `api/edu`, `api/notes`, `api/analytics`, `api/auth` 등.
- 공장·스튜디오·텔레그램·소설 작업 코드는 factory-web 저장소로 옮겼고 여기서 지웠다(DB 모델·마이그레이션은 그대로 둠).
- 인증: `lib/auth/*`(`requireAdmin`, `handoff`), `middleware.ts`(보안 필터·/admin 보호).
- 연결 키: `lib/connection-keys.ts`, `lib/connect/{adminKeys,guard,pepper}.ts`, 화면 `components/admin/settings/ConnectionKeys.tsx`.
- 시험: `tests/*.test.mjs`(`npm test`). 빌드에는 가짜 `DATABASE_URL`·`MONGODB_URI` 필요.
- 환경변수 이름: DATABASE_URL, MONGODB_URI, AUTH_SECRET/NEXTAUTH_SECRET, DRAFT_API_TOKEN, CONTROL_HANDOFF_SECRET, CONTROL_PUBLIC_URL, STUDIO_KEY_PEPPER(선택).
- 작업 지도: [WORKMAP.md](WORKMAP.md) (기능→파일, 시험, 빌드 주의점, DB)
