// Windows factory jobs deliver Swift sources/XcodeGen manifests; compiling remains a Mac check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function checkSwiftSources(dir) {
  const manifest = path.join(dir, "project.yml");
  if (!fs.existsSync(manifest) || !fs.readFileSync(manifest, "utf8").trim()) return { ok: false, reason: "XcodeGen project.yml이 없습니다." };
  const sources = [];
  const walk = (folder) => {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (item.isSymbolicLink() || [".git", ".factory", "node_modules", "build", "Pods"].includes(item.name)) continue;
      const full = path.join(folder, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile() && item.name.endsWith(".swift")) sources.push(full);
    }
  };
  walk(dir);
  if (!sources.length || sources.some((f) => !fs.readFileSync(f, "utf8").trim())) return { ok: false, reason: "비어 있지 않은 Swift 소스가 필요합니다." };
  return { ok: true, scope: "source-only", note: "Swift 소스와 XcodeGen 구성 확인. 컴파일·앱 실행은 Mac에서 별도 검증해야 합니다." };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = checkSwiftSources(path.resolve(process.argv[2] || ".")); console.log(result.note || result.reason); process.exitCode = result.ok ? 0 : 1; }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
