// lib/factory/telegram.ts
// 앱 공장 텔레그램 알림. 일감이 승인 대기 / 완료 / 실패가 되면 내 텔레그램으로 알려 주고, (켜 두면) 알림의 버튼으로 승인한다.
// 알림 글에는 앱 이름, 상태, 한 줄 요약, 통제실 링크만 싣는다. 기획서 본문·로그·키 값은 보내지 않는다.
// 환경변수가 없으면 아무것도 하지 않는다(일감 처리에 영향 없음).
//   TELEGRAM_BOT_TOKEN        BotFather 가 준 토큰
//   TELEGRAM_CHAT_ID          내 chat id (처음엔 비워 두면 /start 에 chat id 를 알려 준다)
//   TELEGRAM_WEBHOOK_SECRET   웹훅 요청 확인용 비밀 문자열 (영문·숫자·_·- 만)
//   TELEGRAM_APPROVE_BUTTONS  "true" 이면 알림에 [승인] 버튼을 붙인다
//   FACTORY_PUBLIC_URL        (선택) 통제실 주소의 기본값은 https://www.buyoungsilcoding.com
import prisma from "@/lib/prisma";
import { ID_RE, KIND_LABELS } from "@/lib/factory/jobs";
import { runApproval } from "@/lib/factory/approvals"; // 통제실 버튼과 같은 입구
import { maskSecrets } from "@/lib/factory/mask";
import { releaseAppName } from "@/lib/factory/appName";
import { CLAUDE_MODELS } from "@/lib/factory/ai";

const API_TIMEOUT_MS = 5000;
// lib/factory/release.ts 의 라벨과 같게(그 파일이 이 파일을 불러서, 순환을 피하려고 여기 따로 둔다)
const RELEASE_KIND_TEXT: Record<string, string> = { first: "첫 출시", store: "스토어 수정", update: "앱 업데이트(기능 추가)", project: "프로젝트 업데이트(예전)", apk: "시험용 APK" };
const STAGE_TEXT: Record<string, string> = { key: "키", build: "빌드", sign: "서명", store: "스토어 자료", upload: "업로드", homepage: "홈페이지 반영", scaffold: "준비", review: "검토 대기", code: "코드 수정", test: "시험", version: "버전 올림" };
const MAX_BUTTON_AGE_SEC = 24 * 60 * 60; // 24시간이 지난 알림의 버튼은 무시한다

// 승인 버튼의 모델 고르기(Claude Code 일감만): [🧠 모델 골라 승인]을 누르면 같은 알림의 버튼이 모델 목록으로 바뀐다.
// 버튼 값에는 모델 이름 대신 허용 목록(CLAUDE_MODELS)의 번호만 싣는다. 목록 밖 번호는 거절.
//   앱 일감: a:<id> 기본 설정으로 승인, ao:<id> 모델 목록 열기, a:<id>:<번호> 그 모델로 승인
//   정비 지시: ma:<id> 기본 설정으로 승인, mo:<id> 모델 목록 열기, ma:<id>:<번호> 그 모델로 승인
export function modelKeyboard(prefix: "a" | "ma", id: string, url: string): Record<string, string>[][] {
  const rows: Record<string, string>[][] = [];

  CLAUDE_MODELS.forEach((m, i) => {
    if (i % 3 === 0) rows.push([]);
    rows[rows.length - 1].push({ text: m, callback_data: `${prefix}:${id}:${i}` });
  });
  rows.push([{ text: "✅ 기본 설정으로 승인", callback_data: `${prefix}:${id}` }, { text: "통제실 열기", url }]);

  return rows;
}

const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
const chatId = () => process.env.TELEGRAM_CHAT_ID?.trim() || "";
const secret = () => process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";
const approveEnabled = () =>
  process.env.TELEGRAM_APPROVE_BUTTONS?.trim() === "true";
const publicUrl = () =>
  (
    process.env.FACTORY_PUBLIC_URL?.trim() || "https://www.buyoungsilcoding.com"
  ).replace(/\/+$/, "");

export const telegramStatus = () => ({
  botToken: token() !== "",
  chatId: chatId() !== "",
  webhookSecret: secret() !== "",
  approveButtons: approveEnabled(),
});

