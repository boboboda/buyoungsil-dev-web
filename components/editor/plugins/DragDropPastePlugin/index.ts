// components/editor/plugins/DragDropPastePlugin/index.ts
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {DRAG_DROP_PASTE} from '@lexical/rich-text';
import {isMimeType, mediaFileReader} from '@lexical/utils';
import {COMMAND_PRIORITY_LOW} from 'lexical';
import {useEffect} from 'react';
import {toast} from 'react-toastify'; // 🔥 추가

import {INSERT_IMAGE_COMMAND} from '../ImagesPlugin';

const ACCEPTABLE_IMAGE_TYPES = [
  'image/',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/webp',
  'image/jpeg',
  'image/jpg',
  'image/png',
];

export default function DragDropPaste(): null {
  const [editor] = useLexicalComposerContext();
  
  useEffect(() => {
    return editor.registerCommand(
      DRAG_DROP_PASTE,
      (files) => {
        (async () => {
          console.log("🖼️ 이미지 드롭/붙여넣기 감지:", files);
          
          const filesResult = await mediaFileReader(
            files,
            [ACCEPTABLE_IMAGE_TYPES].flatMap((x) => x),
          );
          
          for (const {file, result} of filesResult) {
            if (isMimeType(file, ACCEPTABLE_IMAGE_TYPES)) {
              console.log("📤 이미지 업로드 시작:", file.name);
              
              // 🔥 서버에 업로드
              const formData = new FormData();
              formData.append('image', file);
              
              try {
                const response = await fetch('/api/upload/local', {
                  method: 'POST',
                  body: formData,
                });
                
                const data = await response.json();
                
                if (data.success) {
                  console.log("✅ 업로드 성공:", data.imageUrl);
                  
                  // 🔥 URL로 이미지 삽입
                  editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
                    altText: file.name,
                    src: data.imageUrl, // 서버 URL
                    maxWidth: 800,
                  });
                  
                  toast.success(`이미지 업로드 완료: ${file.name}`);
                } else {
                  console.error("❌ 업로드 실패:", data.error);
                  toast.error('이미지 업로드 실패');
                  
                  // 🔥 폴백: Base64 사용
                  editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
                    altText: file.name,
                    src: result, // Base64
                    maxWidth: 800,
                  });
                }
              } catch (error) {
                console.error('❌ 업로드 에러:', error);
                toast.error('이미지 업로드 중 오류 발생');
                
                // 🔥 폴백: Base64 사용
                editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
                  altText: file.name,
                  src: result,
                  maxWidth: 800,
                });
              }
            }
          }
        })();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);
  
  return null;
}