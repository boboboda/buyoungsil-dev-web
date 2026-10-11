// components/admin/factory/Field.tsx
// 입력칸 위에 항상 보이는 라벨과 아래 한 줄 도움말. placeholder 는 예시값만 두고, 무슨 값인지는 여기서 알려 준다.
import type { ReactNode } from "react";

export default function Field({ label, help, className = "", children }: { label: ReactNode; help?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className="break-words text-xs font-medium text-default-700">{label}</span>
      {children}
      {help && <span className="break-words text-xs text-default-500">{help}</span>}
    </label>
  );
}