// 텔레그램 API 호출. 실패해도 던지지 않고 null 을 돌려준다.
export async function tg(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; description?: string } | null> {
  if (!token()) return null;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token()}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );

    return (await res.json()) as {
      ok: boolean;
      result?: unknown;
      description?: string;
    };
  } catch {
    console.error(`[telegram] ${method} 호출 실패`); // 토큰이 담긴 주소는 로그에 남기지 않는다

    return null;
  }
}

const cut = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();

  return t.length > max ? `${t.slice(0, max)}…` : t;
};

export type JobEvent = "pending" | "done" | "failed" | "review" | "linkwait" | "needs_confirmation";

// 일감 상태가 바뀐 것을 알린다. 절대 던지지 않는다.
export async function notifyJobEvent(
  jobId: string,
  event: JobEvent,
): Promise<void> {
  try {
    if (!token() || !chatId()) return;

    const job = await prisma.factoryJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        appSlug: true,
        title: true,
        kind: true,
        summary: true,
        failReason: true,
        source: true,
        status: true,
        releaseKind: true,
        failStage: true,
        phase: true,
        aiEngine: true,
      },
    });

    if (!job) return;

    const kind = (KIND_LABELS[job.kind] ?? "수정") + (job.kind === "release" ? `(${RELEASE_KIND_TEXT[job.releaseKind ?? "first"] ?? "첫 출시"})` : "");
    const stage = job.failStage ?? job.phase;
    // 출시 일감은 앱 이름(출시 카드 제목과 같은 이름)으로 알린다
    const name = job.kind === "release" ? await releaseAppName(job.appSlug, job.title) : job.title;
    let text: string;

    if (event === "pending") {
      text = `📥 승인 대기\n${name} (${job.appSlug}) · ${kind}${job.source ? `\n출처: ${cut(job.source, 60)}` : ""}`;
    } else if (event === "review") {
      text = `👀 검토 대기: ${name} (${job.appSlug}) 스토어 자료가 준비됐어요
통제실 출시 패키지에서 확인하고 [이대로 진행]·[다시 만들기]·[취소] 중에 골라 주세요.`;
    } else if (event === "needs_confirmation") {
      // 도구 일감(2-3): PixelLab 비용 한도에 걸려 멈춤. 통제실 [그대로 진행]·[취소]로 정한다
      text = `⚠️ 확인 필요(비용 한도)
${name} (${job.appSlug}) · ${kind}
${cut(maskSecrets(job.failReason), 200) || "비용 한도를 넘었어요."}
통제실 할 일에서 [그대로 진행] 또는 [취소]를 눌러 주세요.`;
    } else if (event === "linkwait") {
      text = `🎬 영상 링크 대기: ${name} (${job.appSlug})\n이미지·문구는 반영했어요. 홍보 영상을 YouTube 에 올린 뒤 출시 카드에서 링크를 붙여 넣어 주세요(링크 없이 마칠 수도 있어요).`;
    } else if (event === "done") {
      text = `✅ 완료\n${name} (${job.appSlug}) · ${kind}\n${cut(job.summary, 200) || "(요약 없음)"}`;
    } else {
      const mergeFail = job.failStage === "merge"; // 병행 일감을 기본 브랜치에 합치지 못함(다시 맞추기를 해도 안 됨). 이미 합쳐진 다른 일감은 그대로
      const resumeNeeded = job.failStage === "resume"; // 감독 프로그램 업데이트로 멈췄다가 같은 세션으로 이어 주지 못함: 실패가 아니라 다시 시작이 필요(한 번만 알림)
      text = resumeNeeded
        ? `⏸ 다시 시작 필요\n${name} (${job.appSlug}) · ${kind}\n업데이트로 멈춘 일감을 이어 주지 못했어요. 파일은 그대로예요. 통제실에서 [다시 시도]를 눌러 주세요.\n${cut(maskSecrets(job.failReason), 200) || "(사유 없음)"}`
        : `❌ ${mergeFail ? "합치기 실패" : "실패"}\n${name} (${job.appSlug}) · ${kind}${mergeFail ? "\n이미 합쳐진 다른 일감은 그대로예요. 이 일감만 멈췄어요." : ""}${job.kind === "release" && stage ? `\n실패 단계: ${STAGE_TEXT[stage] ?? stage}` : ""}\n${cut(maskSecrets(job.failReason), 200) || "(사유 없음)"}`;
    }

    const row: Record<string, string>[] = [
      {
        text: event === "review" ? "검토하러 가기" : event === "linkwait" ? "링크 넣으러 가기" : "통제실 열기",
        url: `${publicUrl()}${event === "review" || event === "linkwait" ? "/admin/factory/release" : "/admin/factory"}`,
      },
    ];

    if (event === "pending" && approveEnabled() && secret()) {
      // 모델 고르기는 Claude Code 일감만(Codex 는 기본 승인만)
      if (job.aiEngine !== "codex") row.unshift({ text: "🧠 모델 골라 승인", callback_data: `ao:${job.id}` });
      row.unshift({ text: "✅ 승인(기본 모델)", callback_data: `a:${job.id}` });
    }

    await tg("sendMessage", {
      chat_id: chatId(),
      text,
      reply_markup: { inline_keyboard: [row] },
    });
  } catch {
    console.error("[telegram] 알림 처리 실패");
  }
}

