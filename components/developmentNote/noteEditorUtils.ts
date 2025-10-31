// components/developmentNote/noteEditorUtils.ts
import { 
  $getRoot, 
  $createParagraphNode, 
  $createTextNode 
} from 'lexical';
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text';
import { $createListNode, $createListItemNode } from '@lexical/list';
import { $createCodeNode } from '@lexical/code';
import { Note } from "@/store/editorSotre";

interface TipTapNode {
  type: string;
  attrs?: any;
  content?: TipTapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: any }>;
}

interface TipTapDocument {
  type: 'doc';
  content: TipTapNode[];
}

export function $prepareNoteContent(note?: Note) {
  const root = $getRoot();
  
  console.log("🚀 $prepareNoteContent 실행");
  console.log("📦 note:", note);
  console.log("📄 content:", note?.content);
  
  // root 초기화
  root.clear();

  // 새 노트인 경우
  if (!note || !note.content) {
    console.log("✨ 새 노트 - 기본 컨텐츠 생성");
    const heading = $createHeadingNode('h1');
    heading.append($createTextNode('새 노트 제목'));
    root.append(heading);
    
    const paragraph = $createParagraphNode();
    paragraph.append($createTextNode('여기에 내용을 작성하세요...'));
    root.append(paragraph);
    return;
  }

  try {
    console.log("📖 기존 노트 로드 시도");
    
    let content = note.content;
    
    // 문자열인 경우 파싱
    if (typeof content === 'string') {
      console.log("🔄 문자열 → JSON 파싱");
      content = JSON.parse(content);
    }

    console.log("📋 파싱된 content:", content);
    console.log("📋 content.type:", (content as any)?.type);

    // 🔥 TipTap Document 형식 (type: "doc")
    if (content && typeof content === 'object' && (content as TipTapDocument).type === 'doc') {
      console.log("✅ TipTap Document 형식 감지!");
      const docContent = (content as TipTapDocument).content;
      
      if (Array.isArray(docContent)) {
        console.log(`📚 ${docContent.length}개의 노드 변환 시작`);
        
        let successCount = 0;
        let failCount = 0;

        docContent.forEach((node: TipTapNode, index: number) => {
          console.log(`  [${index + 1}/${docContent.length}] ${node.type} 노드 변환`);
          
          try {
            const lexicalNode = convertTipTapNodeToLexical(node);
            if (lexicalNode) {
              root.append(lexicalNode);
              successCount++;
              console.log(`    ✅ 성공`);
            } else {
              failCount++;
              console.log(`    ⚠️ null 반환`);
            }
          } catch (error) {
            failCount++;
            console.error(`    ❌ 에러:`, error);
          }
        });

        console.log(`🎉 변환 완료: 성공 ${successCount}, 실패 ${failCount}`);
        
        if (successCount === 0) {
          console.log("⚠️ 모든 노드 변환 실패");
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode('내용을 불러올 수 없습니다.'));
          root.append(paragraph);
        }
        
        return;
      }
    }

    // 🔥 배열 형태 (이전 버전 호환)
    if (Array.isArray(content)) {
      console.log(`✅ TipTap 배열 형식! (${content.length}개 노드)`);
      
      content.forEach((node: TipTapNode) => {
        const lexicalNode = convertTipTapNodeToLexical(node);
        if (lexicalNode) {
          root.append(lexicalNode);
        }
      });
      return;
    }

    // 🔥 Lexical JSON 형식
    if (content && typeof content === 'object' && (content as any).root) {
      console.log("✅ Lexical JSON 형식");
      return;
    }

    // 알 수 없는 형식
    console.log("❌ 알 수 없는 형식");
    const paragraph = $createParagraphNode();
    paragraph.append($createTextNode('지원하지 않는 형식입니다.'));
    root.append(paragraph);

  } catch (error) {
    console.error('❌ $prepareNoteContent 에러:', error);
    root.clear();
    const paragraph = $createParagraphNode();
    paragraph.append($createTextNode('내용을 불러오는 중 오류가 발생했습니다.'));
    root.append(paragraph);
  }
}

