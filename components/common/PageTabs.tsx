// 주소(쿼리)로 바뀌는 탭 줄. 서버 컴포넌트에서 그대로 쓴다(링크라 새로고침·공유해도 같은 탭이 열린다).
import Link from "next/link";

export interface PageTab {
  key: string;
  label: string;
  href: string;
}

export function PageTabs({
  tabs,
  active,
  label,
}: {
  tabs: PageTab[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="mb-10 flex justify-center">
      <div className="inline-flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
        {tabs.map((tab) => {
          const isActive = tab.key === active;

          return (
            <Link
              key={tab.key}
              aria-current={isActive ? "page" : undefined}
              className={`min-h-[44px] rounded-lg px-5 py-2.5 text-base font-semibold transition-colors ${
                isActive
                  ? "bg-white text-blue-600 shadow dark:bg-gray-900 dark:text-blue-400"
                  : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
              }`}
              href={tab.href}
              scroll={false}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
