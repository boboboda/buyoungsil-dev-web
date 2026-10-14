// 오래된 사본 표시 시험: 감독 프로그램이 작업 폴더 아래 오래된 사본(.git 이 있는 buyoungsil-dev-web)을 찾으면 이름만 /next 에 붙이고,
// 서버가 이름 모양을 걸러 받아 상태에 싣고, 통제실 감독 카드에 '정리 필요'로 보인다. 지우지는 않는다(사람이 한다).
// 실행: npm run test:stale-copies
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8").replace(/\r\n/g, "\n");

// 감독 프로그램의 staleCopyQuery 를 소스에서 꺼내 임시 폴더로 돌린다
function loadQuery(workDir) {
  const src = read("tools/factory-supervisor/supervisor.mjs");
  const start = src.indexOf("const STALE_COPY_DIRS");
  const end = src.indexOf('let memoryLine = ""');
  assert.ok(start > 0 && end > start, "staleCopyQuery 소스를 찾지 못함");
  const body = src.slice(start, end);
  return new Function("fs", "path", "fileURLToPath", "cfg", "import_meta_url", `${body.replace(/import\.meta\.url/g, "import_meta_url")}\nreturn staleCopyQuery;`)(fs, path, fileURLToPath, { workDir }, pathToFileURL(path.join(repo, "tools/factory-supervisor/supervisor.mjs")).href);
}

test("사본 폴더(.git 있음)가 있으면 이름만 알린다. 없거나 .git 이 없으면 아무것도 안 붙인다", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stale-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const q = loadQuery(dir);
  assert.deepEqual(q(), {});
  fs.mkdirSync(path.join(dir, "buyoungsil-dev-web"));
  assert.deepEqual(q(), {}, ".git 이 없으면 사본이 아니다");
  fs.mkdirSync(path.join(dir, "buyoungsil-dev-web", ".git"));
  assert.deepEqual(q(), { staleCopies: "buyoungsil-dev-web" });
  assert.ok(fs.existsSync(path.join(dir, "buyoungsil-dev-web", ".git")), "지우지 않는다");
});

test("서버: 이름 모양이 맞는 것만 받고, 상태에 목록으로 싣고, 감독 카드에 정리 필요로 보인다", () => {
  const route = read("app/api/factory/next/route.ts");
  assert.match(route, /param\("staleCopies", 200\)/);
  assert.match(route, /\^\[A-Za-z0-9\]\[A-Za-z0-9_\.-\]\{0,59\}\$/);
  assert.match(route, /^\s+staleCopies,$/m);
  assert.match(read("lib/factory/supervisor.ts"), /staleCopies: online && rt\.staleCopies \? rt\.staleCopies\.split/);
  assert.match(read("lib/factory/settings.ts"), /staleCopies\?: string;/);
  const ui = read("components/admin/factory/SupervisorControl.tsx");
  assert.match(ui, /data-stale-copies/);
  assert.match(ui, /오래된 사본\(정리 필요\)/);
});
