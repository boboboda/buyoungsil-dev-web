// lib/note/lexicalToHtml.ts
// 저장된 Lexical JSON → 읽기용 HTML 문자열 (서버에서 실행, DOM 없이 JSON 만 걸어 다닌다).
// 용도: 글 본문을 서버가 내려주는 HTML 에 넣어서 검색/광고 크롤러가 JS 없이도 본문을 읽게 한다.
// 화면에서는 이 HTML 을 잠깐 보여주다가 Lexical 읽기 에디터가 준비되면 바꿔 끼운다.
// 알 수 없는 노드는 자식만 이어 붙이고, 변환할 수 없는 형식(TipTap 등)이면 빈 문자열을 돌려준다.

type LexNode = {
  type?: string;
  children?: LexNode[];
  text?: string;
  format?: number | string;
  tag?: string;
  listType?: string;
  url?: string;
  language?: string;
  src?: string;
  altText?: string;
  checked?: boolean;
  value?: number;
};

const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 2;
const FORMAT_STRIKETHROUGH = 4;
const FORMAT_UNDERLINE = 8;
const FORMAT_CODE = 16;
const FORMAT_SUBSCRIPT = 32;
const FORMAT_SUPERSCRIPT = 64;

const MAX_NODES = 20000; // 비정상적으로 큰 데이터 방어

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 링크/이미지 주소: http(s), mailto, 사이트 안 상대 경로만 허용 (javascript: 등 차단)
function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();

  if (!url) return null;
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (url.startsWith("#")) return url;

  return null;
}

function renderText(node: LexNode): string {
  let html = escapeHtml(node.text ?? "");
  const format = typeof node.format === "number" ? node.format : 0;

  if (format & FORMAT_CODE) html = `<code>${html}</code>`;
  if (format & FORMAT_BOLD) html = `<strong>${html}</strong>`;
  if (format & FORMAT_ITALIC) html = `<em>${html}</em>`;
  if (format & FORMAT_STRIKETHROUGH) html = `<s>${html}</s>`;
  if (format & FORMAT_UNDERLINE) html = `<u>${html}</u>`;
  if (format & FORMAT_SUBSCRIPT) html = `<sub>${html}</sub>`;
  if (format & FORMAT_SUPERSCRIPT) html = `<sup>${html}</sup>`;

  return html;
}

export function lexicalToHtml(content: unknown): string {
  let data: any = content;

  try {
    if (typeof data === "string") data = JSON.parse(data);
  } catch {
    return "";
  }

  const root: LexNode | undefined = data?.root;

  if (!root || !Array.isArray(root.children)) return "";

  let count = 0;

  const renderChildren = (node: LexNode): string =>
    (node.children ?? []).map(renderNode).join("");

  // 코드 블록 안: 텍스트/줄바꿈/탭만 이어 붙인다 (서식 태그 없이)
  const renderCode = (node: LexNode): string =>
    (node.children ?? [])
      .map((child) => {
        if (child.type === "linebreak") return "\n";
        if (child.type === "tab") return "\t";

        return escapeHtml(child.text ?? "");
      })
      .join("");

  function renderNode(node: LexNode): string {
    if (!node || ++count > MAX_NODES) return "";

    switch (node.type) {
      case "text":
      case "code-highlight":
        return renderText(node);
      case "linebreak":
        return "<br />";
      case "tab":
        return "\t";
      case "paragraph": {
        const inner = renderChildren(node);

        return inner ? `<p>${inner}</p>` : "";
      }
      case "heading": {
        const tag = /^h[1-6]$/.test(node.tag ?? "") ? (node.tag as string) : "h2";

        return `<${tag}>${renderChildren(node)}</${tag}>`;
      }
      case "quote":
        return `<blockquote>${renderChildren(node)}</blockquote>`;
      case "list": {
        const tag = node.listType === "number" ? "ol" : "ul";

        return `<${tag}>${renderChildren(node)}</${tag}>`;
      }
      case "listitem":
        return `<li>${renderChildren(node)}</li>`;
      case "link":
      case "autolink": {
        const href = safeUrl(node.url);
        const inner = renderChildren(node);

        return href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${inner}</a>` : inner;
      }
      case "code": {
        const lang = (node.language ?? "").replace(/[^a-zA-Z0-9_+#-]/g, "");
        const cls = lang ? ` class="language-${lang}"` : "";

        return `<pre><code${cls}>${renderCode(node)}</code></pre>`;
      }
      case "horizontalrule":
        return "<hr />";
      case "image": {
        const src = safeUrl(node.src);

        return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.altText ?? "")}" loading="lazy" />` : "";
      }
      case "table":
        return `<table><tbody>${renderChildren(node)}</tbody></table>`;
      case "tablerow":
        return `<tr>${renderChildren(node)}</tr>`;
      case "tablecell":
        return `<td>${renderChildren(node)}</td>`;
      default:
        // 알 수 없는 노드(유튜브, 임베드 등): 안에 글이 있으면 이어 붙이고, 없으면 건너뛴다
        return node.children ? renderChildren(node) : "";
    }
  }

  return renderChildren(root).trim();
}
