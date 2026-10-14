// components/admin/factory/SettingsCard.tsx
// 통제실 [설정] 공용 틀: 제목 · 설명 · 내용 · 안내문(저장 결과) · 도움말. 카드마다 따로 쓰던 같은 테두리·글자 크기를 한곳에 모았다.
// 저장 방식(즉시/버튼)은 카드마다 달라서 내용(children)에서 정하고, 틀은 모양과 안내문 자리만 맡는다.
import type { ReactNode } from "react";

export default function SettingsCard({
  title,
  description,
  notice,
  help,
  id,
  attrs,
  children,
}: {
  title: string;
  description?: ReactNode;
  notice?: string | null; // 저장 결과 같은 한 줄 안내(role=status)
  help?: ReactNode[]; // 아래에 작게 붙는 도움말 문단들
  id?: string;
  attrs?: Record<string, string>; // data-* 같은 표식(시험·미리보기용)
  children?: ReactNode;
}) {
  return (
    <section className="scroll-mt-24 min-w-0 space-y-3 rounded-lg border border-default-200 p-4" id={id} {...attrs}>
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="text-sm text-default-500">{description}</p>}
      {children}
      {help?.map((h, i) => (
        <p key={i} className="text-sm text-default-500">{h}</p>
      ))}
      {notice ? <p className="text-sm" role="status">{notice}</p> : null}
    </section>
  );
}

/** 설정 탭의 주제 묶음: 제목 줄 + 카드들 */
export function SettingsGroup({ title, hint, id, children }: { title: string; hint?: string; id?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 space-y-3" id={id}>
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {hint && <p className="text-xs fx-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** 선택 단추 줄(1~4개, 시간 고르기 등)이 쓰는 같은 모양 */
export function ChoiceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div aria-label={label} className="flex flex-wrap gap-2" role="group">
      {children}
    </div>
  );
}
