// config/redirects.mjs
// 메뉴·페이지 통합으로 없어진 옛 주소 → 새 정식 주소 (301 영구 이동).
// next.config.js 가 그대로 쓰고, tests/redirects.test.mjs 가 시험한다.
// 이야기 상세(/stories/:slug)는 이미 공유된 주소라 옮기지 않는다(목록만 개발노트 탭으로 이동).
export const legacyRedirects = [
  // 비개발자 이야기 목록 → 개발노트 '이야기' 탭
  { source: "/stories", destination: "/note?tab=stories", statusCode: 301 },
  // 릴리즈 목록·하위 주소 → 프로젝트
  { source: "/release", destination: "/project", statusCode: 301 },
  { source: "/release/:path*", destination: "/project", statusCode: 301 },
  // 외주 신청 → 문의·의뢰 페이지의 '외주 의뢰'
  { source: "/work-request", destination: "/contact?type=work", statusCode: 301 },
];
