// 에이전트 정의 스냅샷 시험의 공통 입력(가짜 공장 폴더·환경변수·일감). 기준 파일(agent-golden.json)을 만든 때와 시험 때 같은 입력을 쓴다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE_ENV = {
  PATH: "/usr/bin", HOME: "/home/x", LANG: "ko", FOO: "bar", GITHUB_TOKEN: "t", MY_API_KEY: "k", DB_PASSWORD: "p", SERVERCTL_VALUE: "v", FACTORY_MAINTENANCE: "old",
};
export const CFG = { claudeCmd: "claude", codexModel: "", workDir: "" };
export const AI_SECRETS = { STORE_API_KEY: "secret-store", PIXELLAB_TOKEN: "secret-pixel" };
export const JOB_ID = "cmjob00000000001";
export const SESSION = "0f25374d-65f8-4ec9-8bac-76b99879517b";

/** 임시 공장 폴더(고정 이름 아래)를 새로 만든다. 항목 이름이 정해져 있어 설정 파일 내용이 항상 같다 */
export function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "agentspec-"));
  const workDir = path.join(base, "factory");
  fs.mkdirSync(workDir);
  for (const d of ["selfdev", "supervisor-src", "lab", "app-a", "tooljobs"]) fs.mkdirSync(path.join(workDir, d));
  for (const f of ["secrets.env", "supervisor.config.json", "run-supervisor.sh", "x.json"]) fs.writeFileSync(path.join(workDir, f), "");
  return { base, workDir, selfdevDir: path.join(workDir, "selfdev"), supervisorSrc: path.join(workDir, "supervisor-src") };
}

const slash = (p) => path.resolve(p).replace(/\\/g, "/");
const ruleAbs = (p) => slash(p).replace(/^([A-Za-z]):/, (_, d) => d.toLowerCase()).replace(/^\/+/, "");

/** 임시 폴더 경로(여러 표기)를 <ROOT> 로 바꿔 어느 PC·실행에서도 같은 글이 되게 한다 */
export function normalizer(base) {
  const sup = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const forms = [[base, "<ROOT>"], [path.resolve(base), "<ROOT>"], [slash(base), "<ROOT>"], [ruleAbs(base), "<ROOT>"], [sup, "<SUP>"], [slash(sup), "<SUP>"]].sort((a, b) => b[0].length - a[0].length);
  const fix = (v) => (typeof v === "string" ? v.replace(/\\/g, "/") : Array.isArray(v) ? v.map(fix) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fix(x)])) : v);
  return (value) => {
    let text = JSON.stringify(value ?? null);
    for (const [f, tag] of forms) text = text.split(JSON.stringify(f).slice(1, -1)).join(tag);
    return fix(JSON.parse(text));
  };
}
