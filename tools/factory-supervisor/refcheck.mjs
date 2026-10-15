// 도구 일감 시작 전 참고 그림 점검(스튜디오 ↔ 서비스 연결, 그림 자체 보관).
// 툴킷은 참고 그림을 주소에서 내려받는다. 그 서버(예: 서비스 서버)의 인증서가 만료됐거나 서버가 죽어 있으면 일감이 중간에 실패하므로, 시작 전에 주소마다 한 번 접속해 본다.
//  - 고정된 기본 그림(카드 규칙 pinDefault)이 실패하면 일감을 실패로 끝낸다. 이유에 '기본 그림 주소 접속 실패(인증서 만료)'와 고칠 곳을 적는다.
//  - 고정이 아닌 그림은 목록에서 빼고 진행한다.
// 그림 파일은 받아 두지 않는다(응답 머리만 확인하고 본문은 버린다). 던지지 않는다.
export const REF_CHECK_TIMEOUT_MS = 15_000;

/** fetch 오류의 원인 코드 → 사람이 읽는 이유 */
export function refFailureReason(e) {
  if (e?.name === "AbortError") return "시간 초과";
  const code = String(e?.cause?.code ?? e?.code ?? "");
  if (code === "CERT_HAS_EXPIRED") return "인증서 만료";
  if (/^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|ERR_TLS_CERT_ALTNAME_INVALID|CERT_[A-Z_]+)$/.test(code)) return "인증서 오류";
  if (/^(ENOTFOUND|EAI_AGAIN)$/.test(code)) return "주소를 찾지 못함";
  if (/^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH)$/.test(code)) return "연결 실패";
  return "연결 실패";
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "(주소 오류)";
  }
};

/** 주소 하나에 접속해 본다. { ok: true } 또는 { ok: false, reason } */
export async function probeRef(url, { fetchImpl = globalThis.fetch, timeoutMs = REF_CHECK_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { Range: "bytes=0-0" } });
    await res.body?.cancel?.().catch(() => {});
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, reason: refFailureReason(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 참고 그림 점검. picked: [{ url, subject, kind }], pinnedUrl: 카드 규칙으로 고정된 기본 그림 주소(없으면 null).
 * 반환: { keep: [...], dropped: [{ url, subject, host, reason }], pinnedFailure: null | { url, host, reason } }
 */
export async function checkPickedRefs({ picked, pinnedUrl = null, fetchImpl, timeoutMs, log = () => {} }) {
  const list = Array.isArray(picked) ? picked : [];
  const keep = [];
  const dropped = [];
  let pinnedFailure = null;
  const seen = new Map();
  for (const e of list) {
    if (!seen.has(e.url)) seen.set(e.url, await probeRef(e.url, { fetchImpl, timeoutMs }));
    const r = seen.get(e.url);
    if (r.ok) {
      keep.push(e);
      continue;
    }
    const host = hostOf(e.url);
    if (pinnedUrl && e.url === pinnedUrl) {
      pinnedFailure = { url: e.url, host, reason: r.reason };
      log("warn", `기본 그림(고정) 주소에 접속하지 못했어요: ${host} — ${r.reason}`);
    } else {
      dropped.push({ url: e.url, subject: e.subject, host, reason: r.reason });
      log("warn", `참고 그림 '${String(e.subject ?? "").slice(0, 30)}'을(를) 받지 못해 빼고 진행해요: ${host} — ${r.reason}`);
    }
  }
  return { keep, dropped, pinnedFailure };
}

/** 고정 기본 그림 실패로 일감을 끝낼 때 쓰는 이유(고칠 곳 포함) */
export function pinnedFailureMessage(f) {
  return `기본 그림 주소 접속 실패(${f.reason}): ${f.url || f.host}. 고칠 곳: 그 주소의 서버(HTTPS 인증서·서버 상태)를 고치거나 [구성]에서 이 카드의 기본 그림을 업로드 서버에 있는 다른 그림으로 바꾼 뒤 이 일감을 다시 보내세요. (고정된 기본 그림이라 빼고 진행하지 않아요.)`;
}
