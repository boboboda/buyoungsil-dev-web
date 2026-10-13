// 6단계 정리 시험: 게시판 두 주소 유지, /release 301 유지, 지운 관리자 화면이 라우트로 안 잡힘,
// 관리자 대시보드 숫자가 DB 없이도(쿼리 실패) 빈 값으로 나오는지.
// 실행: npm run test:admin-cleanup
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import nextConfig from "../next.config.js";

const root = new URL("..", import.meta.url);
const has = (rel) => existsSync(new URL(rel, root));
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

// (1) 게시판 주소: 출시된 앱 WebView 가 쓰는 /app/board/... 와 홈페이지 /project/.../board/... 둘 다 있어야 한다
const boardPages = {
  app: [
    "app/app/board/[name]/[postType]/page.tsx",
    "app/app/board/[name]/[postType]/detail/[postId]/page.tsx",
    "app/app/board/[name]/[postType]/write/page.tsx",
  ],
  site: [
    "app/project/[name]/board/[postType]/page.tsx",
    "app/project/[name]/board/[postType]/detail/[postId]/page.tsx",
    "app/project/[name]/board/[postType]/write/page.tsx",
  ],
};
for (const [variant, files] of Object.entries(boardPages)) {
  for (const file of files) {
    assert.ok(has(file), `${file} 가 없음`);
    assert.match(read(file), new RegExp(`variant="${variant}"`), `${file} 는 variant="${variant}" 로 공통 본문을 불러야 함`);
    assert.doesNotMatch(read(file), /console\.log/, `${file} 에 console.log 가 남아 있음`);
  }
}
assert.ok(has("app/app/enter/route.ts"), "/app/enter 가 없음");
// 앱 쪽은 매번 새로 그린다(force-dynamic) — 목록·상세
for (const file of boardPages.app.slice(0, 2)) {
  assert.match(read(file), /export const dynamic = "force-dynamic"/, `${file} 에 force-dynamic 이 없음`);
}
assert.ok(!has("components/release"), "components/release 폴더가 남아 있음");

// /release 301 은 유지
const rules = await nextConfig.redirects();
for (const source of ["/release", "/release/:path*"]) {
  const rule = rules.find((r) => r.source === source);
  assert.ok(rule, `${source} 301 이 없음`);
  assert.equal(rule.destination, "/project");
  assert.equal(rule.statusCode, 301);
}

// (2) 지운 화면은 page 파일이 없어야 라우트로 안 잡힌다
for (const dir of ["app/admin/register", "app/admin/list", "app/admin/security"]) {
  for (const f of ["page.tsx", "page.ts", "page.jsx", "page.js", "route.ts"]) {
    assert.ok(!has(`${dir}/${f}`), `${dir}/${f} 가 남아 있음`);
  }
}

// (3) 대시보드 숫자: 쿼리가 모두 실패해도 throw 하지 않고 null, 일부만 실패하면 그 칸만 null
const dir = mkdtempSync(join(tmpdir(), "admin-cleanup-"));
try {
  const js = ts.transpileModule(read("lib/admin/dashboardCounts.ts"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  writeFileSync(join(dir, "counts.mjs"), js);
  const { getDashboardCounts } = await import(pathToFileURL(join(dir, "counts.mjs")).href);

  const models = ["project", "developNote", "story", "workRequest", "post", "eduPost", "draft"];
  const fake = (count) => Object.fromEntries(models.map((m) => [m, { count: (args) => count(m, args) }]));

  const broken = await getDashboardCounts(fake(() => Promise.reject(new Error("DB 없음"))));
  for (const [key, value] of Object.entries(broken)) assert.equal(value, null, `${key} 는 null 이어야 함`);

  const syncThrow = await getDashboardCounts(fake(() => { throw new Error("동기 실패"); }));
  assert.equal(syncThrow.pendingDrafts, null);

  const seen = [];
  const ok = await getDashboardCounts(
    fake((m, args) => {
      seen.push([m, JSON.stringify(args ?? null)]);
      if (m === "draft") return Promise.reject(new Error("테이블 없음"));
      return Promise.resolve(m === "post" ? 0 : 3);
    }),
  );
  assert.equal(ok.pendingDrafts, null);
  assert.equal(ok.unansweredBoardPosts, 0);
  assert.equal(ok.pendingWorkRequests, 3);
  assert.equal(ok.unansweredEduPosts, 3);
  // 기존 스키마 값으로 센다
  const where = (m) => seen.filter(([x]) => x === m).map(([, a]) => a);
  assert.ok(where("workRequest").includes(JSON.stringify({ where: { status: "pending" } })));
  assert.ok(where("draft").includes(JSON.stringify({ where: { status: "pending" } })));
  assert.ok(where("post").includes(JSON.stringify({ where: { postType: "post", comments: { none: {} } } })));
  assert.ok(where("eduPost").includes(JSON.stringify({ where: { replies: { none: {} } } })));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("admin-cleanup: 게시판 주소 6개·/release 301·삭제 라우트 3개·대시보드 빈 값 시험 통과");
