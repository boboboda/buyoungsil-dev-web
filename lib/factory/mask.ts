// lib/factory/mask.ts
// 로그·실패 이유·요약에 비밀번호가 섞여 들어와도 화면·API·텔레그램에 나가지 않게 가린다.
// 감독 프로그램(tools/factory-supervisor/release.mjs 의 maskText)도 같은 규칙으로 먼저 가린다. 여기는 서버 쪽 한 번 더.
const PATTERNS: RegExp[] = [
  // storePassword=..., keyPassword: ..., KEYSTORE_PASSWORD=..., password = ...
  /((?:store|key|keystore)?[_-]?pass(?:word|wd)?["']?\s*[=:]\s*["']?)([^\s"',;)]+)/gi,
  // keytool -storepass xxx / -keypass xxx / -srcstorepass xxx
  /(-(?:src|dest)?(?:store|key)pass(?::env|:file)?\s+)(\S+)/gi,
];

export function maskSecrets(s: string): string;
export function maskSecrets(s: string | null): string | null;
export function maskSecrets(s: string | null): string | null {
  if (s === null) return null;

  return PATTERNS.reduce((acc, re) => acc.replace(re, "$1***"), s);
}
