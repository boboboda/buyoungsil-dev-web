'use client';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { FORMAT_TEXT_COMMAND, FORMAT_ELEMENT_COMMAND } from 'lexical';
import { Button } from '../ui/Button';

export default function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();

  const formatBold = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
  };

  const formatItalic = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
  };

  const formatUnderline = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline');
  };

  const formatStrikethrough = () => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough');
  };

  const formatAlignLeft = () => {
    editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'left');
  };

  const formatAlignCenter = () => {
    editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'center');
  };

  const formatAlignRight = () => {
    editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'right');
  };

  return (
    <div className="flex flex-wrap gap-1 p-2 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
      {/* 텍스트 서식 */}
      <div className="flex gap-1">
        <Button onClick={formatBold} title="Bold (Ctrl+B)">
          <strong>B</strong>
        </Button>
        <Button onClick={formatItalic} title="Italic (Ctrl+I)">
          <em>I</em>
        </Button>
        <Button onClick={formatUnderline} title="Underline (Ctrl+U)">
          <u>U</u>
        </Button>
        <Button onClick={formatStrikethrough} title="Strikethrough">
          <s>S</s>
        </Button>
      </div>

      {/* 구분선 */}
      <div className="w-px h-8 bg-neutral-300 dark:bg-neutral-700 mx-1" />

      {/* 정렬 */}
      <div className="flex gap-1">
        <Button onClick={formatAlignLeft} title="Align Left">
          ⬅
        </Button>
        <Button onClick={formatAlignCenter} title="Align Center">
          ↔
        </Button>
        <Button onClick={formatAlignRight} title="Align Right">
          ➡
        </Button>
      </div>
    </div>
  );
}