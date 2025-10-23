import React from "react";

import { cn } from "@/lib/utils";

export const DropdownCategoryTitle = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <div className="text-[.65rem] font-semibold mb-1 uppercase text-neutral-500 dark:text-neutral-400 px-1.5">
      {children}
    </div>
  );
};

export const DropdownButton = React.forwardRef<
  HTMLDivElement, // 1. 타입을 HTMLButtonElement에서 HTMLDivElement로 변경
  {
    children: React.ReactNode;
    isActive?: boolean;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
  }
>(function DropdownButtonInner(
  { children, isActive, onClick, disabled, className },
  ref,
) {
  const buttonClass = cn(
    "flex items-center gap-2 p-1.5 text-sm font-medium text-neutral-500 dark:text-neutral-400 text-left bg-transparent w-full rounded",
    !isActive && !disabled,
    "hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200",
    isActive &&
      !disabled &&
      "bg-neutral-100 text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200",
    disabled && "text-neutral-400 cursor-not-allowed dark:text-neutral-600",
    className,
  );

  // 2. <button>을 <div>로 변경하고, disabled 상태일 때 onClick을 막아줍니다.
  return (
    <div
      ref={ref}
      className={buttonClass}
      onClick={disabled ? undefined : onClick}
    >
      {children}
    </div>
  );
});