// 일감과 상관없는 짧은 알림(출시 테스트 일정 등). 통제실 링크를 붙인다. 절대 던지지 않는다.
export async function notifyText(text: string, path = "/admin/factory/release"): Promise<void> {
  try {
    if (!token() || !chatId()) return;
    await tg("sendMessage", {
      chat_id: chatId(),
      text: text.slice(0, 900), // 줄바꿈은 살린다(cut 은 공백으로 합친다)
      reply_markup: { inline_keyboard: [[{ text: "통제실 열기", url: `${publicUrl()}${path}` }]] },
    });
  } catch {
    console.error("[telegram] 알림 처리 실패");
  }
}

export type MaintenanceEvent = "approval" | "done" | "failed" | "deployed" | "deploy_failed";

export interface MaintenanceNotifyExtra {
  position?: number; // 승인 대기: 대기열 몇 번째
  halted?: boolean; // 실패: 대기열을 멈췄는지
  queueLeft?: number; // 끝남: 대기열에 남은 지시 수
  needsDeploy?: boolean; // 끝남: 이 지시가 서버 코드를 바꿨는지
  items?: { title: string; commit: string }[]; // 배포: 포함된 지시
  via?: string; // 배포: 누가(통제실·텔레그램·자동)
}

const itemLines = (items: { title: string; commit: string }[]) =>
  items
    .slice(0, 10)
    .map((i) => `• ${cut(i.title, 60)} (${String(i.commit).slice(0, 7)})`)
    .join("\n") + (items.length > 10 ? `\n… 외 ${items.length - 10}개` : "");

