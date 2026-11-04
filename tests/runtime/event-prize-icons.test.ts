import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createElement, Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildSync} from 'esbuild';
import {DEFAULT_EVENT_PRIZE_ICON_ID, EVENT_PRIZE_ICON_IDS, EVENT_PRIZE_ICONS, isEventPrizeIconId, type EventPrizeIconId} from '../../modules/community/event-prize-icons';

// Execute the real JSX graph. CSS is omitted by SSR, so these are not browser,
// keyboard, zoom, geometry, theme-contrast or assistive-technology acceptance tests.
const compiled = buildSync({
  stdin: {contents: "export {EventPrizeIcon} from './apps/portal-web/src/modules/EventPrizeIcon'; export {EventPrizeIconPicker} from './apps/portal-web/src/modules/EventPrizeIconPicker';", resolveDir: process.cwd(), loader: 'tsx'},
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: {'.css': 'empty'}, logLevel: 'silent',
}).outputFiles[0].text;
const entry = {exports: {} as {
  EventPrizeIcon: typeof import('../../apps/portal-web/src/modules/EventPrizeIcon').EventPrizeIcon;
  EventPrizeIconPicker: typeof import('../../apps/portal-web/src/modules/EventPrizeIconPicker').EventPrizeIconPicker;
}};
new Function('require', 'module', 'exports', compiled)(createRequire(import.meta.url), entry, entry.exports);
const {EventPrizeIcon, EventPrizeIconPicker} = entry.exports;
const renderPicker = (value: EventPrizeIconId = DEFAULT_EVENT_PRIZE_ICON_ID, disabled = false) => renderToStaticMarkup(createElement(EventPrizeIconPicker, {value, disabled, onChange: () => assert.fail('render must not mutate or save')}));

test('presentation catalog has six stable, unique, immutable IDs and visible labels', () => {
  assert.deepEqual(EVENT_PRIZE_ICON_IDS, ['gift', 'trophy', 'medal', 'book', 'ticket', 'voucher']);
  assert.deepEqual(EVENT_PRIZE_ICONS.map(icon => icon.id), EVENT_PRIZE_ICON_IDS);
  assert.deepEqual(EVENT_PRIZE_ICONS.map(icon => icon.label), ['禮物', '獎盃', '獎牌', '書本', '入場券', '禮券']);
  assert.equal(DEFAULT_EVENT_PRIZE_ICON_ID, 'gift');
  assert.ok(Object.isFrozen(EVENT_PRIZE_ICON_IDS));
  assert.ok(Object.isFrozen(EVENT_PRIZE_ICONS));
  for (const icon of EVENT_PRIZE_ICONS) assert.ok(Object.isFrozen(icon));
});

test('allowlist rejects URLs, markup, inherited keys, nonstrings and noncanonical IDs', () => {
  for (const id of EVENT_PRIZE_ICON_IDS) assert.ok(isEventPrizeIconId(id));
  for (const value of [null, undefined, 0, true, {}, ['gift'], new String('gift'), 'Gift', ' gift', 'gift ', '', '__proto__', 'constructor', 'https://example.invalid/a.svg', '<svg onload="alert(1)">', 'gift\u0000']) {
    assert.equal(isEventPrizeIconId(value), false);
  }
});

test('each illustration is distinct local decorative SVG with no executable or remote content', () => {
  const rendered = EVENT_PRIZE_ICON_IDS.map(iconId => renderToStaticMarkup(createElement(EventPrizeIcon, {iconId})));
  assert.equal(new Set(rendered).size, 6);
  for (const html of rendered) {
    assert.match(html, /^<svg /);
    assert.match(html, /width="48" height="48" viewBox="0 0 48 48"/);
    assert.match(html, /aria-hidden="true" focusable="false"/);
    assert.match(html, /stroke="currentColor"/);
    assert.doesNotMatch(html, /(?:href=|src=|<image\b|<script\b|<foreignObject\b|<title\b|https?:|data:|onload=)/i);
  }
  for (const iconId of ['unknown', 'https://example.invalid/a.svg', null, '__proto__']) {
    assert.equal(renderToStaticMarkup(createElement(EventPrizeIcon, {iconId: iconId as EventPrizeIconId})), '');
  }
});

