import { memo, useCallback, useMemo } from "react";
import { Editor } from "@tiptap/react";

import { TableOfContents } from "../TableOfContents";

import { cn } from "@/lib/utils";

export const Sidebar = memo(
  ({
    editor,
    isOpen,
    onClose,
  }: {
    editor: Editor;
    isOpen?: boolean;
    onClose: () => void;
  }) => {
    const handlePotentialClose = useCallback(() => {
      if (window.innerWidth < 1024) {
        onClose();
      }
    }, [onClose]); // onClose가 변경될 때만 재생성

    // 클래스명을 useMemo로 메모화
    const windowClassName = useMemo(
      () =>
        cn(
          "absolute top-0 left-0 lg:backdrop-blur-xl h-full lg:h-auto lg:relative z-[999] w-0 duration-300 transition-all",
          "dark:bg-[#27272A]",
          !isOpen && "border-r-transparent",
          isOpen && "w-80 border-r border-r-neutral-200 dark:border-r-white",
        ),
      [isOpen],
    );

    return (
      <div className={windowClassName}>
        <div className="w-full h-full overflow-hidden">
          <div className="w-full h-full p-6 overflow-auto">
            <TableOfContents
              editor={editor}
              onItemClick={handlePotentialClose}
            />
          </div>
        </div>
      </div>
    );
  },
);

Sidebar.displayName = "TableOfContentSidepanel";
