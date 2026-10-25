import { type GameId } from './domain';
export type ArcadeGameId = GameId | 'kitchen';
export type RunResult = {
    game: ArcadeGameId;
    recipe?: string;
    seed: number;
    title: string;
    caption: string;
    details: string;
    image: string;
    photos?: {
        image: string;
        stars: number;
        caption: string;
        details: string;
    }[];
};
function imageOf(src: string): Promise<HTMLImageElement> { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(Error('成果照片未能讀取，請重新選取。')); image.src = src; }); }
function contain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) { const s = Math.min(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s; ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); }
function lines(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number) { let line = '', row = 0; for (const ch of text) {
    if (ch === '\n' || ctx.measureText(line + ch).width > width) {
        ctx.fillText(line, x, y + row++ * lineHeight);
        line = ch === '\n' ? '' : ch;
    }
    else
        line += ch;
} ctx.fillText(line, x, y + row * lineHeight); return y + (row + 1) * lineHeight; }
function blobOf(canvas: HTMLCanvasElement) { return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('圖片未能產生，請重試。')), 'image/png')); }
/** AD-7: preserve the complete 4:3 image in both export compositions. */
export async function resultExports(result: RunResult, logo?: HTMLImageElement | null) {
    const img = await imageOf(result.image), portrait = document.createElement('canvas'), site = document.createElement('canvas');
    portrait.width = 960;
    portrait.height = 1200;
    site.width = 1200;
    site.height = 675;
    for (const [canvas, wide] of [[portrait, false], [site, true]] as const) {
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw Error('此瀏覽器無法產生圖片。');
        ctx.fillStyle = '#fff5e5';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#e4cdb5';
        for (let y = 10; y < canvas.height; y += 18)
            for (let x = 10; x < canvas.width; x += 18)
                ctx.fillRect(x, y, 1, 1);
        ctx.strokeStyle = '#49362f';
        ctx.lineWidth = 3;
        ctx.strokeRect(23, 23, canvas.width - 46, canvas.height - 46);
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#a34438';
        ctx.font = 'bold 23px monospace';
        ctx.fillText(result.game === 'kitchen' ? 'FREE TWAI / LITTLE RECIPE BOOK' : 'ODD JOBS / DAILY NONSENSE', 48, wide ? 43 : 48);
        if (logo?.complete && logo.naturalWidth)
            contain(ctx, logo, wide ? 1090 : 798, wide ? 35 : 38, 70, 54);
        ctx.fillStyle = '#49362f';
        ctx.font = `900 ${wide ? 42 : 59}px sans-serif`;
        lines(ctx, result.title, wide ? 751 : 48, wide ? 129 : 103, wide ? 397 : 852, wide ? 48 : 65);
        const x = wide ? 43 : 40, y = wide ? 119 : 195, w = wide ? 660 : 880, h = wide ? 495 : 660;
        ctx.fillStyle = '#dfc7ac';
        ctx.fillRect(x + 7, y + 9, w, h);
        ctx.fillStyle = '#fffaf0';
        ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
        contain(ctx, img, x, y, w, h);
        ctx.strokeStyle = '#49362f';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 5, y - 5, w + 10, h + 10);
        ctx.fillStyle = '#49362f';
        ctx.font = `900 ${wide ? 32 : 42}px sans-serif`;
        const after = lines(ctx, result.caption, wide ? 751 : 48, wide ? 214 : 890, wide ? 397 : 852, wide ? 46 : 57);
        ctx.fillStyle = '#796354';
        ctx.font = `${wide ? 25 : 27}px sans-serif`;
        lines(ctx, result.details, wide ? 751 : 48, Math.max(after + 18, wide ? 398 : 1030), wide ? 395 : 852, wide ? 38 : 40);
        ctx.fillStyle = '#a94430';
        ctx.fillRect(wide ? 751 : 48, wide ? 557 : 1133, wide ? 395 : 852, wide ? 47 : 39);
        ctx.fillStyle = '#fffaf0';
        ctx.font = `bold ${wide ? 23 : 24}px sans-serif`;
        ctx.fillText(`同題 #${result.seed}　換你試試看`, wide ? 765 : 63, wide ? 568 : 1140);
    }
    const png = await blobOf(portrait);
    return { png, file: new File([png], `離譜日常-${result.game}-${result.seed}.png`, { type: 'image/png' }), site: site.toDataURL('image/jpeg', .87), preview: portrait.toDataURL('image/jpeg', .85) };
}
