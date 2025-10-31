'use client';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  COMMAND_PRIORITY_LOW,
  ElementFormatType,
  $isElementNode,
} from 'lexical';
import { $setBlocksType } from '@lexical/selection';
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  HeadingTagType,
} from '@lexical/rich-text';
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  ListNode,
} from '@lexical/list';
import { $createCodeNode } from '@lexical/code';
import { $isLinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { mergeRegister } from '@lexical/utils';
import { PATCH_TEXT_STYLE_COMMAND, NO_STYLE } from '../styleState';
import { INSERT_IMAGE_COMMAND } from './ImagePlugin';
import { INSERT_HORIZONTAL_RULE_COMMAND } from './HorizontalRulePlugin';

const LowPriority = 1;

function Divider() {
  return <div className="divider" />;
}

export default function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const toolbarRef = useRef(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [blockType, setBlockType] = useState('paragraph');
  const [elementFormat, setElementFormat] = useState<ElementFormatType>('left');
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isStyled, setIsStyled] = useState(false);
  const [isLink, setIsLink] = useState(false);

  const $updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      // Update text format
      setIsBold(selection.hasFormat('bold'));
      setIsItalic(selection.hasFormat('italic'));
      setIsUnderline(selection.hasFormat('underline'));
      setIsStrikethrough(selection.hasFormat('strikethrough'));
      
      // Check if text has custom style
      const nodes = selection.getNodes();
      const hasStyle = nodes.some((node) => {
        if ('getStyle' in node && typeof node.getStyle === 'function') {
          const style = node.getStyle();
          return style && style.includes('text-shadow');
        }
        return false;
      });
      setIsStyled(hasStyle);

      // Check if selection is on a link
      const node = selection.anchor.getNode();
      const parent = node.getParent();
      setIsLink($isLinkNode(parent) || $isLinkNode(node));

      // Update block type
      const anchorNode = selection.anchor.getNode();
      let element =
        anchorNode.getKey() === 'root'
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
      const elementKey = element.getKey();
      const elementDOM = editor.getElementByKey(elementKey);

      if (elementDOM !== null) {
        if ($isListNode(element)) {
          const listType = element.getListType();
          setBlockType(listType);
        } else {
          const type = $isHeadingNode(element)
            ? element.getTag()
            : element.getType();
          setBlockType(type);
        }
        
        // Update element format
        if ($isElementNode(element)) {
          const formatType = element.getFormatType();
          setElementFormat(formatType);
        }
      }
    }
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          $updateToolbar();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_payload, _newEditor) => {
          $updateToolbar();
          return false;
        },
        LowPriority,
      ),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        (payload) => {
          setCanUndo(payload);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        (payload) => {
          setCanRedo(payload);
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, $updateToolbar]);

  const formatParagraph = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        $setBlocksType(selection, () => $createParagraphNode());
      }
    });
  };

  const formatHeading = (headingSize: HeadingTagType) => {
    if (blockType !== headingSize) {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createHeadingNode(headingSize));
        }
      });
    }
  };

  const formatQuote = () => {
    if (blockType !== 'quote') {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createQuoteNode());
        }
      });
    }
  };

  const formatBulletList = () => {
    if (blockType !== 'bullet') {
      editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    }
  };

  const formatNumberedList = () => {
    if (blockType !== 'number') {
      editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    }
  };

  const formatCode = () => {
    if (blockType !== 'code') {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createCodeNode());
        }
      });
    }
  };

  const insertLink = () => {
    if (!isLink) {
      const url = prompt('Enter URL:');
      if (url) {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
      }
    } else {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    }
  };

  const insertImage = () => {
    const url = prompt('Enter image URL:');
    if (url) {
      editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
        altText: 'Image',
        src: url,
      });
    }
  };

  const insertHorizontalRule = () => {
  editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined);
};

  return (
    <div className="toolbar" ref={toolbarRef}>
      <button
        disabled={!canUndo}
        onClick={() => {
          editor.dispatchCommand(UNDO_COMMAND, undefined);
        }}
        className="toolbar-item spaced"
        aria-label="Undo">
        <i className="format undo" />
      </button>
      <button
        disabled={!canRedo}
        onClick={() => {
          editor.dispatchCommand(REDO_COMMAND, undefined);
        }}
        className="toolbar-item"
        aria-label="Redo">
        <i className="format redo" />
      </button>
      <Divider />
      <button
        onClick={() => formatParagraph()}
        className={'toolbar-item ' + (blockType === 'paragraph' ? 'active' : '')}
        aria-label="Normal">
        <span>Normal</span>
      </button>
      <button
        onClick={() => formatHeading('h1')}
        className={'toolbar-item ' + (blockType === 'h1' ? 'active' : '')}
        aria-label="Heading 1">
        <span>H1</span>
      </button>
      <button
        onClick={() => formatHeading('h2')}
        className={'toolbar-item ' + (blockType === 'h2' ? 'active' : '')}
        aria-label="Heading 2">
        <span>H2</span>
      </button>
      <button
        onClick={() => formatHeading('h3')}
        className={'toolbar-item ' + (blockType === 'h3' ? 'active' : '')}
        aria-label="Heading 3">
        <span>H3</span>
      </button>
      <button
        onClick={() => formatQuote()}
        className={'toolbar-item ' + (blockType === 'quote' ? 'active' : '')}
        aria-label="Quote">
        <span>Quote</span>
      </button>
      <button
        onClick={() => formatBulletList()}
        className={'toolbar-item ' + (blockType === 'bullet' ? 'active' : '')}
        aria-label="Bullet List">
        <span>• List</span>
      </button>
      <button
        onClick={() => formatNumberedList()}
        className={'toolbar-item ' + (blockType === 'number' ? 'active' : '')}
        aria-label="Numbered List">
        <span>1. List</span>
      </button>
      <button
        onClick={() => formatCode()}
        className={'toolbar-item ' + (blockType === 'code' ? 'active' : '')}
        aria-label="Code Block">
        <span>Code</span>
      </button>
      <Divider />
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold');
        }}
        className={'toolbar-item spaced ' + (isBold ? 'active' : '')}
        aria-label="Format Bold">
        <i className="format bold" />
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic');
        }}
        className={'toolbar-item spaced ' + (isItalic ? 'active' : '')}
        aria-label="Format Italics">
        <i className="format italic" />
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline');
        }}
        className={'toolbar-item spaced ' + (isUnderline ? 'active' : '')}
        aria-label="Format Underline">
        <i className="format underline" />
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough');
        }}
        className={'toolbar-item spaced ' + (isStrikethrough ? 'active' : '')}
        aria-label="Format Strikethrough">
        <i className="format strikethrough" />
      </button>
      <Divider />
      <button
        onClick={() => {
          editor.dispatchCommand(
            PATCH_TEXT_STYLE_COMMAND,
            isStyled
              ? NO_STYLE
              : {
                  'text-shadow': '1px 1px 2px red, 0 0 1em blue, 0 0 0.2em blue',
                },
          );
        }}
        className="toolbar-item spaced"
        aria-label="Toggle Text Style">
        <i className={'text-shadow ' + (isStyled ? 'active' : '')} />
      </button>
      <Divider />
      <button
        onClick={insertLink}
        className={'toolbar-item ' + (isLink ? 'active' : '')}
        aria-label="Insert Link">
        <span>🔗 Link</span>
      </button>
      <button
        onClick={insertImage}
        className="toolbar-item"
        aria-label="Insert Image">
        <span>🖼️ Image</span>
      </button>
      <button
        onClick={insertHorizontalRule}
        className="toolbar-item"
        aria-label="Insert Horizontal Rule">
        <span>➖ HR</span>
      </button>
      <Divider />
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'left');
        }}
        className={'toolbar-item ' + (elementFormat === 'left' ? 'active' : '')}
        aria-label="Left Align">
        <span>⬅️</span>
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'center');
        }}
        className={'toolbar-item ' + (elementFormat === 'center' ? 'active' : '')}
        aria-label="Center Align">
        <span>↔️</span>
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'right');
        }}
        className={'toolbar-item ' + (elementFormat === 'right' ? 'active' : '')}
        aria-label="Right Align">
        <span>➡️</span>
      </button>
      <button
        onClick={() => {
          editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, 'justify');
        }}
        className={'toolbar-item ' + (elementFormat === 'justify' ? 'active' : '')}
        aria-label="Justify Align">
        <span>↕️</span>
      </button>
    </div>
  );
}