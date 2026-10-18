import {PROMO_FONT, layoutPromoPage} from './layout';
import {PROMO_RATIOS, PromoError, parsePromoDocument, promoFingerprint, type PromoDocument} from './model';

export type PromoPng = {blob: Blob; width: number; height: number; sourceFingerprint: string};

async function readyFonts(design: PromoDocument) {
  if (!document.fonts) throw new PromoError('fonts');
  const sample = design.pages.map(page => page.label + page.title + page.body + page.footer).join('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([400, 600, 650, 800].map(weight => document.fonts.load(weight + ' 34px ' + PROMO_FONT, sample))),
      new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new PromoError('fonts')), 8000);}),
    ]);
  } catch {throw new PromoError('fonts');}
  finally {clearTimeout(timer);}
}

/** Browser-only PNG. No requests, upload, storage, native bridge or font provider. */
export async function renderPromoPng(input: unknown, pageId: string): Promise<PromoPng> {
  const design = parsePromoDocument(input);
  await readyFonts(design);
  const canvas = document.createElement('canvas');
  const [width, height] = PROMO_RATIOS[design.ratio];
  canvas.width = width; canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PromoError('canvas');
    const layout = layoutPromoPage(design, pageId, (text, size, weight) => {
      ctx.font = weight + ' ' + size + 'px ' + PROMO_FONT;
      return ctx.measureText(text).width;
    });
    ctx.fillStyle = '#f6f5ef'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = layout.accent; ctx.fillRect(0, 0, width, 12);
    ctx.globalAlpha = 0.08; ctx.beginPath(); ctx.arc(width - 24, 220, 195, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#171b24'; ctx.fillRect(80, 145, width - 160, 2); ctx.fillRect(80, height - 126, width - 160, 2);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    for (const block of layout.blocks) {
      ctx.font = block.weight + ' ' + block.size + 'px ' + PROMO_FONT;
      // Accent is decorative; all user text retains contrast on the paper background.
      ctx.fillStyle = '#171b24';
      block.lines.forEach((line, index) => ctx.fillText(line, block.x, block.y + index * block.size * block.lineHeight));
    }
    ctx.fillStyle = layout.accent; ctx.fillRect(width - 124, 70, 44, 44);
    ctx.fillStyle = '#171b24'; ctx.font = '600 22px ' + PROMO_FONT; ctx.textAlign = 'right';
    ctx.fillText(String(layout.pageNumber).padStart(2, '0'), width - 80, height - 98);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      value => value?.type === 'image/png' && value.size > 0 ? resolve(value) : reject(new PromoError('encode')), 'image/png'));
    return {blob, width, height, sourceFingerprint: await promoFingerprint(design)};
  } finally {canvas.width = 0; canvas.height = 0;}
}
