// 감독 시험 전부 돌리기: tests/*.test.mjs 를 node --test 로. (node 20 은 명령줄 글롭이 없고, 폴더를 주면 fixtures 같은 보조 파일도 시험으로 돌려서 파일 목록을 직접 만든다)
// 동시에 돌리는 파일은 3개로 제한한다(기본값은 CPU 수라 부하가 크면 정비 턴 시험 3개가 시간 초과로 흔들렸다).
// 실행: node tests/run-all.mjs [파일 이름 일부…]   (이름 일부를 주면 그 이름이 들어간 시험만)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = fs
  .readdirSync(HERE)
  .filter((f) => f.endsWith(".test.mjs") && (!only.length || only.some((o) => f.includes(o))))
  .sort()
  .map((f) => path.join(HERE, f));
if (!files.length) {
  console.error("돌릴 시험이 없어요.");
  process.exit(1);
}
const r = spawnSync(process.execPath, ["--test", "--test-concurrency=3", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
