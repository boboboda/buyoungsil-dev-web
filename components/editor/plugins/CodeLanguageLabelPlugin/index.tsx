"use client";

import type { JSX } from "react";

import { $isCodeNode, CodeNode, getLanguageFriendlyName } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey } from "lexical";
import { useEffect } from "react";

/**
 * 코드 블록 DOM 엘리먼트에 data-language 속성을 심어주는 플러그인.
 *
 * 글쓰기 화면(CodeActionMenuPlugin)은 마우스를 올렸을 때만 언어 이름표가
 * 보이는데, 읽기 화면은 마우스 오버라는 개념이 의미가 없어서
 * "항상 보이는" 뱃지가 필요하다.
 *
 * data-language 속성만 채워주고, 실제 뱃지 모양은
 * PlaygroundEditorTheme.css 의 ::after 로 그린다.
 */
export default function CodeLanguageLabelPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const applyLabel = (nodeKey: string) => {
      const dom = editor.getElementByKey(nodeKey);

      if (!dom) {
        return;
      }

      editor.getEditorState().read(() => {
        const node = $getNodeByKey(nodeKey);

        if (!$isCodeNode(node)) {
          return;
        }

        const lang = node.getLanguage();
        const friendlyName = lang ? getLanguageFriendlyName(lang) : "";

        if (friendlyName) {
          dom.setAttribute("data-language", friendlyName);
        } else {
          dom.removeAttribute("data-language");
        }
      });
    };

    return editor.registerMutationListener(
      CodeNode,
      (mutations) => {
        for (const [nodeKey, mutationType] of mutations) {
          if (mutationType === "destroyed") {
            continue;
          }
          applyLabel(nodeKey);
        }
      },
      { skipInitialization: false },
    );
  }, [editor]);

  return null;
}