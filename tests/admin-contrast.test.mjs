// 관리자 HUD 가독성 시험: app/admin/admin-ui.css 의 색 토큰 값으로 WCAG 대비를 계산하고, 글자 크기 바닥값을 확인한다.
// 기준: 본문 ≥ 7:1, 보조 글자·상태 색 ≥ 4.5:1, 흐린 글자(placeholder·비활성) ≥ 3:1, 테두리·구분선 ≥ 3:1.
//       글자 크기는 13px(0.8125rem) 이상, 대문자 모노 라벨만 12px(0.75rem) 허용, 본문 15px·줄간격 1.5 안팎.
// 실행: npm run test:admin-contrast
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(repo, "app/admin/admin-ui.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** .factory-ui { … } 첫 블록의 --fx-* 색 토큰 */
function tokens() {
  const block = css.slice(css.indexOf(".factory-ui {"), css.indexOf("}", css.indexOf(".factory-ui {")));
  return Object.fromEntries([...block.matchAll(/--(fx-[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const t = tokens();
const BACKS = ["fx-bg", "fx-panel", "fx-panel-2"];

test("WCAG 대비 계산이 맞다(흰/검 21:1, 같은 색 1:1)", () => {
  assert.equal(Math.round(contrast("#ffffff", "#000000") * 100) / 100, 21);
  assert.equal(contrast("#777777", "#777777"), 1);
  assert.ok(Math.abs(contrast("#767676", "#ffffff") - 4.54) < 0.01);
});

test("토큰이 다 있다", () => {
  for (const k of ["fx-bg", "fx-panel", "fx-panel-2", "fx-border", "fx-text", "fx-muted", "fx-dim", "fx-accent", "fx-ok", "fx-warn", "fx-bad", "fx-focus"]) {
    assert.match(t[k] ?? "", /^#[0-9a-f]{6}$/, `토큰 ${k} 없음`);
  }
});

test("본문 글자 ≥ 7:1 (바탕·패널·안쪽 칸 모두)", () => {
  for (const b of BACKS) assert.ok(contrast(t["fx-text"], t[b]) >= 7, `fx-text / ${b} = ${contrast(t["fx-text"], t[b]).toFixed(2)}`);
});

test("보조 글자 ≥ 4.5:1 (목표 7:1), 흐린 글자 ≥ 3:1", () => {
  for (const b of BACKS) {
    const m = contrast(t["fx-muted"], t[b]);
    assert.ok(m >= 7, `fx-muted / ${b} = ${m.toFixed(2)} (목표 7:1)`);
    const d = contrast(t["fx-dim"], t[b]);
    assert.ok(d >= 4.5, `fx-dim / ${b} = ${d.toFixed(2)}`); // 기준 3:1 보다 높게 잡음
  }
});

test("상태 색 글자(청록·초록·노랑·빨강) ≥ 4.5:1", () => {
  for (const c of ["fx-accent", "fx-ok", "fx-warn", "fx-bad", "fx-focus"]) {
    for (const b of BACKS) assert.ok(contrast(t[c], t[b]) >= 4.5, `${c} / ${b} = ${contrast(t[c], t[b]).toFixed(2)}`);
  }
});

test("패널 테두리·구분선 ≥ 3:1", () => {
  for (const b of BACKS) assert.ok(contrast(t["fx-border"], t[b]) >= 3, `fx-border / ${b} = ${contrast(t["fx-border"], t[b]).toFixed(2)}`);
});

test("HeroUI 변수도 같은 대비: 보조 글자(default-500)·테두리(default-200)", () => {
  const hsl = (name) => {
    const m = css.match(new RegExp(`--heroui-${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
    assert.ok(m, `--heroui-${name} 없음`);
    const [h, s, l] = [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  const bg = hsl("content1");
  assert.ok(contrast(hsl("foreground"), bg) >= 7);
  assert.ok(contrast(hsl("default-500"), bg) >= 7, "text-default-500");
  assert.ok(contrast(hsl("default-400"), bg) >= 4.5, "text-default-400");
  assert.ok(contrast(hsl("default-200"), bg) >= 3, "border-default-200");
  assert.ok(contrast(hsl("divider"), bg) >= 3, "divider");
});

test("글자 크기: 13px 이상, 12px 는 대문자 모노 라벨만, 본문 15px·줄간격 1.5 안팎", () => {
  const LABEL_12 = [".fx-label", ".fx-hud-title", "[data-title]::before", ".fx-led-sym", ".fx-dash-spark-axis"];
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  let checked = 0;
  for (const [, sel, body] of rules) {
    const m = body.match(/font-size:\s*([\d.]+)(rem|px|em)/);
    if (!m) continue;
    checked += 1;
    const px = m[2] === "px" ? Number(m[1]) : m[2] === "rem" ? Number(m[1]) * 16 : null;
    if (px === null) continue;
    if (px >= 13) continue;
    assert.ok(px >= 12 && LABEL_12.some((l) => sel.includes(l)), `작은 글자 ${px}px: ${sel.trim()}`);
  }
  assert.ok(checked > 10);
  const root = css.slice(css.indexOf(".factory-ui {"), css.indexOf("}", css.indexOf(".factory-ui {")));
  assert.match(root, /font-size: 0\.9375rem;/);
  const lh = Number(root.match(/line-height: ([\d.]+);/)[1]);
  assert.ok(lh >= 1.45 && lh <= 1.65);
  // Tailwind·HeroUI 의 12px·11px 글자도 13px 로 올림
  assert.match(css, /\.factory-ui \.text-xs,\s*\.factory-ui \.text-tiny,[\s\S]*?font-size: 0\.8125rem/);
  assert.match(css, /--heroui-font-size-tiny: 0\.8125rem/);
});

test("장식 줄이기: 배경 눈금·글로우 없음, 각진 패널(모서리 4px 이하), 포커스 링 2px", () => {
  assert.doesNotMatch(css, /radial-gradient/);
  assert.doesNotMatch(css, /text-shadow/);
  assert.doesNotMatch(css, /drop-shadow/);
  for (const m of css.matchAll(/border-radius:\s*([\d.]+)(px|rem)/g)) {
    const px = m[2] === "px" ? Number(m[1]) : Number(m[1]) * 16;
    if (px >= 999) continue; // 상태 점 ● 은 동그랗게
    assert.ok(px <= 4, `둥근 모서리 ${m[0]}`);
  }
  assert.match(css, /outline: 2px solid var\(--fx-focus\)/);
});

test("상태 칩·줄 색 조합([현황]): 진행 중 채움 칩 ≥ 7:1, 승인/실패 칩 ≥ 4.5:1, 줄 배경 위 글자 ≥ 7:1", () => {
  for (const k of ["fx-st-run-ink", "fx-st-run-bar", "fx-st-run-wash", "fx-st-warn-wash", "fx-st-bad-wash"]) assert.match(t[k] ?? "", /^#[0-9a-f]{6}$/, `토큰 ${k} 없음`);
  assert.ok(contrast(t["fx-st-run-ink"], t["fx-accent"]) >= 7, `진행 중 칩 글자/채움 = ${contrast(t["fx-st-run-ink"], t["fx-accent"]).toFixed(2)}`);
  assert.ok(contrast(t["fx-warn"], t["fx-st-warn-wash"]) >= 4.5, "승인 필요 칩");
  assert.ok(contrast(t["fx-bad"], t["fx-st-bad-wash"]) >= 4.5, "실패 칩");
  for (const wash of ["fx-st-run-wash", "fx-st-warn-wash", "fx-st-bad-wash"]) {
    assert.ok(contrast(t["fx-text"], t[wash]) >= 7, `본문 / ${wash} = ${contrast(t["fx-text"], t[wash]).toFixed(2)}`);
    assert.ok(contrast(t["fx-muted"], t[wash]) >= 4.5, `보조 / ${wash} = ${contrast(t["fx-muted"], t[wash]).toFixed(2)}`);
  }
  assert.ok(contrast(t["fx-accent"], t["fx-st-run-wash"]) >= 4.5, "진행 중 줄 위 청록 글자");
  // 줄 왼쪽 막대(글자 아님)는 줄 배경과 3:1 이상
  assert.ok(contrast(t["fx-accent"], t["fx-st-run-wash"]) >= 3, "진행 중 막대");
  assert.ok(contrast(t["fx-bad"], t["fx-st-bad-wash"]) >= 3, "실패 막대");
  // 대기(점선·흐림)·취소 칩 글자는 패널 위에서 4.5:1
  for (const b of BACKS) {
    assert.ok(contrast(t["fx-dim"], t[b]) >= 4.5, `대기/취소 칩 / ${b}`);
    assert.ok(contrast(t["fx-ok"], t[b]) >= 4.5, `완료 칩 / ${b}`);
  }
  // 진행 중은 대기보다 확실히 눈에 띈다: 채움 색(청록)과 대기 글자(회색)의 대비가 큼
  assert.ok(contrast(t["fx-accent"], t["fx-panel"]) > contrast(t["fx-dim"], t["fx-panel"]) + 2, "진행 중이 대기보다 밝다");
});

test("상태 칩 CSS: 종류 7가지 클래스가 있고 움직임 줄이기에서 애니메이션이 꺼진다", () => {
  for (const k of ["run", "approval", "wait", "done", "fail", "cancel", "info"]) assert.ok(css.includes(`.fx-st-${k} `), `.fx-st-${k} 없음`);
  assert.match(css, /\.fx-row\[data-st="run"\][^{]*\{[^}]*border-left-width:\s*6px/);
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none\s*!important/);
});
