import { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { memo } from "react";
import * as Popover from "@radix-ui/react-popover";

import { useTextmenuStates } from "./hooks/useTextmenuStates";
import { useTextmenuCommands } from "./hooks/useTextmenuCommands";
import { FontFamilyPicker } from "./components/FontFamilyPicker";
import { FontSizePicker } from "./components/FontSizePicker";
import { useTextmenuContentTypes } from "./hooks/useTextmenuContentTypes";
import { ContentTypePicker } from "./components/ContentTypePicker";
import { EditLinkPopover } from "./components/EditLinkPopover";

import { Surface } from "@/components/titap/Surface";
import { ColorPicker } from "@/components/titap/panels";
import { Toolbar } from "@/components/titap/Toolbar";
import { Icon } from "@/components/titap/Icon";

// We memorize the button so each button is not rerendered
// on every editor state change
const MemoButton = memo(Toolbar.Button);
const MemoColorPicker = memo(ColorPicker);
const MemoFontFamilyPicker = memo(FontFamilyPicker);
const MemoFontSizePicker = memo(FontSizePicker);
const MemoContentTypePicker = memo(ContentTypePicker);

export type TextMenuProps = {
  editor: Editor;
};

export const TextMenu = ({ editor }: TextMenuProps) => {
  const commands = useTextmenuCommands(editor);
  const states = useTextmenuStates(editor);
  const blockOptions = useTextmenuContentTypes(editor);

  return (
   <BubbleMenu
  editor={editor}
  pluginKey="textMenu"
  shouldShow={states.shouldShow}
  options={{
    placement: 'top-start',
    offset: 8,
    flip: {
      fallbackPlacements: ['bottom-start', 'top-end', 'bottom-end'],
    },
  }}
  updateDelay={100}
>
      <Toolbar.Wrapper>
        <Toolbar.Divider />
        <MemoContentTypePicker options={blockOptions} />
        <MemoFontFamilyPicker
          value={states.currentFont || ""}
          onChange={commands.onSetFont}
        />
        <MemoFontSizePicker
          value={states.currentSize || ""}
          onChange={commands.onSetFontSize}
        />
        <Toolbar.Divider />
        <MemoButton
          active={states.isBold}
          tooltip="Bold"
          tooltipShortcut={["Mod", "B"]}
          onClick={commands.onBold}
        >
          <Icon name="Bold" />
        </MemoButton>
        <MemoButton
          active={states.isItalic}
          tooltip="Italic"
          tooltipShortcut={["Mod", "I"]}
          onClick={commands.onItalic}
        >
          <Icon name="Italic" />
        </MemoButton>
        <MemoButton
          active={states.isUnderline}
          tooltip="Underline"
          tooltipShortcut={["Mod", "U"]}
          onClick={commands.onUnderline}
        >
          <Icon name="Underline" />
        </MemoButton>
        <MemoButton
          active={states.isStrike}
          tooltip="Strikehrough"
          tooltipShortcut={["Mod", "Shift", "S"]}
          onClick={commands.onStrike}
        >
          <Icon name="Strikethrough" />
        </MemoButton>
        <MemoButton
          active={states.isCode}
          tooltip="Code"
          tooltipShortcut={["Mod", "E"]}
          onClick={commands.onCode}
        >
          <Icon name="Code" />
        </MemoButton>
        <MemoButton tooltip="Code block" onClick={commands.onCodeBlock}>
          <Icon name="FileCode" />
        </MemoButton>
        <EditLinkPopover onSetLink={commands.onLink} />
        <Popover.Root>
          <Popover.Trigger asChild>
            <MemoButton
              active={!!states.currentHighlight}
              tooltip="Highlight text"
            >
              <Icon name="Highlighter" />
            </MemoButton>
          </Popover.Trigger>
          <Popover.Content asChild side="top" sideOffset={8}>
            <Surface className="p-1">
              <MemoColorPicker
                color={states.currentHighlight}
                onChange={commands.onChangeHighlight}
                onClear={commands.onClearHighlight}
              />
            </Surface>
          </Popover.Content>
        </Popover.Root>
        <Popover.Root>
          <Popover.Trigger asChild>
            <MemoButton active={!!states.currentColor} tooltip="Text color">
              <Icon name="Palette" />
            </MemoButton>
          </Popover.Trigger>
          <Popover.Content asChild side="top" sideOffset={8}>
            <Surface className="p-1">
              <MemoColorPicker
                color={states.currentColor}
                onChange={commands.onChangeColor}
                onClear={commands.onClearColor}
              />
            </Surface>
          </Popover.Content>
        </Popover.Root>
        <Popover.Root>
          <Popover.Trigger asChild>
            <MemoButton tooltip="More options">
              <Icon name="EllipsisVertical" />
            </MemoButton>
          </Popover.Trigger>
          <Popover.Content asChild side="top">
            <Toolbar.Wrapper>
              <MemoButton
                active={states.isSubscript}
                tooltip="Subscript"
                tooltipShortcut={["Mod", "."]}
                onClick={commands.onSubscript}
              >
                <Icon name="Subscript" />
              </MemoButton>
              <MemoButton
                active={states.isSuperscript}
                tooltip="Superscript"
                tooltipShortcut={["Mod", ","]}
                onClick={commands.onSuperscript}
              >
                <Icon name="Superscript" />
              </MemoButton>
              <Toolbar.Divider />
              <MemoButton
                active={states.isAlignLeft}
                tooltip="Align left"
                tooltipShortcut={["Shift", "Mod", "L"]}
                onClick={commands.onAlignLeft}
              >
                <Icon name="AlignLeft" />
              </MemoButton>
              <MemoButton
                active={states.isAlignCenter}
                tooltip="Align center"
                tooltipShortcut={["Shift", "Mod", "E"]}
                onClick={commands.onAlignCenter}
              >
                <Icon name="AlignCenter" />
              </MemoButton>
              <MemoButton
                active={states.isAlignRight}
                tooltip="Align right"
                tooltipShortcut={["Shift", "Mod", "R"]}
                onClick={commands.onAlignRight}
              >
                <Icon name="AlignRight" />
              </MemoButton>
              <MemoButton
                active={states.isAlignJustify}
                tooltip="Justify"
                tooltipShortcut={["Shift", "Mod", "J"]}
                onClick={commands.onAlignJustify}
              >
                <Icon name="AlignJustify" />
              </MemoButton>
            </Toolbar.Wrapper>
          </Popover.Content>
        </Popover.Root>
      </Toolbar.Wrapper>
    </BubbleMenu>
  );
};
