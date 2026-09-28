/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import {registerCodeHighlighting} from '@lexical/code';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {useEffect} from 'react';

// @lexical/code가 기본으로 번들하는 Prism 언어 목록에 dart가 빠져있어서
// (flutter 카테고리 코드블록용) 별도로 등록해준다. 다른 언어는 이미
// @lexical/code 내부에서 로드됨.
import 'prismjs/components/prism-dart';

export default function CodeHighlightPrismPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return registerCodeHighlighting(editor);
  }, [editor]);

  return null;
}
