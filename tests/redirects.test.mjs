// 옛 주소 301 시험: 메뉴·페이지 통합으로 없어진 주소가 새 정식 주소로 영구 이동하는지
// 실행: npm run test:redirects
// next.config.js 의 redirects() 를 불러 Next 가 쓰는 주소 매칭(getPathMatch)으로 그대로 맞춰 본다.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

import nextConfig from "../next.config.js";

const require = createRequire(import.meta.url);
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match");

const root = new URL("..", import.meta.url);
const rules = await nextConfig.redirects();

// Next 와 같은 방식으로 첫 번째로 맞는 규칙을 찾아 목적지를 만든다
function resolve(pathname) {
  for (const rule of rules) {
    const params = getPathMatch(rule.source, { removeUnnamedParams: true })(pathname);
    if (params) return { destination: rule.destination, statusCode: rule.statusCode, permanent: rule.permanent };
  }
  return null;
}

const moved = {
  "/stories": "/note?tab=stories",
  "/release": "/project",
  "/release/notice/abc123": "/project",
  "/release/post/abc123": "/project",
  "/release/some-app": "/project",
  "/work-request": "/contact?type=work",
  "/admin/claude": "/admin/factory?tab=usage",
};

for (const [from, to] of Object.entries(moved)) {
  const hit = resolve(from);
  assert.ok(hit, `${from} 에 리다이렉트가 없음`);
  assert.equal(hit.destination, to, `${from} → ${hit.destination} (기대: ${to})`);
  assert.equal(hit.statusCode, 301, `${from} 은 301 이어야 함`);
}

// 그대로 살아 있어야 하는 주소 (이야기 상세는 공유된 주소라 옮기지 않는다)
const kept = [
  "/stories/my-first-story",
  "/note",
  "/project",
  "/project/some-app",
  "/contact",
  "/api/public/projects",
  "/admin/stories",
  "/admin/works",
  // 통제실 옛 주소는 그대로 열린다(해당 탭을 보여 줌)
  "/admin/factory",
  "/admin/factory/release",
  "/admin/factory/settings",
];
for (const path of kept) {
  assert.equal(resolve(path), null, `${path} 은 리다이렉트되면 안 됨`);
}

// 목적지 화면이 있고, 없어진 목록 화면은 지워졌는지 (남아 있으면 헷갈림)
for (const file of [
  "app/note/page.tsx",
  "app/project/page.tsx",
  "app/contact/page.tsx",
  "app/stories/[slug]/page.tsx",
  "app/api/public/projects/route.ts",
]) {
  assert.ok(existsSync(new URL(file, root)), `${file} 이 없음`);
}
for (const file of ["app/stories/page.tsx", "app/release/page.tsx", "app/work-request/page.tsx", "app/admin/claude/page.tsx"]) {
  assert.ok(!existsSync(new URL(file, root)), `${file} 이 남아 있음`);
}

console.log(`redirects: ${Object.keys(moved).length}개 301 확인, ${kept.length}개 유지 확인`);
