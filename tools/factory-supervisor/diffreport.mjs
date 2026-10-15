// 일감 변경 내용(diff) 보고 (5-1). 일감이 끝난 뒤 시작 커밋..HEAD 범위의 파일 목록·줄 수·파일별 diff 를 만들어 완료 보고에 싣는다.
//   - 파일마다 일정 크기까지만 diff 를 싣는다(넘으면 잘림 표시). 큰 파일·바이너리는 줄 수만(요약만).
//   - 키·비밀 파일 패턴에 걸리는 파일은 내용을 읽지도 않고 이름과 숨김 표시만 싣는다.
//   - 읽기만 한다(git diff). 저장소를 바꾸지 않는다. 던지지 않는다(실패하면 null).
// 서버(lib/factory/diffReport.ts)가 같은 규칙으로 한 번 더 검사한다. 비밀 패턴·한도는 두 곳이 같아야 한다(시험이 비교).
import { spawnSync } from "node:child_process";

export const DIFF_LIMITS = Object.freeze({ files: 100, perFileChars: 20_000, totalChars: 300_000, largeLines: 2000, pathChars: 300 });

// 내용을 보여 주지 않을 파일(이름 기준, 대소문자 무시). 폴더 이름 패턴(.ssh/ 등)도 경로 앞부분으로 본다
const SECRET_NAME = [
  /^\.env(\..+)?$/,
  /^\.envrc$/,
  /\.(pem|key|p12|pfx|jks|keystore|p8|cer|crt|der|gpg|asc|kdbx)$/,
  /^key\.properties$/,
  /^secrets?(\..+)?$/,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /^credentials?(\..+)?$/,
  /^service[-_]?account.*\.json$/,
  /^google-services\.json$/,
  /^googleservice-info\.plist$/,
  /^(\.npmrc|\.netrc|\.pypirc|\.htpasswd|\.git-credentials)$/,
  /^(token|tokens|auth)\.json$/,
  /\.secret(s)?$/,
  /^local\.properties$/,
];
const SECRET_DIR = [/(^|\/)\.ssh\//, /(^|\/)\.aws\//, /(^|\/)\.gnupg\//, /(^|\/)secrets?\//];

/** 이 상대 경로가 키·비밀 파일 패턴인가 */
export function isSecretPath(rel) {
  const p = String(rel ?? "").replace(/\\/g, "/").toLowerCase();
  const base = p.slice(p.lastIndexOf("/") + 1);

  return SECRET_NAME.some((re) => re.test(base)) || SECRET_DIR.some((re) => re.test(p));
}

// diff 본문 안에 값이 그대로 박힌 키·비밀번호 줄은 값을 가린다(파일 이름이 평범해도 안전하게)
const MASK = [
  /((?:store|key|keystore)?[_-]?pass(?:word|wd)?["']?\s*[=:]\s*["']?)([^\s"',;)]+)/gi,
  /(-(?:src|dest)?(?:store|key)pass(?::env|:file)?\s+)(\S+)/gi,
  /((?:api[_-]?key|secret|token|access[_-]?key|private[_-]?key|client[_-]?secret|authorization)["']?\s*[=:]\s*["']?(?:bearer\s+)?)([A-Za-z0-9_\-./+=]{12,})/gi,
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g,
];

export function maskDiffText(text) {
  return MASK.reduce((acc, re, i) => acc.replace(re, i === 3 ? "$1\n***\n$2" : "$1***"), String(text ?? ""));
}

function git(dir, args, maxBuffer = 64 * 1024 * 1024) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", shell: false, windowsHide: true, maxBuffer, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } });

  return r.status === 0 ? r.stdout : null;
}

/** git diff --numstat -z / --name-status -z 출력 읽기 (이름 바꾸기 탐지는 끈 상태라 항목이 단순하다) */
export function parseNumstat(out) {
  const rows = [];

  for (const rec of String(out ?? "").split("\0")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(rec);

    if (m) rows.push({ path: m[3], add: m[1] === "-" ? 0 : Number(m[1]), del: m[2] === "-" ? 0 : Number(m[2]), binary: m[1] === "-" });
  }

  return rows;
}

export function parseNameStatus(out) {
  const parts = String(out ?? "").split("\0").filter((x) => x !== "");
  const map = new Map();

  for (let i = 0; i + 1 < parts.length; i += 2) map.set(parts[i + 1], parts[i][0]);

  return map;
}

/**
 * from..HEAD 범위의 변경 보고. git 저장소가 아니거나 from 이 이상하면 null.
 * 반환: { from, to, files:[{path,status,add,del,binary,skipped?,truncated?,diff?}], totalFiles, totalAdd, totalDel, moreFiles, truncated }
 *   skipped: "secret"(내용 숨김) | "binary" | "large"(큰 파일) | "budget"(전체 크기 한도)
 * opts.redact: 추가로 거칠 가림 함수(감독 프로그램의 비밀값 가리개)
 */
export function collectDiff(dir, from, opts = {}) {
  try {
    if (!from || !/^[0-9a-f]{7,40}$/i.test(from)) return null;
    const to = git(dir, ["rev-parse", "HEAD"])?.trim();

    if (!to || to === from) return to ? { from, to, files: [], totalFiles: 0, totalAdd: 0, totalDel: 0, moreFiles: 0, truncated: false } : null;
    const range = [from, to];
    const num = git(dir, ["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff", ...range]);
    const ns = git(dir, ["diff", "--name-status", "-z", "--no-renames", "--no-ext-diff", ...range]);

    if (num === null || ns === null) return null;
    const rows = parseNumstat(num);
    const status = parseNameStatus(ns);
    const redact = typeof opts.redact === "function" ? opts.redact : (s) => s;
    const lim = { ...DIFF_LIMITS, ...(opts.limits ?? {}) };
    const files = [];
    let budget = lim.totalChars;
    let truncated = false;

    for (const row of rows.slice(0, lim.files)) {
      const f = { path: row.path.slice(0, lim.pathChars), status: status.get(row.path) ?? "M", add: row.add, del: row.del, binary: row.binary };

      if (isSecretPath(row.path)) f.skipped = "secret";
      else if (row.binary) f.skipped = "binary";
      else if (row.add + row.del > lim.largeLines) f.skipped = "large";
      else if (budget <= 0) f.skipped = "budget";
      else {
        const raw = git(dir, ["diff", "-U3", "--no-color", "--no-ext-diff", "--no-renames", ...range, "--", row.path], 8 * 1024 * 1024);

        if (raw === null) f.skipped = "large";
        else {
          // 머리(diff --git, index …)는 줄이고 @@ 부터 싣는다
          const body = raw.slice(Math.max(0, raw.indexOf("\n@@") + 1));
          const cap = Math.min(lim.perFileChars, budget);
          const safe = redact(maskDiffText(body));

          f.diff = safe.length > cap ? safe.slice(0, cap) : safe;
          if (safe.length > cap) {
            f.truncated = true;
            truncated = true;
          }
          budget -= f.diff.length;
        }
      }
      files.push(f);
    }
    const moreFiles = Math.max(0, rows.length - files.length);

    return {
      from,
      to,
      files,
      totalFiles: rows.length,
      totalAdd: rows.reduce((n, r) => n + r.add, 0),
      totalDel: rows.reduce((n, r) => n + r.del, 0),
      moreFiles,
      truncated: truncated || moreFiles > 0,
    };
  } catch {
    return null;
  }
}
