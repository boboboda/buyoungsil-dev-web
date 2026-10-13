// components/admin/factory/ToolboxPanel.tsx
// 통제실 [설정] 맨 위 '도구함 한눈에 보기'(읽기 전용, 서버에서 그린다·훅 없음).
// 도구마다 한 줄 카드: 이름·하는 일·지금 상태·관리하는 곳·설정하는 곳 링크·최근 사용 횟수(중계 기록이 있는 도구만).
// 설정을 바꾸는 버튼은 없다(바꾸는 곳은 아래 '도구 요청 중계' 패널 그대로). 못 읽은 칸은 '확인 못 함', 패널 전체가 실패해도 통제실은 뜬다.
import prisma from "@/lib/prisma";
import { buildToolbox, readToolboxSource, type Tone, type ToolCard, type Toolbox, type ToolGroup, type ToolUsage } from "@/lib/factory/toolbox";

const TONE_CLASS: Record<Tone, string> = { ok: "fx-ok", warn: "fx-warn", bad: "fx-bad", muted: "fx-muted" };
const TONE_MARK: Record<Tone, string> = { ok: "●", warn: "◐", bad: "✕", muted: "○" };

const GROUPS: { key: ToolGroup; title: string; help: string }[] = [
  { key: "allowed", title: "허용 목록 · 감독 프로그램이 대신 실행", help: "AI 가 요청서를 쓰면 감독 프로그램이 이 도구만 대신 실행해요." },
  { key: "blocked", title: "막힘 · 허용 목록 밖", help: "목록에 없는 이름은 요청서를 읽자마자 거절해요." },
  { key: "pc", title: "작업 PC 의 도구", help: "감독 프로그램이 이 PC 에서 직접 쓰는 프로그램이에요. 상태는 PC 가 알려 준 값이에요." },
  { key: "connector", title: "Claude 채팅 커넥터", help: "Claude 채팅이 홈페이지에 일을 맡길 때 쓰는 도구예요." },
];

function usageText(u: ToolUsage | null | undefined, days: number) {
  if (u === undefined) return null;
  if (u === null) return `최근 ${days}일 사용: 확인 못 함`;
  if (u.total === 0) return `최근 ${days}일 사용: 0회`;

  return `최근 ${days}일 사용: ${u.total}회 (성공 ${u.ok} · 거절 ${u.denied} · 실패 ${u.failed})`;
}

function Card({ card, days }: { card: ToolCard; days: number }) {
  const usage = usageText(card.usage, days);

  return (
    <li className="fx-panel min-w-0 p-3" data-tool={card.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 break-all font-mono font-semibold">{card.name}</span>
        <span className={`min-w-0 break-words text-sm ${TONE_CLASS[card.tone]}`} data-state={card.tone}>
          <span aria-hidden>{TONE_MARK[card.tone]} </span>
          {card.state}
        </span>
      </div>
      <p className="mt-1 break-words text-sm">{card.does}</p>
      {card.note ? <p className="mt-1 break-words text-sm fx-muted">{card.note}</p> : null}
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm fx-muted">
        <span>관리: {card.managers.join(" · ")}</span>
        <a className="underline underline-offset-2" href={card.where.href}>
          → {card.where.label}
        </a>
        {usage ? <span className="font-mono">{usage}</span> : null}
      </p>
    </li>
  );
}

export function ToolboxView({ toolbox }: { toolbox: Toolbox | null }) {
  const days = toolbox?.usageDays ?? 30;

  return (
    <section aria-label="도구함 접근 설정" className="fx-hud scroll-mt-24" id="toolbox">
      <header className="fx-hud-head">
        <h2 className="fx-hud-title">toolbox · 접근 설정</h2>
        <span className="text-sm fx-muted">읽기 전용</span>
      </header>

      {!toolbox ? (
        <p className="text-sm fx-muted" role="status">
          ○ 확인 못 함 — 도구 상태를 읽지 못했어요. 아래 각 설정 패널은 그대로 쓸 수 있어요.
        </p>
      ) : (
        <>
          <p className="mb-3 break-words text-sm" data-broker="">
            도구 요청 중계:{" "}
            {toolbox.broker ? (
              <>
                <b className={TONE_CLASS[toolbox.broker.tone]}>{toolbox.broker.mode}</b>
                <span className="fx-muted"> · {toolbox.broker.limits}</span>
              </>
            ) : (
              <b className="fx-muted">확인 못 함</b>
            )}
          </p>
          {GROUPS.map((g) => {
            const cards = toolbox.cards.filter((c) => c.group === g.key);

            return cards.length ? (
              <div key={g.key} className="mb-4" data-group={g.key}>
                <h3 className="fx-label mb-1">{g.title}</h3>
                <p className="mb-2 text-sm fx-muted">{g.help}</p>
                <ul className="grid gap-2">
                  {cards.map((c) => (
                    <Card key={c.key} card={c} days={days} />
                  ))}
                </ul>
              </div>
            ) : null;
          })}
        </>
      )}

      <div className="mt-2 space-y-1 break-words text-sm" id="toolbox-guide">
        <h3 className="fx-label mb-1">도구함 관리 방법</h3>
        <p>
          <b>켜고 끄기</b> — 아래 &apos;도구 요청 중계&apos;에서 모드를 골라요. 꺼짐: 요청을 보지 않음 · 보고만: 기록만 하고 실행 안 함 · 허용: 허용 목록
          도구를 실제로 실행. 일감당 요청 수와 한 번 실행 시간도 거기서 제한해요.
        </p>
        <p>
          <b>허용 목록에 도구 추가</b> — 허용 목록(echo, toolkit.run)은 감독 프로그램 코드(toolbroker.mjs)에 고정돼 있어요. 새 도구는 공장 정비 지시로
          코드를 고쳐야 들어가요. 통제실 스위치로는 추가할 수 없어요.
        </p>
        <p>
          <b>툴킷 명령 추가·제한</b> — toolkit.run 이 실행할 수 있는 명령은 작업 PC 의 game-toolkit/tools.json(도구 목록 파일)에 적어요. 적힌 인자만
          받고, 파일 경로는 앱 폴더 안만 돼요. 키(비밀값)가 필요한 명령은 그 일감의 &apos;필요한 키&apos;에 이름이 있어야 돌고, 키 값은 그 도구에만 넘겨요.
        </p>
        <p>
          <b>AI 프로그램·ffmpeg</b> — 작업 PC 에 설치·로그인하면 감독 프로그램이 알아서 알려 줘요(AI 는 1시간마다). 새로 설치한 뒤에는 [현황]에서 감독
          프로그램을 재시작하면 바로 찾아요.
        </p>
        <p>
          <b>채팅 커넥터</b> — 도구 목록은 홈페이지 코드에 고정돼 있고, claude.ai 커넥터 설정에 홈페이지 토큰을 넣어 연결해요. 토큰 값은 여기 보이지 않아요.
        </p>
        <p className="fx-muted">
          &apos;특수교육 도구함&apos; 사이트의 요청 게시판은 이것과 다른 곳이에요 →{" "}
          <a className="underline underline-offset-2" href="/admin/edu">
            /admin/edu
          </a>
        </p>
      </div>
    </section>
  );
}

export default async function ToolboxPanel() {
  let toolbox: Toolbox | null = null;

  try {
    toolbox = buildToolbox(await readToolboxSource(prisma));
  } catch (error) {
    console.error("[toolbox] 도구함 읽기 실패:", error instanceof Error ? error.name : "unknown");
  }

  return <ToolboxView toolbox={toolbox} />;
}