function convertTipTapNodeToLexical(node: TipTapNode): any {
  console.log(`    🔄 변환: ${node.type}`);
  
  try {
    switch (node.type) {
      case 'heading': {
        const level = node.attrs?.level || 1;
        console.log(`      📌 h${level}`);
        const heading = $createHeadingNode(`h${level}` as any);
        
        if (node.content && Array.isArray(node.content)) {
          node.content.forEach(child => {
            if (child.type === 'text' && child.text) {
              const textNode = $createTextNode(child.text);
              applyMarks(textNode, child.marks);
              heading.append(textNode);
            }
          });
        }
        return heading;
      }

      case 'paragraph': {
        console.log(`      📌 paragraph`);
        const paragraph = $createParagraphNode();
        
        if (node.content && Array.isArray(node.content)) {
          node.content.forEach(child => {
            if (child.type === 'text' && child.text) {
              const textNode = $createTextNode(child.text);
              applyMarks(textNode, child.marks);
              paragraph.append(textNode);
            }
          });
        }
        // 빈 paragraph도 반환
        return paragraph;
      }

      case 'blockquote': {
        console.log(`      📌 blockquote`);
        const quote = $createQuoteNode();
        
        if (node.content && Array.isArray(node.content)) {
          node.content.forEach(child => {
            const childNode = convertTipTapNodeToLexical(child);
            if (childNode) {
              quote.append(childNode);
            }
          });
        }
        return quote;
      }

      case 'bulletList': {
        console.log(`      📌 bulletList`);
        const list = $createListNode('bullet');
        
        if (node.content && Array.isArray(node.content)) {
          node.content.forEach(child => {
            if (child.type === 'listItem') {
              const listItem = $createListItemNode();
              if (child.content && Array.isArray(child.content)) {
                child.content.forEach(itemChild => {
                  const itemNode = convertTipTapNodeToLexical(itemChild);
                  if (itemNode) {
                    listItem.append(itemNode);
                  }
                });
              }
              list.append(listItem);
            }
          });
        }
        return list;
      }

      case 'orderedList': {
        console.log(`      📌 orderedList`);
        const list = $createListNode('number');
        
        if (node.content && Array.isArray(node.content)) {
          node.content.forEach(child => {
            if (child.type === 'listItem') {
              const listItem = $createListItemNode();
              if (child.content && Array.isArray(child.content)) {
                child.content.forEach(itemChild => {
                  const itemNode = convertTipTapNodeToLexical(itemChild);
                  if (itemNode) {
                    listItem.append(itemNode);
                  }
                });
              }
              list.append(listItem);
            }
          });
        }
        return list;
      }

      case 'codeBlock': {
        console.log(`      📌 codeBlock`);
        const code = $createCodeNode(node.attrs?.language);
        
        if (node.content && Array.isArray(node.content)) {
          node.content.forEach(child => {
            if (child.type === 'text' && child.text) {
              const textNode = $createTextNode(child.text);
              code.append(textNode);
            }
          });
        }
        return code;
      }

      default:
        console.warn(`      ⚠️ 알 수 없는 타입: ${node.type}`);
        const paragraph = $createParagraphNode();
        if (node.content && Array.isArray(node.content)) {
          node.content.forEach(child => {
            if (child.type === 'text' && child.text) {
              paragraph.append($createTextNode(child.text));
            }
          });
        }
        return paragraph;
    }
  } catch (error) {
    console.error(`      ❌ 변환 에러:`, error);
    return null;
  }
}

function applyMarks(textNode: any, marks?: Array<{ type: string; attrs?: any }>) {
  if (!marks || !Array.isArray(marks)) return;
  
  marks.forEach(mark => {
    switch (mark.type) {
      case 'bold':
        textNode.toggleFormat('bold');
        break;
      case 'italic':
        textNode.toggleFormat('italic');
        break;
      case 'code':
        textNode.toggleFormat('code');
        break;
      case 'underline':
        textNode.toggleFormat('underline');
        break;
      case 'strikethrough':
        textNode.toggleFormat('strikethrough');
        break;
    }
  });
}