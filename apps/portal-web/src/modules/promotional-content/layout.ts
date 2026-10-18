// fitPromoText adapts TYPO Studio's MIT fitAndWrap loop. See SOURCES.md and licenses/.
import {PROMO_RATIOS, PromoError, parsePromoDocument, type PromoDocument, type PromoField} from './model';

export const PROMO_FONT = 'system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif';
export type MeasurePromoText = (text: string, size: number, weight: number) => number;
export type TextBlock = {
  field: PromoField; lines: string[]; size: number; weight: number;
  x: number; y: number; width: number; height: number; lineHeight: number;
};
const graphemes = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
const words = new Intl.Segmenter(undefined, {granularity: 'word'});
const closingPunctuation = /^[、。，．！？：；）］｝〉》」』】〕…,.!?;:)\]}]/u;

/** Wrap at word boundaries; split oversized words only between graphemes. */
export function wrapPromoText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const {segment} of words.segment(paragraph)) {
      const candidate = current + segment;
      if (measure(candidate.trimEnd()) <= width) {current = candidate; continue;}
      if (current && closingPunctuation.test(segment)) {
        const previous = Array.from(graphemes.segment(current.trimEnd()), value => value.segment);
        const last = previous.pop();
        if (last && previous.length && measure(last + segment) <= width) {
          lines.push(previous.join('')); current = last + segment; continue;
        }
      }
      if (current.trim()) {lines.push(current.trimEnd()); current = '';}
      if (!segment.trim()) continue;
      for (const {segment: character} of graphemes.segment(segment)) {
        if (measure(character) > width) throw new PromoError('overflow');
        if (current && measure(current + character) > width) {lines.push(current); current = '';}
        current += character;
      }
    }
    lines.push(current.trimEnd());
  }
  return lines;
}

export function fitPromoText(
  text: string, width: number, height: number, baseSize: number, minSize: number,
  lineHeight: number, weight: number, measure: MeasurePromoText, field: PromoField,
): Pick<TextBlock, 'lines' | 'size'> {
  if (!text) return {lines: [], size: baseSize};
  let size = baseSize;
  for (;;) {
    let lines: string[] | undefined;
    try {lines = wrapPromoText(text, width, line => measure(line, size, weight));}
    catch (cause) {if (!(cause instanceof PromoError) || cause.code !== 'overflow') throw cause;}
    if (lines && lines.length * size * lineHeight <= height) return {lines, size};
    if (size <= minSize) throw new PromoError('overflow', field);
    size = Math.max(minSize, Math.floor(size * 0.92));
  }
}

export function layoutPromoPage(input: PromoDocument, pageId: string, measure: MeasurePromoText) {
  const design = parsePromoDocument(input);
  const page = design.pages.find(item => item.id === pageId);
  if (!page) throw new PromoError('document');
  const [width, height] = PROMO_RATIOS[design.ratio];
  const margin = 80, textWidth = width - 2 * margin;
  const titleHeight = Math.round(height * 0.37);
  const bodyTop = 190 + titleHeight + 42, footerTop = height - 98;
  const definitions: Omit<TextBlock, 'lines' | 'size'>[] = [
    {field: 'label', weight: 650, x: margin, y: 66, width: textWidth - 90, height: 62, lineHeight: 1.35},
    {field: 'title', weight: 800, x: margin, y: 190, width: textWidth, height: titleHeight, lineHeight: 1.18},
    {field: 'body', weight: 400, x: margin, y: bodyTop, width: textWidth - 32, height: footerTop - bodyTop - 60, lineHeight: 1.55},
    {field: 'footer', weight: 600, x: margin, y: footerTop, width: textWidth - 90, height: 66, lineHeight: 1.4},
  ];
  const sizes: Record<PromoField, readonly [number, number]> = {
    label: [26, 22], title: [106, 52], body: [34, 24], footer: [23, 20],
  };
  const blocks = definitions.map(block => ({...block, ...fitPromoText(page[block.field], block.width, block.height,
    ...sizes[block.field], block.lineHeight, block.weight, measure, block.field)}));
  return {width, height, blocks, accent: design.accent, pageNumber: design.pages.indexOf(page) + 1, pageCount: design.pages.length};
}
