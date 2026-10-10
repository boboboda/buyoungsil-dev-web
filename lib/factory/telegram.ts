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
import { ID_RE, adminAction } from "@/lib/factory/jobs";

const API_TIMEOUT_MS = 5000;
const MAX_BUTTON_AGE_SEC = 24 * 60 * 60; // 24시간이 지난 알림의 버튼은 무시한다

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

export type JobEvent = "pending" | "done" | "failed";

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
      },
    });

    if (!job) return;

    const kind = job.kind === "new" ? "새 앱" : "수정";
    let text: string;

    if (event === "pending") {
      text = `📥 승인 대기\n${job.title} (${job.appSlug}) · ${kind}${job.source ? `\n출처: ${cut(job.source, 60)}` : ""}`;
    } else if (event === "done") {
      text = `✅ 완료\n${job.title} (${job.appSlug}) · ${kind}\n${cut(job.summary, 200) || "(요약 없음)"}`;
    } else {
      text = `❌ 실패\n${job.title} (${job.appSlug}) · ${kind}\n${cut(job.failReason, 200) || "(사유 없음)"}`;
    }

    const row: Record<string, string>[] = [
      { text: "통제실 열기", url: `${publicUrl()}/admin/factory` },
    ];

    if (event === "pending" && approveEnabled() && secret()) {
      row.unshift({ text: "✅ 승인", callback_data: `a:${job.id}` });
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

  const m = /^a:([A-Za-z0-9_-]{1,40})$/.exec(cq.data ?? "");

  if (!m || !ID_RE.test(m[1])) {
    await answer("알 수 없는 버튼이에요.");

    return;
  }

  const age = Math.floor(Date.now() / 1000) - (cq.message?.date ?? 0);

  if (!cq.message?.date || age > MAX_BUTTON_AGE_SEC) {
    await answer("오래된 알림이라 승인할 수 없어요. 통제실에서 하세요.");

    return;
  }

  const result = await adminAction(m[1], { action: "approve" });

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
