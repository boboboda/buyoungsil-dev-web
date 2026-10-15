// lib/factory/diffReport.ts
// 일감 변경 내용(diff) 보고 (5-1). 감독 프로그램(tools/factory-supervisor/diffreport.mjs)이 일감이 끝난 뒤 보낸 파일 목록·줄 수·파일별 diff 를
// 서버가 한 번 더 검사해 저장한다: 한도(파일 수·파일별·전체 크기), 키·비밀 파일 숨김, 본문 안 키·비밀번호 줄 가림.
// 감독 프로그램을 믿지 않고 여기서 다시 지운다. 비밀 패턴·한도는 감독 프로그램 쪽과 같아야 한다(시험이 비교).
import { maskSecrets } from "@/lib/factory/mask";

export const DIFF_LIMITS = { files: 100, perFileChars: 20_000, totalChars: 300_000, largeLines: 2000, pathChars: 300 } as const;
export const MAX_DIFF_BODY_BYTES = 700 * 1024; // /api/factory/diff 가 받는 본문 상한

export type DiffSkip = "secret" | "binary" | "large" | "budget";

export interface DiffFile {
  path: string;
  status: "A" | "M" | "D";
  add: number;
  del: number;
  binary: boolean;
  skipped?: DiffSkip; // 있으면 diff 본문 없이 줄 수만
  truncated?: boolean; // 파일별 한도에서 잘림
  diff?: string;
}

export interface DiffReport {
  from: string;
  to: string;
  files: DiffFile[];
  totalFiles: number;
  totalAdd: number;
  totalDel: number;
  moreFiles: number; // 파일 수 한도를 넘어 목록에 못 넣은 파일 수
  truncated: boolean;
}

const SECRET_NAME: RegExp[] = [
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
const SECRET_DIR: RegExp[] = [/(^|\/)\.ssh\//, /(^|\/)\.aws\//, /(^|\/)\.gnupg\//, /(^|\/)secrets?\//];

/** 이 상대 경로가 키·비밀 파일 패턴인가(내용을 보여 주지 않는다) */
export function isSecretPath(rel: string): boolean {
  const p = String(rel ?? "").replace(/\\/g, "/").toLowerCase();
  const base = p.slice(p.lastIndexOf("/") + 1);

  return SECRET_NAME.some((re) => re.test(base)) || SECRET_DIR.some((re) => re.test(p));
}

const MASK: RegExp[] = [
  /((?:store|key|keystore)?[_-]?pass(?:word|wd)?["']?\s*[=:]\s*["']?)([^\s"',;)]+)/gi,
  /(-(?:src|dest)?(?:store|key)pass(?::env|:file)?\s+)(\S+)/gi,
  /((?:api[_-]?key|secret|token|access[_-]?key|private[_-]?key|client[_-]?secret|authorization)["']?\s*[=:]\s*["']?(?:bearer\s+)?)([A-Za-z0-9_\-./+=]{12,})/gi,
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g,
];

export function maskDiffText(text: string): string {
  return maskSecrets(MASK.reduce((acc, re, i) => acc.replace(re, i === 3 ? "$1\n***\n$2" : "$1***"), String(text ?? "")));
}

const int = (v: unknown, max = 1e9) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), max) : 0);
const SKIPS: readonly string[] = ["secret", "binary", "large", "budget"];

/**
 * 감독 프로그램이 보낸 값을 정리한다. 모양이 이상하면 null.
 * 비밀 파일은 본문을 버리고 skipped=secret 으로 고정하고, 큰 본문은 한도에서 자르고, 전체 크기 예산을 넘으면 뒤쪽 파일은 줄 수만 남긴다.
 */
export function cleanDiffReport(v: unknown): DiffReport | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;

  if (!Array.isArray(r.files)) return null;
  const sha = (x: unknown) => (typeof x === "string" && /^[0-9a-f]{7,40}$/i.test(x) ? x.toLowerCase() : "");
  const files: DiffFile[] = [];
  let budget: number = DIFF_LIMITS.totalChars;
  let truncated = r.truncated === true;

  for (const raw of r.files.slice(0, DIFF_LIMITS.files)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const f = raw as Record<string, unknown>;
    // 경로: 제어문자 제거(경로 칸에 줄바꿈으로 화면을 속이지 못하게)
    const path = typeof f.path === "string" ? f.path.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, DIFF_LIMITS.pathChars) : "";

    if (!path) continue;
    const status = f.status === "A" || f.status === "D" ? f.status : "M";
    const out: DiffFile = { path, status, add: int(f.add), del: int(f.del), binary: f.binary === true };

    if (isSecretPath(path)) out.skipped = "secret";
    else if (out.binary) out.skipped = "binary";
    else if (typeof f.skipped === "string" && SKIPS.includes(f.skipped) && f.skipped !== "secret") out.skipped = f.skipped as DiffSkip;
    else if (out.add + out.del > DIFF_LIMITS.largeLines) out.skipped = "large";
    else if (typeof f.diff === "string") {
      if (budget <= 0) out.skipped = "budget";
      else {
        const safe = maskDiffText(f.diff.replace(/[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""));
        const cap = Math.min(DIFF_LIMITS.perFileChars, budget);

        out.diff = safe.length > cap ? safe.slice(0, cap) : safe;
        if (safe.length > cap || f.truncated === true) {
          out.truncated = true;
          truncated = true;
        }
        budget -= out.diff.length;
      }
    }
    files.push(out);
  }
  const moreFiles = int(r.moreFiles, 1e6) + Math.max(0, r.files.length - files.length);

  return {
    from: sha(r.from),
    to: sha(r.to),
    files,
    totalFiles: Math.max(int(r.totalFiles, 1e6), files.length + moreFiles),
    totalAdd: int(r.totalAdd),
    totalDel: int(r.totalDel),
    moreFiles,
    truncated: truncated || moreFiles > 0,
  };
}

/** 채팅 커넥터(get_factory_job)용 요약: 파일·줄 수만(본문 없음). 목록은 30개까지 */
export function diffSummary(report: unknown): { files: number; add: number; del: number; list: { path: string; status: string; add: number; del: number; note?: string }[]; more: number } | null {
  const d = cleanDiffReport(report);

  if (!d) return null;
  const NOTE: Record<string, string> = { secret: "내용 숨김(키·비밀 파일)", binary: "바이너리", large: "큰 파일(요약만)", budget: "요약만" };
  const list = d.files.slice(0, 30).map((f) => ({ path: f.path, status: f.status, add: f.add, del: f.del, ...(f.skipped ? { note: NOTE[f.skipped] } : {}) }));

  return { files: d.totalFiles, add: d.totalAdd, del: d.totalDel, list, more: Math.max(0, d.totalFiles - list.length) };
}

/** 저장된 JSON 을 화면용으로 읽는다(저장 때 이미 정리했지만 다시 한 번 비밀 파일을 가린다) */
export const readDiffReport = cleanDiffReport;