// 공장 정비 알림. 지시·결과 본문은 짧게만 싣는다. 승인([정비 승인])·대기열([계속 진행]·[재시도]·[대기열 비우기]) 버튼은 승인 버튼을 켰을 때만 붙인다.
// [배포] 버튼은 대기열이 다 끝난 뒤의 '배포 필요' 알림(notifyDeployReady)에만 붙인다. 절대 던지지 않는다.
export async function notifyMaintenance(event: MaintenanceEvent, threadId: string, turnId?: string, extra: MaintenanceNotifyExtra = {}): Promise<void> {
  try {
    if (!token() || !chatId()) return;
    const t = await prisma.factoryMaintenance.findUnique({ where: { id: threadId } });

    if (!t) return;
    const last = await prisma.factoryMaintenanceMessage.findFirst({
      where: { maintenanceId: threadId, role: event === "approval" ? "user" : "assistant" },
      orderBy: { createdAt: "desc" },
    });
    const head = {
      approval: "🛠 정비 지시 승인 대기",
      done: "🛠 정비 완료",
      failed: "🛠 정비 실패",
      deployed: "🚀 정비 배포 완료",
      deploy_failed: "🚀 정비 배포 실패",
    }[event];
    const body = event === "deployed" || event === "deploy_failed" ? cut(t.deployResult, 200) : cut(last?.text, 300);
    const notes: string[] = [];

    if (event === "approval" && extra.position) notes.push(`(대기 ${extra.position}번째, 앞에 ${extra.position - 1}개)`);
    if (event === "done" && extra.needsDeploy && extra.queueLeft) notes.push(`(서버 코드가 바뀜 — 대기열 ${extra.queueLeft}개가 끝난 뒤 한 번에 배포를 안내해요)`);
    if (event === "failed" && extra.halted) notes.push("⏸ 정비 대기열을 멈췄어요. [계속 진행](건너뛰기)·[재시도]·[대기열 비우기] 중에 골라 주세요.");
    const row: Record<string, string>[] = [{ text: "통제실 열기", url: `${publicUrl()}/admin/factory` }];
    const rows: Record<string, string>[][] = [row];

    if (approveEnabled() && secret()) {
      if (event === "approval" && turnId) {
        if (last?.aiEngine !== "codex") row.unshift({ text: "🧠 모델 골라 승인", callback_data: `mo:${turnId}` });
        row.unshift({ text: "✅ 정비 승인(기본 모델)", callback_data: `ma:${turnId}` });
      }
      if (event === "failed" && extra.halted && turnId) {
        rows.unshift([
          { text: "▶️ 계속 진행", callback_data: `mc:${turnId}` },
          { text: "🔁 재시도", callback_data: `mr:${turnId}` },
          { text: "🗑 대기열 비우기", callback_data: `mx:${turnId}` },
        ]);
      }
    }
    const list = (event === "deployed" || event === "deploy_failed") && extra.items?.length ? `\n포함된 지시:\n${itemLines(extra.items)}` : "";

    await tg("sendMessage", {
      chat_id: chatId(),
      text: `${head}${extra.via === "자동" ? "(자동 배포)" : ""}\n${t.title}${notes.length ? `\n${notes.join("\n")}` : ""}\n${body}${list}`.slice(0, 1500),
      reply_markup: { inline_keyboard: rows },
    });
  } catch {
    console.error("[telegram] 정비 알림 처리 실패");
  }
}

// 정비 대기열이 다 끝나 '배포 필요'(포함될 지시 목록은 text 에). 승인 버튼을 켰으면 [배포] 버튼을 붙인다. 절대 던지지 않는다.
export async function notifyDeployReady(threadId: string, text: string): Promise<void> {
  try {
    if (!token() || !chatId()) return;
    const row: Record<string, string>[] = [{ text: "통제실 열기", url: `${publicUrl()}/admin/factory` }];

    if (approveEnabled() && secret()) row.unshift({ text: "🚀 배포", callback_data: `md:${threadId}` });
    await tg("sendMessage", { chat_id: chatId(), text: text.slice(0, 1500), reply_markup: { inline_keyboard: [row] } });
  } catch {
    console.error("[telegram] 정비 알림 처리 실패");
  }
}

// 길이가 같으면 끝까지 비교해서 틀린 위치로 시간 차이가 나지 않게 한다.
const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;

  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);

  return diff === 0;
};

// 웹훅 요청이 텔레그램이 보낸 것인지 확인한다.
export const isValidWebhook = (header: string | null) =>
  secret() !== "" && header !== null && same(header, secret());

interface Update {
  message?: { chat?: { id?: number }; from?: { id?: number }; text?: string };
  callback_query?: {
    id: string;
    from?: { id?: number };
    data?: string;
    message?: { message_id?: number; date?: number; chat?: { id?: number } };
  };
}

