import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialPromoDocument, parsePromoDocument, promoDocumentKey, promoFingerprint, PromoError} from '../../apps/portal-web/src/modules/promotional-content/model.js';
import {fitPromoText, layoutPromoPage, wrapPromoText} from '../../apps/portal-web/src/modules/promotional-content/layout.js';
import {promoMessages, promoText} from '../../apps/portal-web/src/modules/promotional-content/messages.js';

test('PROMO-01 document parsing detaches content and normalizes line endings without truncating', () => {
  const original = initialPromoDocument();
  original.pages[0].body = '第一行\r\n第二行\r第三行 🧑🏽‍🎨';
  const parsed = parsePromoDocument(original);
  assert.equal(parsed.pages[0].body, '第一行\n第二行\n第三行 🧑🏽‍🎨');
  original.pages[0].title = 'later mutation';
  assert.notEqual(parsed.pages[0].title, original.pages[0].title);
});

test('PROMO-02 reject URLs, authority fields, unsupported ratios and schema versions', () => {
  for (const ratio of ['1:1', '4:5'] as const) {
    assert.equal(parsePromoDocument({...initialPromoDocument(), ratio}).ratio, ratio);
  }
  for (const patch of [{ownerId: 'another-member'}, {assetUrl: 'file:///private'}, {schemaVersion: 2},
    {ratio: '9:16'}, {ratio: 'toString'}, {ratio: ['1:1']}, {ratio: ['4:5']},
    {ratio: null}, {ratio: 1}, {accent: 'url(https://example.invalid)'}]) {
    assert.throws(() => parsePromoDocument({...initialPromoDocument(), ...patch}), PromoError);
  }
});

test('PROMO-03 reject duplicate or excessive pages and invalid text instead of silently changing it', () => {
  const original = initialPromoDocument();
  assert.throws(() => parsePromoDocument({...original, pages: [original.pages[0], original.pages[0]]}), PromoError);
  assert.throws(() => parsePromoDocument({...original, pages: []}), PromoError);
  assert.throws(() => parsePromoDocument({...original, pages: Array.from({length: 11}, (_, index) =>
    ({...original.pages[0], id: 'page-' + index}))}), PromoError);
  for (const title of ['', '  ', '\u0000secret', '\ud800', '字'.repeat(121)]) {
    assert.throws(() => parsePromoDocument({...original, pages: [{...original.pages[0], title}]}), PromoError);
  }
  assert.throws(() => parsePromoDocument({...original, pages: [{...original.pages[0], source: '/private.png'}]}), PromoError);
});

test('PROMO-04 wrapping keeps explicit blank lines, words and emoji graphemes', () => {
  const measure = (line: string) => Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(line)).length;
  assert.deepEqual(wrapPromoText('one two\n\n三四', 7, measure), ['one two', '', '三四']);
  const emoji = '👩‍👩‍👧‍👦';
  assert.deepEqual(wrapPromoText(emoji.repeat(3), 1, measure), [emoji, emoji, emoji]);
  const lines = wrapPromoText('一二三，四五六。', 3, measure);
  assert.equal(lines.join(''), '一二三，四五六。');
  assert.ok(lines.every(line => measure(line) <= 3 && !/^[，。]/u.test(line)));
});

test('PROMO-05 adapt font size and reject overflow with its field, never drop remaining lines', () => {
  const measure = (line: string, size: number) => line.length * size;
  const fitted = fitPromoText('AB', 50, 100, 80, 20, 1.2, 700, measure, 'title');
  assert.ok(fitted.size < 80);
  assert.equal(fitted.lines.join(''), 'AB');
  assert.throws(() => fitPromoText('A\n'.repeat(80), 100, 50, 40, 20, 1.2, 700, measure, 'body'),
    (cause: unknown) => cause instanceof PromoError && cause.code === 'overflow' && cause.field === 'body');
});

test('PROMO-06 both aspect ratios lay out full text inside the output bounds', () => {
  for (const ratio of ['1:1', '4:5'] as const) {
    const design = {...initialPromoDocument(), ratio};
    const layout = layoutPromoPage(design, 'page-1', (line, size) => [...line].length * size * 0.7);
    assert.equal(layout.width, 1080);
    assert.equal(layout.height, ratio === '1:1' ? 1080 : 1350);
    for (const block of layout.blocks) {
      assert.ok(block.y + block.lines.length * block.size * block.lineHeight <= layout.height);
      assert.ok(block.lines.every(line => [...line].length * block.size * 0.7 <= block.width));
    }
  }
});

test('PROMO-07 exact content and ratio are bound to export fingerprints', async () => {
  const design = initialPromoDocument();
  const first = await promoFingerprint(design);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(await promoFingerprint({...design, accent: design.accent.toUpperCase()}), first);
  assert.equal(promoDocumentKey(design), promoDocumentKey({...design, pages: design.pages.map(page => ({...page}))}));
  assert.notEqual(await promoFingerprint({...design, ratio: '1:1'}), first);
  assert.notEqual(await promoFingerprint({...design, pages: [{...design.pages[0], title: '新的內容'}]}), first);
});

test('PROMO-08 all five interface languages include errors and preserve input placeholders', () => {
  for (const messages of Object.values(promoMessages)) {
    assert.equal(messages.length, 5);
    assert.ok(messages.every(message => message.trim().length > 0));
  }
  assert.equal(promoText('en', 'overflow', {field: 'Headline'}), 'Headline does not fit. Shorten the text or use fewer line breaks.');
  assert.match(promoText('ja', 'overflow', {field: '見出し'}), /見出し/);
});
