/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {JSX} from 'react';

import {CAN_USE_BEFORE_INPUT} from '@lexical/utils';
import {useEffect, useMemo, useState} from 'react';

import {INITIAL_SETTINGS, isDevPlayground} from './appSettings';
import {useSettings} from './context/SettingsContext';
import Switch from './ui/Switch';

export default function Settings(): JSX.Element {
  // ✅ useState로 변경
  const [windowLocation, setWindowLocation] = useState<Location | null>(null);
  
  // ✅ useEffect에서 클라이언트 사이드에서만 설정
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWindowLocation(window.location);
    }
  }, []);

  const {
    setOption,
    settings: {
      isRichText,
      isMaxLength,
      hasLinkAttributes,
      isCharLimit,
      isCharLimitUtf8,
      isAutocomplete,
      showTreeView,
      // disableBeforeInput,
      showTableOfContents,
      shouldUseLexicalContextMenu,
      shouldPreserveNewLinesInMarkdown,
      shouldAllowHighlightingWithBrackets,
      // tableHorizontalScroll,
      selectionAlwaysOnDisplay,
      isCodeHighlighted,
      isCodeShiki,
    },
  } = useSettings();
  
  useEffect(() => {
    if (INITIAL_SETTINGS.disableBeforeInput && CAN_USE_BEFORE_INPUT) {
      console.error(
        `Legacy events are enabled (disableBeforeInput) but CAN_USE_BEFORE_INPUT is true`,
      );
    }
  }, []);
  
  const [showSettings, setShowSettings] = useState(false);
  
  // ✅ window 체크 추가
  const [isSplitScreen, search] = useMemo(() => {
    if (typeof window === 'undefined' || !windowLocation) {
      return [false, ''];
    }
    
    const parentWindow = window.parent;
    const _search = windowLocation.search;
    const _isSplitScreen =
      parentWindow && parentWindow.location.pathname === '/split/';
    return [_isSplitScreen, _search];
  }, [windowLocation]);

  return (
    <>
      <button
        id="options-button"
        className={`editor-dev-button ${showSettings ? 'active' : ''}`}
        onClick={() => setShowSettings(!showSettings)}
      />
      {showSettings ? (
        <div className="switches">
          {isDevPlayground && (
            <Switch
              onClick={() => {
                if (typeof window === 'undefined') return;
                
                if (isSplitScreen) {
                  window.parent.location.href = `/${search}`;
                } else {
                  window.location.href = `/split/${search}`;
                }
              }}
              checked={isSplitScreen}
              text="Split Screen"
            />
          )}
   
          <Switch
            onClick={() => setOption('showTreeView', !showTreeView)}
            checked={showTreeView}
            text="Debug View"
          />
          <Switch
            onClick={() => setOption('isCharLimit', !isCharLimit)}
            checked={isCharLimit}
            text="Char Limit"
          />
          <Switch
            onClick={() => setOption('isCharLimitUtf8', !isCharLimitUtf8)}
            checked={isCharLimitUtf8}
            text="Char Limit (UTF-8)"
          />
          <Switch
            onClick={() => setOption('hasLinkAttributes', !hasLinkAttributes)}
            checked={hasLinkAttributes}
            text="Link Attributes"
          />
          <Switch
            onClick={() => setOption('isMaxLength', !isMaxLength)}
            checked={isMaxLength}
            text="Max Length"
          />
          <Switch
            onClick={() => setOption('isAutocomplete', !isAutocomplete)}
            checked={isAutocomplete}
            text="Autocomplete"
          />
          {/* <Switch
            onClick={() => {
              setOption('disableBeforeInput', !disableBeforeInput);
              setTimeout(() => window.location.reload(), 500);
            }}
            checked={disableBeforeInput}
            text="Legacy Events"
          /> */}
          <Switch
            onClick={() => {
              setOption('showTableOfContents', !showTableOfContents);
            }}
            checked={showTableOfContents}
            text="Table Of Contents"
          />
          <Switch
            onClick={() => {
              setOption(
                'shouldUseLexicalContextMenu',
                !shouldUseLexicalContextMenu,
              );
            }}
            checked={shouldUseLexicalContextMenu}
            text="Use Lexical Context Menu"
          />
          <Switch
            onClick={() => {
              setOption(
                'shouldPreserveNewLinesInMarkdown',
                !shouldPreserveNewLinesInMarkdown,
              );
            }}
            checked={shouldPreserveNewLinesInMarkdown}
            text="Preserve newlines in Markdown"
          />
          <Switch
            onClick={() => {
              setOption(
                'shouldAllowHighlightingWithBrackets',
                !shouldAllowHighlightingWithBrackets,
              );
            }}
            checked={shouldAllowHighlightingWithBrackets}
            text="Highlighting w/ bracket matching"
          />
          <Switch
            onClick={() => setOption('isRichText', !isRichText)}
            checked={isRichText}
            text="Rich Text"
          />
          {/* <Switch
            onClick={() => setOption('tableHorizontalScroll', !tableHorizontalScroll)}
            checked={tableHorizontalScroll}
            text="Table Horizontal Scroll"
          /> */}
          <Switch
            onClick={() => {
              setOption('selectionAlwaysOnDisplay', !selectionAlwaysOnDisplay);
            }}
            checked={selectionAlwaysOnDisplay}
            text="Selection Always on Display"
          />
          <Switch
            onClick={() => {
              setOption('isCodeHighlighted', !isCodeHighlighted);
            }}
            checked={isCodeHighlighted}
            text="Code Highlighting"
          />
          <Switch
            onClick={() => {
              setOption('isCodeShiki', !isCodeShiki);
            }}
            checked={isCodeShiki}
            text="Code Shiki"
          />
        </div>
      ) : null}
    </>
  );
}