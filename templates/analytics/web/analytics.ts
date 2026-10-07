// templates/analytics/web/analytics.ts
// 웹사이트 분석 SDK (브라우저). 외부 라이브러리 없이 파일 하나로 동작한다. Next.js·React·일반 JS 모두 사용 가능.
//
// 사용법 (앱 시작 시 한 번, 브라우저에서만):
//   import { Analytics } from "./analytics";
//   Analytics.init({ endpoint: "https://내도메인/api/analytics/collect", key: "ak_xxx", appVersion: "1.0.0" });
//   Analytics.feature("signup_click", { plan: "free" });
//
//  - endpoint 나 key 가 비어 있으면 아무것도 하지 않는다.
//  - 페이지 이동(SPA 포함)마다 screen_view 를 자동으로 보낸다 (autoPageView: false 로 끌 수 있다).
//  - 이벤트는 모아서 보낸다 (20건 또는 15초, 탭을 닫거나 숨길 때). 서버가 안 받으면 저장해 두었다 다시 보낸다.
//  - debug: true 면 appVersion 끝에 "-debug" 가 붙어 관리자 화면에서 제외할 수 있다.

export type Primitive = string | number | boolean | null;
export type EventParams = Record<string, Primitive | undefined>;

export interface AnalyticsConfig {
  endpoint: string;
  key: string;
  appVersion?: string;
  debug?: boolean;
  autoPageView?: boolean;
}

interface QueuedEvent {
  id: string;
  name: string;
  ts: number;
  sessionId?: string;
  params?: Record<string, Primitive>;
}

const SESSION_GAP_MS = 30 * 60 * 1000;
const FLUSH_INTERVAL_MS = 15_000;
const FLUSH_THRESHOLD = 20;
const MAX_BATCH = 50;
const MAX_QUEUE = 500;
const MAX_PARAMS = 10;
const RETRY_FIRST_MS = 15_000;
const RETRY_MAX_MS = 15 * 60_000;
const KEEPALIVE_LIMIT_CHARS = 60_000; // keepalive 요청은 본문이 64KB 를 넘으면 안 된다

const INSTALL_KEY = "app_analytics_install";
const SESSION_KEY = "app_analytics_session";
const QUEUE_KEY = "app_analytics_queue";

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function safeGet(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null; // 사생활 보호 모드 등
  }
}

function safeSet(store: "local" | "session", key: string, value: string) {
  try {
    (store === "local" ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    /* 저장 못 해도 동작은 계속 */
  }
}

/** 서버 규칙에 맞게 정리: 문자열·숫자·불리언만, 최대 10개, 키 40자, 값 200자 */
export function cleanParams(params?: EventParams): Record<string, Primitive> | undefined {
  if (!params) return undefined;

  const out: Record<string, Primitive> = {};
  let count = 0;

  for (const [k, v] of Object.entries(params)) {
    if (count >= MAX_PARAMS) break;
    if (!k || k.length > 40) continue;

    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "boolean" || v === null) out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else continue; // undefined·객체·배열은 보내지 않는다

    count += 1;
  }

  return count === 0 ? undefined : out;
}

type SendResult = "ok" | "drop" | "retry";

