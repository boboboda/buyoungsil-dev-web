import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

// 스토리 본문은 HTML 로 저장/표시된다.
// allowDangerousHtml 를 켜지 않으므로 본문 속 원시 HTML(<script> 등)은 결과에서 제거된다.
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify);

export function markdownToHtml(markdown: string): string {
  const html = String(processor.processSync(markdown));
  // javascript: 등 위험한 링크 주소는 무력화
  return html.replace(/href="\s*(?:javascript|data|vbscript):[^"]*"/gi, 'href="#"');
}
