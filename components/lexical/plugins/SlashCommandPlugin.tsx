'use client';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect, useState, useCallback } from 'react';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  TextNode,
} from 'lexical';
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingTagType,
} from '@lexical/rich-text';
import { $createCodeNode } from '@lexical/code';
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from '@lexical/list';
import { $setBlocksType } from '@lexical/selection';

interface SlashCommand {
  title: string;
  description: string;
  keywords: string[];
  icon: string;
  onSelect: () => void;
}

export default function SlashCommandPlugin() {
  const [editor] = useLexicalComposerContext();
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 슬래시 명령어 목록
  const getCommands = useCallback((): SlashCommand[] => {
    return [
      {
        title: 'Heading 1',
        description: '큰 제목',
        keywords: ['h1', 'heading1', '제목1'],
        icon: 'H1',
        onSelect: () => {
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              $setBlocksType(selection, () => $createHeadingNode('h1'));
            }
          });
        },
      },
      {
        title: 'Heading 2',
        description: '중간 제목',
        keywords: ['h2', 'heading2', '제목2'],
        icon: 'H2',
        onSelect: () => {
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              $setBlocksType(selection, () => $createHeadingNode('h2'));
            }
          });
        },
      },
      {
        title: 'Heading 3',
        description: '작은 제목',
        keywords: ['h3', 'heading3', '제목3'],
        icon: 'H3',
        onSelect: () => {
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              $setBlocksType(selection, () => $createHeadingNode('h3'));
            }
          });
        },
      },
      {
        title: 'Bullet List',
        description: '글머리 기호 목록',
        keywords: ['ul', 'bullet', 'list', '목록'],
        icon: '•',
        onSelect: () => {
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        },
      },
      {
        title: 'Numbered List',
        description: '번호 목록',
        keywords: ['ol', 'numbered', 'list', '번호'],
        icon: '1.',
        onSelect: () => {
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
        },
      },
      {
        title: 'Quote',
        description: '인용문',
        keywords: ['quote', 'blockquote', '인용'],
        icon: '"',
        onSelect: () => {
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              $setBlocksType(selection, () => $createQuoteNode());
            }
          });
        },
      },
      {
        title: 'Code Block',
        description: '코드 블록',
        keywords: ['code', 'codeblock', '코드'],
        icon: '</>',
        onSelect: () => {
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              $setBlocksType(selection, () => $createCodeNode());
            }
          });
        },
      },
    ];
  }, [editor]);

  // 필터링된 명령어
  const filteredCommands = getCommands().filter((command) => {
    const searchQuery = query.toLowerCase();
    return (
      command.title.toLowerCase().includes(searchQuery) ||
      command.description.toLowerCase().includes(searchQuery) ||
      command.keywords.some((keyword) => keyword.includes(searchQuery))
    );
  });

  // 슬래시 입력 감지
  useEffect(() => {
    const updateListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          setShowMenu(false);
          return;
        }

        const anchor = selection.anchor;
        const node = anchor.getNode();

        if (node instanceof TextNode) {
          const textContent = node.getTextContent();
          const offset = anchor.offset;

          // 슬래시 이전 텍스트 찾기
          const textBeforeCursor = textContent.slice(0, offset);
          const slashIndex = textBeforeCursor.lastIndexOf('/');

          if (slashIndex !== -1) {
            // 슬래시 이후 쿼리 추출
            const searchQuery = textBeforeCursor.slice(slashIndex + 1);
            
            // 슬래시가 단어 시작 부분에 있는지 확인
            const charBeforeSlash = textBeforeCursor[slashIndex - 1];
            const isAtWordStart = slashIndex === 0 || charBeforeSlash === ' ' || charBeforeSlash === '\n';

            if (isAtWordStart) {
              setQuery(searchQuery);
              setShowMenu(true);
              setSelectedIndex(0);

              // 메뉴 위치 계산
              const domSelection = window.getSelection();
              if (domSelection && domSelection.rangeCount > 0) {
                const range = domSelection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                setMenuPosition({
                  top: rect.bottom + window.scrollY + 5,
                  left: rect.left + window.scrollX,
                });
              }
              return;
            }
          }
        }

        setShowMenu(false);
      });
    });

    return () => {
      updateListener();
    };
  }, [editor]);

  // 키보드 네비게이션
  useEffect(() => {
    if (!showMenu) return;

    const arrowDownCommand = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => {
        setSelectedIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : prev
        );
        return true;
      },
      COMMAND_PRIORITY_LOW
    );

    const arrowUpCommand = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      () => {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        return true;
      },
      COMMAND_PRIORITY_LOW
    );

    const enterCommand = editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        if (filteredCommands[selectedIndex]) {
          executeCommand(filteredCommands[selectedIndex]);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW
    );

    const escapeCommand = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        setShowMenu(false);
        return true;
      },
      COMMAND_PRIORITY_LOW
    );

    return () => {
      arrowDownCommand();
      arrowUpCommand();
      enterCommand();
      escapeCommand();
    };
  }, [showMenu, selectedIndex, filteredCommands, editor]);

  // 명령어 실행
  const executeCommand = (command: SlashCommand) => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      // 슬래시와 쿼리 삭제
      const anchor = selection.anchor;
      const node = anchor.getNode();

      if (node instanceof TextNode) {
        const textContent = node.getTextContent();
        const offset = anchor.offset;
        const textBeforeCursor = textContent.slice(0, offset);
        const slashIndex = textBeforeCursor.lastIndexOf('/');

        if (slashIndex !== -1) {
          // 슬래시부터 현재 커서까지 삭제
          const newText =
            textContent.slice(0, slashIndex) + textContent.slice(offset);
          node.setTextContent(newText);
          
          // 커서를 슬래시 위치로 이동
          selection.anchor.set(node.getKey(), slashIndex, 'text');
          selection.focus.set(node.getKey(), slashIndex, 'text');
        }
      }

      command.onSelect();
    });

    setShowMenu(false);
    setQuery('');
    setSelectedIndex(0);
  };

  if (!showMenu || filteredCommands.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed z-50 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 py-2 min-w-[280px] max-h-[400px] overflow-y-auto"
      style={{
        top: `${menuPosition.top}px`,
        left: `${menuPosition.left}px`,
      }}
    >
      {filteredCommands.map((command, index) => (
        <button
          key={command.title}
          type="button"
          onClick={() => executeCommand(command)}
          onMouseEnter={() => setSelectedIndex(index)}
          className={`
            w-full text-left px-4 py-2 flex items-center gap-3
            transition-colors
            ${
              index === selectedIndex
                ? 'bg-neutral-100 dark:bg-neutral-700'
                : 'hover:bg-neutral-50 dark:hover:bg-neutral-750'
            }
          `}
        >
          <span className="text-xl w-8 text-center">{command.icon}</span>
          <div className="flex-1">
            <div className="font-medium text-neutral-900 dark:text-neutral-100">
              {command.title}
            </div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {command.description}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}