test('picker renders native grouped radios with visible labels, hint and exact controlled selection', () => {
  for (const value of EVENT_PRIZE_ICON_IDS) {
    const html = renderPicker(value);
    assert.match(html, /^<fieldset[^>]*aria-describedby="[^"]+"/);
    assert.match(html, /<legend>選擇獎品插圖<\/legend>/);
    assert.match(html, /內建插圖僅供示意，不是獎品實拍照片。/);
    const inputs = html.match(/<input\b[^>]*>/g) ?? [];
    assert.equal(inputs.length, 6);
    assert.ok(inputs.every(input => input.includes('type="radio"')));
    assert.equal(new Set(inputs.map(input => input.match(/name="([^"]+)"/)?.[1])).size, 1);
    const checked = inputs.filter(input => input.includes('checked=""'));
    assert.equal(checked.length, 1);
    assert.ok(checked[0].includes(`value="${value}"`));
    for (const input of inputs) {
      const id = input.match(/id="([^"]+)"/)?.[1];
      assert.ok(id);
      assert.ok(html.includes(`for="${id}"`));
    }
    for (const icon of EVENT_PRIZE_ICONS) assert.ok(html.includes(`<span>${icon.label}</span>`));
    assert.doesNotMatch(html, /(?:role="radio"|tabindex=|<button|<select|已儲存|已發放)/i);
  }
});

test('disabled picker disables its fieldset and every radio; invalid value has no false checked default', () => {
  const html = renderPicker('book', true);
  assert.match(html, /^<fieldset[^>]*disabled=""/);
  const inputs = html.match(/<input\b[^>]*>/g) ?? [];
  assert.equal(inputs.filter(input => input.includes('disabled=""')).length, 6);
  assert.doesNotMatch(renderPicker('corrupt' as EventPrizeIconId), /checked=""/);
});

test('multiple prize pickers keep independent names, input IDs, hint IDs and escaped legends', () => {
  const html = renderToStaticMarkup(createElement(Fragment, null,
    createElement(EventPrizeIconPicker, {value: 'book', legend: '獎品 1 插圖', onChange: () => {}}),
    createElement(EventPrizeIconPicker, {value: 'ticket', legend: '獎品 2 <script>插圖', onChange: () => {}}),
  ));
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 14);
  assert.equal(new Set(ids).size, 14);
  const names = [...html.matchAll(/\bname="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(names).size, 2);
  assert.equal(names.filter(name => name === names[0]).length, 6);
  for (const [, hint] of html.matchAll(/aria-describedby="([^"]+)"/g)) assert.ok(ids.includes(hint));
  assert.match(html, /獎品 1 插圖/);
  assert.match(html, /獎品 2 &lt;script&gt;插圖/);
  assert.doesNotMatch(html, /<script>/);
});

test('picker source preserves native interaction, scoped theme tokens and minimum target/text rules', () => {
  const source = readFileSync('apps/portal-web/src/modules/EventPrizeIconPicker.tsx', 'utf8');
  const css = readFileSync('apps/portal-web/src/modules/EventPrizeIconPicker.css', 'utf8');
  assert.match(source, /if \(!disabled && event\.currentTarget\.checked\) onChange\(icon\.id\)/);
  assert.doesNotMatch(source, /(?:onKeyDown|preventDefault|fetch\(|localStorage|dangerouslySetInnerHTML)/);
  for (const token of ['--ink', '--bg-elev', '--muted', '--line', '--focus']) assert.ok(css.includes(`var(${token})`));
  assert.match(css, /min-height: 44px/);
  assert.match(css, /font-size: 1rem/);
  assert.match(css, /input:focus-visible/);
  assert.match(css, /input:checked/);
  assert.match(css, /input:disabled/);
  assert.doesNotMatch(css, /(?:url\(|#[\da-f]{3,8}\b|:root|display:\s*none)/i);
});
