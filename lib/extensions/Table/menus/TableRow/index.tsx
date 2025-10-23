import { BubbleMenu } from "@tiptap/react/menus";
import { offset } from "@floating-ui/dom";
import React, { useCallback } from "react";

import { isRowGripSelected } from "./utils";

import * as PopoverMenu from "@/components/titap/PopoverMenu";
import { Toolbar } from "@/components/titap/Toolbar";
import { Icon } from "@/components/titap/Icon";
import { MenuProps, ShouldShowProps } from "@/components/titap/menus/types";

export const TableRowMenu = React.memo(
  ({ editor, appendTo }: MenuProps): JSX.Element => {
    const shouldShow = useCallback(
      ({ view, state, from }: ShouldShowProps) => {
        if (!state || !from) {
          return false;
        }

        return isRowGripSelected({ editor, view, state, from });
      },
      [editor],
    );

    const onAddRowBefore = useCallback(() => {
      editor.chain().focus().addRowBefore().run();
    }, [editor]);

    const onAddRowAfter = useCallback(() => {
      editor.chain().focus().addRowAfter().run();
    }, [editor]);

    const onDeleteRow = useCallback(() => {
      editor.chain().focus().deleteRow().run();
    }, [editor]);

    return (
      <BubbleMenu
  editor={editor}
  pluginKey="tableRowMenu"
  shouldShow={shouldShow}
  options={{
    placement: 'left',
    offset: 15,
  }}
  updateDelay={0}
>
        <Toolbar.Wrapper isVertical>
          <PopoverMenu.Item
            close={false}
            iconComponent={<Icon name="ArrowUpToLine" />}
            label="Add row before"
            onClick={onAddRowBefore}
          />
          <PopoverMenu.Item
            close={false}
            iconComponent={<Icon name="ArrowDownToLine" />}
            label="Add row after"
            onClick={onAddRowAfter}
          />
          <PopoverMenu.Item
            close={false}
            icon="Trash"
            label="Delete row"
            onClick={onDeleteRow}
          />
        </Toolbar.Wrapper>
      </BubbleMenu>
    );
  },
);

TableRowMenu.displayName = "TableRowMenu";

export default TableRowMenu;
