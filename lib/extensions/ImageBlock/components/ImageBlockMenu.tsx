import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import React, { useCallback, useRef } from "react";
import { v4 as uuid } from "uuid";

import { ImageBlockWidth } from "./ImageBlockWidth";
import { Toolbar } from "@/components/titap/Toolbar";
import { Icon } from "@/components/titap/Icon";
import { MenuProps } from "@/components/titap/menus/types";
import { getRenderContainer } from "@/lib/utils";

export const ImageBlockMenu = ({
  editor,
  appendTo,
}: MenuProps): JSX.Element => {
  const menuRef = useRef<HTMLDivElement>(null);

  const getReferenceClientRect = useCallback(() => {
    const renderContainer = getRenderContainer(editor, "node-imageBlock");
    const rect =
      renderContainer?.getBoundingClientRect() ||
      new DOMRect(-1000, -1000, 0, 0);

    return rect;
  }, [editor]);

  const shouldShow = useCallback(() => {
    const isActive = editor.isActive("imageBlock");
    return isActive;
  }, [editor]);

  const onAlignImageLeft = useCallback(() => {
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .setImageBlockAlign("left")
      .run();
  }, [editor]);

  const onAlignImageCenter = useCallback(() => {
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .setImageBlockAlign("center")
      .run();
  }, [editor]);

  const onAlignImageRight = useCallback(() => {
    editor
      .chain()
      .focus(undefined, { scrollIntoView: false })
      .setImageBlockAlign("right")
      .run();
  }, [editor]);

  const onWidthChange = useCallback(
    (value: number) => {
      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .setImageBlockWidth(value)
        .run();
    },
    [editor],
  );

  const { isImageCenter, isImageLeft, isImageRight, width } = useEditorState({
    editor,
    selector: (ctx) => {
      return {
        isImageLeft: ctx.editor.isActive("imageBlock", { align: "left" }),
        isImageCenter: ctx.editor.isActive("imageBlock", { align: "center" }),
        isImageRight: ctx.editor.isActive("imageBlock", { align: "right" }),
        width: parseInt(ctx.editor.getAttributes("imageBlock")?.width || 0),
      };
    },
  });

  return (
    <BubbleMenu
  editor={editor}
  pluginKey={`imageBlockMenu-${uuid()}`}
  shouldShow={shouldShow}
  options={{
    placement: 'top',
    offset: 8,
  }}
  updateDelay={0}
>
      <Toolbar.Wrapper ref={menuRef} shouldShowContent={shouldShow()}>
        <Toolbar.Button
          active={isImageLeft}
          tooltip="Align image left"
          onClick={onAlignImageLeft}
        >
          <Icon name="AlignHorizontalDistributeStart" />
        </Toolbar.Button>
        <Toolbar.Button
          active={isImageCenter}
          tooltip="Align image center"
          onClick={onAlignImageCenter}
        >
          <Icon name="AlignHorizontalDistributeCenter" />
        </Toolbar.Button>
        <Toolbar.Button
          active={isImageRight}
          tooltip="Align image right"
          onClick={onAlignImageRight}
        >
          <Icon name="AlignHorizontalDistributeEnd" />
        </Toolbar.Button>
        <Toolbar.Divider />
        <ImageBlockWidth value={width} onChange={onWidthChange} />
      </Toolbar.Wrapper>
    </BubbleMenu>
  );
};

export default ImageBlockMenu;