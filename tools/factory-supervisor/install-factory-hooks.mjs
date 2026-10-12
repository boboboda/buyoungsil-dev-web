#!/usr/bin/env node
// Add our named commands to existing user hooks without changing authentication or other hooks.
// Codex hook trust is reviewed by the user with /hooks; this installer never bypasses it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function mergeFactoryHooks(settings, command) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("기존 훅 설정 형식이 올바르지 않습니다.");
  const result = structuredClone(settings);
  result.hooks ??= {};
  if (typeof result.hooks !== "object" || Array.isArray(result.hooks)) throw new Error("기존 hooks 형식이 올바르지 않습니다.");
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    const groups = result.hooks[event] ?? [];
    if (!Array.isArray(groups)) throw new Error("기존 훅 이벤트 형식이 올바르지 않습니다.");
    if (!groups.some(g => g.hooks?.some(h => h.command === command))) {
      result.hooks[event] = [...groups, { hooks: [{ type: "command", command, timeout: 20 }] }];
    }
  }
  return result;
}

export function installFactoryHooks({ home = os.homedir(), bridge = path.join(home, "dev/factory/supervisor-src/tools/factory-supervisor/factory-hook.mjs"), dryRun = false } = {}) {
  if (!fs.existsSync(bridge)) throw new Error("감독 실행본에 factory-hook.mjs가 없습니다. 서버·감독 업데이트 후 설치하세요.");
  const script = bridge.replace(/\\/g, "/");
  if (/["$`\r\n]/.test(script)) throw new Error("훅 경로에 허용하지 않는 셸 문자가 있습니다.");
  const changes = [];
  for (const provider of ["claude", "codex"]) {
    const file = path.join(home, provider === "claude" ? ".claude/settings.json" : ".codex/hooks.json");
    const exists = fs.existsSync(file);
    const text = exists ? fs.readFileSync(file, "utf8") : "{}";
    let before;
    try { before = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error(`기존 ${provider} 설정 JSON을 읽지 못했습니다. 변경하지 않습니다.`); }
    const command = `node "${script}" --hook --provider ${provider}`;
    const after = mergeFactoryHooks(before, command);
    const changed = JSON.stringify(after) !== JSON.stringify(before);
    changes.push({ provider, file, command, changed, before: text, after });
  }
  if (!dryRun) for (const c of changes.filter(c => c.changed)) {
    fs.mkdirSync(path.dirname(c.file), { recursive: true });
    if (fs.existsSync(c.file)) fs.copyFileSync(c.file, `${c.file}.before-factory-${Date.now()}.bak`);
    fs.writeFileSync(c.file, JSON.stringify(c.after, null, 2) + "\n", { mode: 0o600 });
  }
  return changes.map(({ provider, file, command, changed }) => ({ provider, file, command, changed }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(installFactoryHooks({ dryRun: process.argv.includes("--dry-run") }), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
