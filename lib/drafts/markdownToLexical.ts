import { createHeadlessEditor } from "@lexical/headless";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";

// 초안 마크다운 → 에디터가 읽는 Lexical 상태(JSON). 초안에 쓰는 기본 서식만 지원한다.
export function markdownToLexical(markdown: string): unknown {
  const editor = createHeadlessEditor({
    namespace: "draft-convert",
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      CodeHighlightNode,
      LinkNode,
      AutoLinkNode,
    ],
    onError: (error) => {
      throw error;
    },
  });

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, TRANSFORMERS);
    },
    { discrete: true },
  );

  return editor.getEditorState().toJSON();
}
