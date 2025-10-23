import { forwardRef } from "react";

import { cn } from "@/lib/utils";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...rest }, ref) => {
  const textAreaClassName = cn(
    "bg-black/5 border-0 rounded-lg block text-black text-sm font-medium h-[4.5rem] px-2 py-1 w-full [caret-color:theme(colors.slate.900)]",
    "dark:bg-white/10 dark:text-white dark:[caret-color:white]",
    "hover:bg-black/10",
    "dark:hover:bg-white/20",
    "focus:bg-transparent active:bg-transparent focus:outline focus:outline-black active:outline active:outline-black",
    "dark:focus:outline-white dark:active:outline-white",
    className,
  );

  return <textarea ref={ref} className={textAreaClassName} {...rest} />;
});

Textarea.displayName = "Textarea";
