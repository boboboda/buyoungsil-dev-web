// 모든 시험(tests/*.test.mjs)을 하나씩 돌리고 표로 요약한다.
// 실행: npm test            (전부, 차례로)
//       npm test -- name    (파일 이름에 name 이 들어간 것만)
//       npm test -- --jobs=4  (동시에 4개씩. 기본 1)
// 하나라도 실패하면 종료 코드 1. 개별 시험은 package.json 의 test:* 스크립트로도 그대로 돌릴 수 있다.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = ["tests"];
const args = process.argv.slice(2);
const jobs = Math.max(1, Number(args.find((a) => a.startsWith("--jobs="))?.slice(7)) || 1);
const filters = args.filter((a) => !a.startsWith("--"));
const TIMEOUT_MS = 10 * 60_000;

const files = dirs
  .flatMap((d) => fs.readdirSync(path.join(repo, d)).filter((f) => f.endsWith(".test.mjs")).map((f) => `${d}/${f}`))
  .filter((f) => !filters.length || filters.some((x) => f.includes(x)));

function run(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    const child = spawn(process.execPath, [file], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => chunks.push(d));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ file, ok: code === 0, code: code ?? signal, ms: Date.now() - started, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (next < files.length) {
      const r = await run(files[next++]);
      results.push(r);
      console.log(`${r.ok ? "통과" : "실패"}  ${(r.ms / 1000).toFixed(1).padStart(6)}초  ${r.file}`);
    }
  }),
);

const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  const lines = r.output.split("\n").filter((l) => /^\s*not ok|^# Error|error:|Error:/.test(l));
  console.log(`\n── ${r.file} (종료 ${r.code}) ──\n${lines.slice(0, 12).join("\n") || r.output.slice(-1500)}`);
}
console.log(`\n시험 파일 ${results.length}개 중 통과 ${results.length - failed.length}, 실패 ${failed.length}`);
process.exit(failed.length || !results.length ? 1 : 0);
