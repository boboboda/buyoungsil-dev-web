import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  createCommand,
  LexicalCommand,
  LexicalEditor,
  LexicalNode,
  TextNode,
} from 'lexical';

type StylePayload = Record<string, string> | ((current: Record<string, string>) => Record<string, string>);

export const PATCH_TEXT_STYLE_COMMAND: LexicalCommand<StylePayload> = createCommand('PATCH_TEXT_STYLE_COMMAND');

export const NO_STYLE = () => ({});

export function registerStyleState(editor: LexicalEditor): () => void {
  return editor.registerCommand(
    PATCH_TEXT_STYLE_COMMAND,
    (payload) => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const nodes = selection.getNodes();
        nodes.forEach((node) => {
          if ($isTextNode(node)) {
            const currentStyle = node.getStyle();
            const newStyle = typeof payload === 'function' 
              ? payload(parseStyle(currentStyle))
              : payload;
            node.setStyle(serializeStyle(newStyle));
          }
        });
      }
      return true;
    },
    COMMAND_PRIORITY_LOW,
  );
}

function parseStyle(styleString: string): Record<string, string> {
  const styles: Record<string, string> = {};
  if (!styleString) return styles;
  
  styleString.split(';').forEach((style) => {
    const [key, value] = style.split(':').map(s => s.trim());
    if (key && value) {
      styles[key] = value;
    }
  });
  return styles;
}

function serializeStyle(styles: Record<string, string>): string {
  return Object.entries(styles)
    .filter(([_, value]) => value)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');
}

export function $exportNodeStyle(
  editor: LexicalEditor,
  target: LexicalNode,
) {
  if ($isTextNode(target)) {
    const style = target.getStyle();
    if (style) {
      return {
        element: document.createElement('span'),
        after: (element: HTMLElement | Text | DocumentFragment) => {
          if (element instanceof HTMLElement) {
            element.style.cssText = style;
          }
          return element;
        },
      };
    }
  }
  return { element: null };
}

export function constructStyleImportMap() {
  return {};
}