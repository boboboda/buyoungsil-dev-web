import { BubbleMenu } from "@tiptap/react/menus";
import { offset } from "@floating-ui/dom";
import React, { useCallback } from "react";

import { isColumnGripSelected } from "./utils";

import * as PopoverMenu from "@/components/titap/PopoverMenu";
import { Toolbar } from "@/components/titap/Toolbar";
import { Icon } from "@/components/titap/Icon";
import { MenuProps, ShouldShowProps } from "@/components/titap/menus/types";

export const TableColumnMenu = React.memo(
  ({ editor, appendTo }: MenuProps): JSX.Element => {
    const shouldShow = useCallback(
      ({ view, state, from }: ShouldShowProps) => {
        if (!state) {
          return false;
        }

        return isColumnGripSelected({ editor, view, state, from: from || 0 });
      },
      [editor],
    );

    const onAddColumnBefore = useCallback(() => {
      editor.chain().focus().addColumnBefore().run();
    }, [editor]);

    const onAddColumnAfter = useCallback(() => {
      editor.chain().focus().addColumnAfter().run();
    }, [editor]);

    const onDeleteColumn = useCallback(() => {
      editor.chain().focus().deleteColumn().run();
    }, [editor]);

    return (
      <BubbleMenu
  editor={editor}
  pluginKey="tableColumnMenu"
  shouldShow={shouldShow}
  options={{
    placement: 'top',
    offset: 15,
  }}
  updateDelay={0}
>
        <Toolbar.Wrapper isVertical>
          <PopoverMenu.Item
            close={false}
            iconComponent={<Icon name="ArrowLeftToLine" />}
            label="Add column before"
            onClick={onAddColumnBefore}
          />
          <PopoverMenu.Item
            close={false}
            iconComponent={<Icon name="ArrowRightToLine" />}
            label="Add column after"
            onClick={onAddColumnAfter}
          />
          <PopoverMenu.Item
            close={false}
            icon="Trash"
            label="Delete column"
            onClick={onDeleteColumn}
          />
        </Toolbar.Wrapper>
      </BubbleMenu>
    );
  },
);

TableColumnMenu.displayName = "TableColumnMenu";

export default TableColumnMenu;
