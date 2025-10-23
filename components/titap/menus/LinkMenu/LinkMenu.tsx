import React, { useCallback, useState } from "react";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from '@tiptap/react/menus'

import { MenuProps } from "../types";
import { LinkPreviewPanel } from "@/components/titap/panels/LinkPreviewPanel";
import { LinkEditorPanel } from "@/components/titap/panels";

export const LinkMenu = ({ editor, appendTo }: MenuProps): JSX.Element => {
  const [showEdit, setShowEdit] = useState(false);
  const { link, target } = useEditorState({
    editor,
    selector: (ctx) => {
      const attrs = ctx.editor.getAttributes("link");

      return { link: attrs.href, target: attrs.target };
    },
  });

  const shouldShow = useCallback(() => {
    const isActive = editor.isActive("link");
    return isActive;
  }, [editor]);

  const handleEdit = useCallback(() => {
    setShowEdit(true);
  }, []);

  const onSetLink = useCallback(
    (url: string, openInNewTab?: boolean) => {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url, target: openInNewTab ? "_blank" : "" })
        .run();
      setShowEdit(false);
    },
    [editor],
  );

  const onUnsetLink = useCallback(() => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setShowEdit(false);
    return null;
  }, [editor]);

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="linkMenu"
      shouldShow={shouldShow}
      options={{
        placement: 'bottom',
        onHide: () => {
          setShowEdit(false);
        },
      }}
      updateDelay={0}
    >
      {showEdit ? (
        <LinkEditorPanel
          initialOpenInNewTab={target === "_blank"}
          initialUrl={link}
          onSetLink={onSetLink}
        />
      ) : (
        <LinkPreviewPanel
          url={link}
          onClear={onUnsetLink}
          onEdit={handleEdit}
        />
      )}
    </BubbleMenu>
  );
};

export default LinkMenu;