export async function handleUpdate(update: Update): Promise<void> {
  // 1) chat id 를 아직 안 정했을 때만: 누가 말을 걸면 그 chat id 를 알려 준다. (정한 뒤에는 모든 일반 메시지를 무시)
  const msg = update.message;

  if (
    msg &&
    chatId() === "" &&
    msg.chat?.id !== undefined &&
    typeof msg.text === "string"
  ) {
    await tg("sendMessage", {
      chat_id: msg.chat.id,
      text: `이 채팅의 chat id: ${msg.chat.id}\n서버 설정의 TELEGRAM_CHAT_ID 에 이 값을 넣고 다시 배포하세요. 본인 계정이 아니라면 무시하세요.`,
    });

    return;
  }

  // 2) 알림 버튼
  const cq = update.callback_query;

  if (!cq) return;

  const allowed =
    chatId() !== "" &&
    String(cq.from?.id ?? "") === chatId() &&
    String(cq.message?.chat?.id ?? "") === chatId();

  if (!allowed) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id });

    return;
  }

  const answer = (text: string) =>
    tg("answerCallbackQuery", { callback_query_id: cq.id, text });

  if (!approveEnabled()) {
    await answer("승인 버튼이 꺼져 있어요. 통제실에서 승인하세요.");

    return;
  }

  // 모델 목록 열기(ao:<일감 id>, mo:<지시 id>): 승인하지 않고 같은 알림의 버튼만 모델 목록으로 바꾼다
  const mo = /^(a|m)o:([A-Za-z0-9_-]{1,40})$/.exec(cq.data ?? "");

  if (mo && ID_RE.test(mo[2])) {
    const age = Math.floor(Date.now() / 1000) - (cq.message?.date ?? 0);

    if (!cq.message?.date || age > MAX_BUTTON_AGE_SEC || cq.message.message_id === undefined) {
      await answer("오래된 알림이라 처리할 수 없어요. 통제실에서 하세요.");

      return;
    }
    await tg("editMessageReplyMarkup", {
      chat_id: chatId(),
      message_id: cq.message.message_id,
      reply_markup: { inline_keyboard: modelKeyboard(mo[1] === "a" ? "a" : "ma", mo[2], `${publicUrl()}/admin/factory`) },
    });
    await answer("승인할 모델을 골라 주세요.");

    return;
  }

  // 공장 정비 버튼: ma:<지시 id>[:<모델 번호>] 승인, md:<정비 id> 배포, mc·mr·mx:<실패한 지시 id> 대기열 계속 진행·재시도·비우기
  const mm = /^m([adcrx]):([A-Za-z0-9_-]{1,40})(?::(\d{1,2}))?$/.exec(cq.data ?? "");

  if (mm && ID_RE.test(mm[2])) {
    const age = Math.floor(Date.now() / 1000) - (cq.message?.date ?? 0);

    if (!cq.message?.date || age > MAX_BUTTON_AGE_SEC) {
      await answer("오래된 알림이라 처리할 수 없어요. 통제실에서 하세요.");

      return;
    }
    const model = mm[3] === undefined ? null : CLAUDE_MODELS[Number(mm[3])];

    if (model === undefined || (mm[3] !== undefined && mm[1] !== "a")) {
      await answer("알 수 없는 버튼이에요.");

      return;
    }
    const act = ({ a: "maintenance_approve", d: "deploy", c: "queue_skip", r: "queue_retry", x: "queue_clear" } as const)[mm[1] as "a" | "d" | "c" | "r" | "x"];
    const r = await runApproval(act, mm[2], "텔레그램", undefined, model);

    await answer(r.message.slice(0, 190));
    // 처리했거나 이미 (통제실 등에서) 처리된 건이면 버튼을 지운다
    if ((r.ok || r.status === 409) && cq.message?.message_id !== undefined) {
      await tg("editMessageReplyMarkup", {
        chat_id: chatId(),
        message_id: cq.message.message_id,
        reply_markup: { inline_keyboard: [[{ text: "통제실 열기", url: `${publicUrl()}/admin/factory` }]] },
      });
    }

    return;
  }

  const m = /^a:([A-Za-z0-9_-]{1,40})(?::(\d{1,2}))?$/.exec(cq.data ?? "");
  const jobModel = m?.[2] === undefined ? null : CLAUDE_MODELS[Number(m[2])];

  if (!m || !ID_RE.test(m[1]) || jobModel === undefined) {
    await answer("알 수 없는 버튼이에요.");

    return;
  }

  const age = Math.floor(Date.now() / 1000) - (cq.message?.date ?? 0);

  if (!cq.message?.date || age > MAX_BUTTON_AGE_SEC) {
    await answer("오래된 알림이라 승인할 수 없어요. 통제실에서 하세요.");

    return;
  }

  const result = await runApproval("job_approve", m[1], "텔레그램", undefined, jobModel);

  await answer(result.message);

  // 눌렀으면 승인 버튼은 지운다.
  if (cq.message?.message_id !== undefined) {
    await tg("editMessageReplyMarkup", {
      chat_id: chatId(),
      message_id: cq.message.message_id,
      reply_markup: {
        inline_keyboard: [
          [{ text: "통제실 열기", url: `${publicUrl()}/admin/factory` }],
        ],
      },
    });
  }
}
