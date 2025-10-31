/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

// Extend HTMLElement interface for experimental attributes
interface HTMLElementWithBeforeMatch extends HTMLElement {
  onbeforematch?: () => void;
}

export function setDomHiddenUntilFound(dom: HTMLElement): void {
  // @ts-expect-error
  dom.hidden = 'until-found';
}

export function domOnBeforeMatch(dom: HTMLElement, callback: () => void): void {
  (dom as HTMLElementWithBeforeMatch).onbeforematch = callback;
}