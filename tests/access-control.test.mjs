// 노트 접근 규칙 시험: 비로그인 / 일반 회원 / 관리자 × 초급·중급·고급
// 실행: npm run test:access-control
// TS 파일을 typescript 로 임시 폴더에 변환해서 불러온다(별도 실행 도구 없이 node 만으로 돌리기 위해).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = new URL("..", import.meta.url);
const dir = mkdtempSync(join(tmpdir(), "access-control-"));

function transpile(rel, out, replace = (s) => s) {
  const src = readFileSync(new URL(rel, root), "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  writeFileSync(join(dir, out), replace(js));
}

try {
  transpile("types/access-control.ts", "types.mjs");
  transpile("lib/utils/access-control.ts", "utils.mjs", (s) =>
    s.replace(/["']@\/types\/access-control["']/g, '"./types.mjs"'),
  );
  const { ACCESS_MATRIX } = await import(pathToFileURL(join(dir, "types.mjs")).href);
  const { canAccessContent, resolveUserRole, getAccessMessage, getRequiredRole } = await import(
    pathToFileURL(join(dir, "utils.mjs")).href
  );

  // 역할 목록에 후원자가 없어야 한다
  assert.deepEqual(Object.keys(ACCESS_MATRIX).sort(), ["admin", "guest", "user"]);

  const expected = {
    guest: { BEGINNER: true, INTERMEDIATE: false, ADVANCED: false },
    user: { BEGINNER: true, INTERMEDIATE: true, ADVANCED: true },
    admin: { BEGINNER: true, INTERMEDIATE: true, ADVANCED: true },
  };
  for (const [role, levels] of Object.entries(expected)) {
    for (const [level, ok] of Object.entries(levels)) {
      assert.equal(canAccessContent(role, level), ok, `${role} × ${level}`);
    }
  }

  // 세션 role → 접근 역할
  assert.equal(resolveUserRole(false, undefined), "guest");
  assert.equal(resolveUserRole(false, "admin"), "guest");
  assert.equal(resolveUserRole(true, "admin"), "admin");
  assert.equal(resolveUserRole(true, "user"), "user");
  // DB 에 예전 값(supporter)이나 빈 값이 남아 있어도 일반 회원과 같게
  assert.equal(resolveUserRole(true, "supporter"), "user");
  assert.equal(resolveUserRole(true, null), "user");
  assert.equal(canAccessContent(resolveUserRole(true, "supporter"), "ADVANCED"), true);

  // 비로그인 고급 노트 안내는 로그인 안내
  assert.match(getAccessMessage("guest", "ADVANCED"), /회원가입/);
  assert.equal(getAccessMessage("user", "ADVANCED"), "");
  assert.equal(getRequiredRole("ADVANCED"), "user");

  console.log("access-control: 통과");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
