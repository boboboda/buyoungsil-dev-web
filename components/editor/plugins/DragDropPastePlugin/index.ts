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
import {useEffect, useRef} from 'react';

import {INSERT_IMAGE_COMMAND} from '../ImagesPlugin';
import {mediaUploader} from '@/lib/utils/mediaUpload';

const ACCEPTABLE_IMAGE_TYPES = [
  'image/',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/webp',
];

export default function DragDropPaste(): null {
  const [editor] = useLexicalComposerContext();
  const uploadingRef = useRef(false); // 🔥 업로드 중 플래그
  
  useEffect(() => {
    return editor.registerCommand(
      DRAG_DROP_PASTE,
      (files) => {
        (async () => {
          // 🔥 이미 업로드 중이면 무시
          if (uploadingRef.current) {
            console.log('⏳ 이미 업로드 중입니다. 잠시 후 다시 시도하세요.');
            return;
          }

          uploadingRef.current = true;
          console.log('🚀 [DragDropPaste] 업로드 시작');

          try {
            const filesResult = await mediaFileReader(
              files,
              [ACCEPTABLE_IMAGE_TYPES].flatMap((x) => x),
            );
            
            console.log(`📁 처리할 이미지: ${filesResult.length}개`);
            
            // 🔥 순차적으로 업로드 (동시 업로드 방지)
            for (let i = 0; i < filesResult.length; i++) {
              const {file, result} = filesResult[i];
              
              if (isMimeType(file, ACCEPTABLE_IMAGE_TYPES)) {
                console.log(`📤 [${i + 1}/${filesResult.length}] 업로드 중: ${file.name}`);
                
                try {
                  // MediaUploadService 사용
                  const uploadResult = await mediaUploader.uploadImage(file);
                  
                  if (uploadResult.success && uploadResult.url) {
                    console.log(`✅ 업로드 성공: ${uploadResult.url}`);
                    
                    // 이미지 노드 삽입
                    editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
                      altText: file.name,
                      src: uploadResult.url,
                    });
                  } else {
                    console.error(`❌ 업로드 실패: ${uploadResult.error}`);
                    
                    // 실패 시 base64 폴백
                    editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
                      altText: file.name,
                      src: result, // base64
                    });
                  }
                } catch (error) {
                  console.error(`🔥 업로드 예외 (${file.name}):`, error);
                  
                  // 예외 시 base64 폴백
                  editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
                    altText: file.name,
                    src: result,
                  });
                }
                
                // 🔥 각 업로드 사이에 약간의 딜레이 (서버 부하 방지)
                if (i < filesResult.length - 1) {
                  await new Promise(resolve => setTimeout(resolve, 300));
                }
              }
            }
            
            console.log('🎉 모든 이미지 업로드 완료');
          } finally {
            uploadingRef.current = false;
          }
        })();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);
  
  return null;
}