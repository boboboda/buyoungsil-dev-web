"use client";

import type { JSX } from "react";

import { $isCodeNode, CodeNode } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $isParagraphNode,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
} from "lexical";
import { useEffect } from "react";

/**
 * 붙여넣기 직후, 코드 블록 바로 앞에 "언어 이름만 있는 문단"이 있으면
 * 그 이름을 코드 블록의 language 로 옮기고 문단은 삭제한다.
 *
 * 예) Claude/블로그 글을 복사하면 코드 블록 위에 "dart" 라벨이 따로 붙어 오는데,
 *     에디터는 이걸 일반 문단으로 넣고 코드 블록은 기본값(javascript)으로 만든다.
 *
 * 직접 타이핑한 글에는 영향이 없도록, 붙여넣기 후 PASTE_WINDOW_MS 동안만 동작한다.
 */

const PASTE_WINDOW_MS = 500;

// 라벨 텍스트(소문자) → Prism 언어 id
const LABEL_TO_LANGUAGE: Record<string, string> = {
  dart: "dart",
  flutter: "dart",
  kotlin: "kotlin",
  kt: "kotlin",
  java: "java",
  swift: "swift",
  javascript: "javascript",
  js: "javascript",
  jsx: "javascript",
  typescript: "typescript",
  ts: "typescript",
  tsx: "typescript",
  python: "python",
  py: "python",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  powershell: "powershell",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  html: "markup",
  xml: "markup",
  css: "css",
  sql: "sql",
  rust: "rust",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  objc: "objc",
  markdown: "markdown",
  md: "markdown",
  gradle: "java",
};

export default function CodeLanguagePastePlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let pasteUntil = 0;

    // RichText 의 붙여넣기 핸들러(NORMAL)가 true 를 반환해 뒤 핸들러를 막으므로,
    // 그보다 먼저 실행되도록 HIGH 로 등록하고 false 를 반환해 흐름은 그대로 둔다.
    const unregisterPaste = editor.registerCommand(
      PASTE_COMMAND,
      () => {
        pasteUntil = Date.now() + PASTE_WINDOW_MS;
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterTransform = editor.registerNodeTransform(
      CodeNode,
      (codeNode) => {
        if (Date.now() > pasteUntil) {
          return;
        }

        const prev = codeNode.getPreviousSibling();

        if (!$isParagraphNode(prev)) {
          return;
        }

        const label = prev.getTextContent().trim().toLowerCase();
        const language = LABEL_TO_LANGUAGE[label];

        if (!language) {
          return;
        }

        codeNode.setLanguage(language);
        prev.remove();
      },
    );

    return () => {
      unregisterPaste();
      unregisterTransform();
    };
  }, [editor]);

  return null;
}