class AnalyticsClient {
  private enabled = false;
  private endpoint = "";
  private key = "";
  private appVersion = "";
  private installId = "";
  private sessionId = "";
  private lastActiveAt = 0;
  private queue: QueuedEvent[] = [];
  private flushing = false;
  private retryDelayMs = 0;
  private nextAttemptAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  init(config: AnalyticsConfig) {
    if (this.enabled || typeof window === "undefined") return;
    if (!config.endpoint || !config.key) return;

    this.endpoint = config.endpoint;
    this.key = config.key;
    this.appVersion = `${config.appVersion ?? "web"}${config.debug ? "-debug" : ""}`.slice(0, 40);

    this.installId = safeGet("local", INSTALL_KEY) ?? uuid();
    safeSet("local", INSTALL_KEY, this.installId);

    try {
      const saved = JSON.parse(safeGet("local", QUEUE_KEY) ?? "[]");

      if (Array.isArray(saved)) this.queue = saved.slice(-MAX_QUEUE);
    } catch {
      this.queue = [];
    }

    this.enabled = true;
    this.touchSession();

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flush(true);
    });
    window.addEventListener("pagehide", () => this.flush(true));
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    if (config.autoPageView !== false) this.watchPageViews();

    this.flush();
  }

  /** 허용된 이름(session_start, screen_view, ad_*, feature_use)만 서버가 받는다. */
  track(name: string, params?: EventParams) {
    if (!this.enabled) return;

    this.touchSession();

    const event: QueuedEvent = { id: uuid(), name, ts: Date.now() };

    if (this.sessionId) event.sessionId = this.sessionId;

    const clean = cleanParams(params);

    if (clean) event.params = clean;

    this.queue.push(event);

    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);

    this.save();

    if (this.queue.length >= FLUSH_THRESHOLD) this.flush();
  }

  /** 화면(페이지) 하나 열었을 때. 자동 수집을 켜 두면 직접 부를 필요 없다. */
  screen(name: string) {
    this.track("screen_view", { screen: name });
  }

  /** 기능 사용 이벤트. 예: Analytics.feature("signup_click", { plan: "free" }) */
  feature(feature: string, params: EventParams = {}) {
    this.track("feature_use", { feature, ...params });
  }

  /** 지금 바로 보내기 (보통은 직접 부를 필요 없음) */
  flush(unloading = false) {
    if (!this.enabled || this.flushing || this.queue.length === 0) return;
    if (Date.now() < this.nextAttemptAt) return;

    void this.send(unloading);
  }

  // ───────────────────────── 내부 ─────────────────────────

  // 30분 이상 아무 활동이 없었으면 새 세션
  private touchSession() {
    const now = Date.now();
    const stored = safeGet("session", SESSION_KEY);
    let last = this.lastActiveAt;
    let id = this.sessionId;

    if (!id && stored) {
      try {
        const parsed = JSON.parse(stored) as { id: string; last: number };

        id = parsed.id;
        last = parsed.last;
      } catch {
        id = "";
      }
    }

    const isNew = !id || now - last > SESSION_GAP_MS;

    if (isNew) id = uuid();

    this.sessionId = id;
    this.lastActiveAt = now;
    safeSet("session", SESSION_KEY, JSON.stringify({ id, last: now }));

    if (isNew) {
      this.queue.push({ id: uuid(), name: "session_start", ts: now, sessionId: id });
      this.save();
    }
  }

  private async send(unloading: boolean) {
    this.flushing = true;

    try {
      while (this.queue.length > 0 && Date.now() >= this.nextAttemptAt) {
        const batch = this.queue.slice(0, MAX_BATCH);
        const result = await this.post(batch, unloading);

        if (result === "retry") {
          this.retryDelayMs = this.retryDelayMs === 0 ? RETRY_FIRST_MS : Math.min(this.retryDelayMs * 2, RETRY_MAX_MS);
          this.nextAttemptAt = Date.now() + this.retryDelayMs;
          break;
        }

        // ok / drop: 서버가 형식 오류나 잘못된 키로 답한 묶음은 재시도해도 소용없어 버린다.
        this.queue.splice(0, batch.length);
        this.retryDelayMs = 0;
        this.nextAttemptAt = 0;

        if (unloading) break; // 탭을 닫는 중에는 한 번만
      }
    } finally {
      this.flushing = false;
      this.save();
    }
  }

  private async post(events: QueuedEvent[], unloading: boolean): Promise<SendResult> {
    const body = JSON.stringify({
      installId: this.installId,
      appVersion: this.appVersion,
      platform: "web",
      osVersion: String(
        (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
          navigator.platform ??
          "",
      ).slice(0, 40),
      events,
    });

    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-analytics-key": this.key },
        body,
        keepalive: unloading && body.length < KEEPALIVE_LIMIT_CHARS,
      });

      if (res.ok) return "ok";
      if (res.status === 429 || res.status >= 500) return "retry";

      return "drop";
    } catch {
      return "retry"; // 네트워크 없음, CORS 오류 등
    }
  }

  private save() {
    safeSet("local", QUEUE_KEY, JSON.stringify(this.queue.slice(-MAX_QUEUE)));
  }

  // SPA 에서는 주소만 바뀌고 새로고침이 없으니 history 를 감싸서 페이지 이동을 잡는다.
  private watchPageViews() {
    let lastPath = "";
    const report = () => {
      const path = location.pathname;

      if (path === lastPath) return;
      lastPath = path;
      this.screen(path);
    };

    for (const method of ["pushState", "replaceState"] as const) {
      const original = history[method];

      history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
        const result = original.apply(this, args);

        setTimeout(report, 0);

        return result;
      };
    }

    window.addEventListener("popstate", report);
    report();
  }
}

export const Analytics = new AnalyticsClient();
