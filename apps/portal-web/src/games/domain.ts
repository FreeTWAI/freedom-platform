/** Canonical rules for AD-2..5. No renderer, browser, account or reward authority. */
export type GameId = 'photo' | 'stamp' | 'cash';
export const GAMES = [
    { id: 'photo', title: '這張能交嗎？', subtitle: '三位客人，沒有一位正常。', action: '開照相館', icon: '◎' },
    { id: 'stamp', title: '蓋完就下班', subtitle: '只有十二張。這次真的。', action: '拿起印章', icon: '▣' },
    { id: 'cash', title: '這疊有一百萬？', subtitle: '錢往右，大餅往左。', action: '開始盤點', icon: '▤' },
] as const;
export const RULES = { photoMs: 12000, film: 2, clients: 3, documents: 12, stampRadius: .24, stampCooldown: 220, cashCooldown: 160, swipePx: 48, maxMarks: 24, targetCash: 1000000, maxDpr: 1.5 } as const;
export const CLIENTS = [
    { id: 'backdrop', title: '背景板也要拍證件照', request: '請拍到客人的臉和雙腳，留意那塊很有主見的背景板。' },
    { id: 'umbrella', title: '雨傘是電梯', request: '客人跟整把傘都要入鏡。對，他正在往上。' },
    { id: 'pigeons', title: '三位，一件風衣', request: '等三隻鴿子一起探頭，拍一張真正的團體照。' },
] as const;
export type ClientId = typeof CLIENTS[number]['id'];
export type Point = {
    x: number;
    y: number;
};
export function seedOf(value: unknown): number {
    const n = typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : value;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 0xffffffff ? n : 20261023;
}
export function gameOf(value: unknown): GameId | null { return GAMES.some(g => g.id === value) ? value as GameId : null; }
export function random(seed: number) { let a = seedOf(seed); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function challengeUrl(origin: string, game: GameId, seed: number) { const url = new URL('/play', origin); url.search = new URLSearchParams({ game, seed: String(seedOf(seed)) }).toString(); return url.toString(); }
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
export function photoPose(client: ClientId, seconds: number, seed: number) {
    const t = clamp(seconds, 0, 12), phase = (seedOf(seed) % 7) * .07;
    return {
        lift: client === 'umbrella' ? Math.max(0, Math.sin(Math.min(Math.PI, (t + phase) * .31))) * 2.7 : 0,
        boardX: Math.sin(t * .9 + phase) * 2.35,
        birds: [0, 1, 2].map(i => t > 2.4 + i * .4 && t < 9.8 - i * .35 ? .18 + Math.max(0, Math.sin((t - i * .36) * 1.4)) * .15 : -.4),
        sway: Math.sin(t * 1.5) * .025,
    };
}
export type PhotoGrade = {
    stars: number;
    caption: string;
    details: string;
};
export function gradePhoto(client: ClientId, visible: readonly string[], seconds: number, blocked = false, lift = 0): PhotoGrade {
    const has = (id: string) => visible.includes(id), birds = ['bird0', 'bird1', 'bird2'].filter(has).length;
    if (client === 'pigeons')
        return { stars: birds, caption: birds === 3 ? '今天接待一位，交出三張鳥臉。' : birds ? '團體照拍好了，還有人在衣服裡。' : '看似正常的大衣，才是最大破綻。', details: `三位客人入鏡 ${birds} / 3` };
    if (client === 'backdrop' && blocked)
        return { stars: has('board') ? 1 : 0, caption: '背景出席，客人缺席。', details: '背景板擋在客人前面，還擺好了姿勢。' };
    const full = has('head') && has('feet'), umbrella = client === 'umbrella';
    const stars = Number(has('head')) + Number(has('feet')) + Number(umbrella ? has('umbrella') : has('head') && has('feet'));
    return { stars, caption: umbrella ? (full && has('umbrella') ? (lift > .6 ? '攝影完成，客人尚未降落。' : '姿勢擺好了，雨傘還沒發車。') : has('feet') && !has('head') ? (lift > .6 ? '拍到兩隻鞋。客人已升艙。' : '照片剩兩隻鞋，請客人補上半身。') : '傘有自己的上班路線。') : (full ? '客人終於戰勝了背景。' : '請問，這張可以拿去辦護照嗎？'), details: umbrella ? `客人 ${full ? '完整' : '未完整'}入鏡 · 傘頂 ${has('umbrella') ? '入鏡' : '出框'}` : `臉 ${has('head') ? '入鏡' : '出框'} · 雙腳 ${has('feet') ? '入鏡' : '出框'} · 第 ${Math.floor(seconds)} 秒` };
}
const DOCUMENTS = ['批准這個批准', '收到，但沒有要處理', '同意本次不同意', '申請延後今天的昨天', '這份公文需要一份公文', '主管目前正在找主管', '請先批准你的印章', '螃蟹收發室簽收單', '下班意願調查', '最後一張', '真的最後一張', '下班申請單・最後修正版'];
export function stampTarget(seed: number, index: number): Point { const rng = random(seedOf(seed) + Math.max(0, index) * 3571); return { x: (rng() - .5) * 1.35, y: (rng() - .5) * 1.12 }; }
export function documentTitle(index: number, practice = false) { return practice ? '不計時練習紙' : DOCUMENTS[Math.min(11, Math.max(0, index))]; }
export type StampMark = Point & {
    hit: boolean;
};
export type StampState = {
    seed: number;
    index: number;
    practice: boolean;
    misses: number;
    marks: StampMark[];
    lastAt: number;
    startedAt: number | null;
    endedAt: number | null;
};
export function newStamps(seed: number, practice = true): StampState { return { seed: seedOf(seed), index: 0, practice, misses: 0, marks: [], lastAt: -RULES.stampCooldown, startedAt: null, endedAt: null }; }
export function beginStamps(s: StampState, now: number): StampState { return !s.practice && s.startedAt === null && Number.isFinite(now) && now >= 0 ? { ...s, startedAt: now } : s; }
export function stamp(s: StampState, index: number, point: Point, now: number): {
    state: StampState;
    kind: 'hit' | 'miss' | 'practice' | 'ignored';
} {
    if (index !== (s.practice ? -1 : s.index) || s.endedAt !== null || !Number.isFinite(now) || now < 0 || now < s.lastAt + RULES.stampCooldown || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1.2 || Math.abs(point.y) > 1.2)
        return { state: s, kind: 'ignored' };
    const target = stampTarget(s.seed, s.index), hit = Math.hypot(point.x - target.x, point.y - target.y) <= RULES.stampRadius;
    if (hit && s.practice)
        return { state: { ...newStamps(s.seed, false), lastAt: now }, kind: 'practice' };
    const next = beginStamps(s, now), last = hit && s.index === RULES.documents - 1;
    return { state: { ...next, index: s.index + Number(hit), misses: s.misses + Number(!hit), marks: hit && !last ? [] : [...s.marks, { ...point, hit }].slice(-RULES.maxMarks), lastAt: now, endedAt: last ? now : null }, kind: hit ? 'hit' : 'miss' };
}
export const VOUCHERS = ['老闆畫的大餅', '一百萬個讚', '情緒價值無價', '欠你一頓飯', '金魚記憶卡', '長到地板的收據'] as const;
export type CashCard = {
    id: number;
    amount: number;
    label: string;
    valid: boolean;
};
export function cashDeck(seed: number): CashCard[] {
    const cards: CashCard[] = [];
    for (const [amount, count] of [[10000, 10], [50000, 10], [100000, 3]])
        for (let i = 0; i < count; i++)
            cards.push({ id: cards.length, amount, label: `${amount / 10000} 萬`, valid: true });
    VOUCHERS.forEach(label => cards.push({ id: cards.length, amount: 0, label, valid: false }));
    const rng = random(seed);
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return [...cards, { id: 29, amount: 100000, label: '10 萬', valid: true }];
}
export type CashState = {
    seed: number;
    index: number;
    amount: number;
    mistakes: number;
    rejected: number;
    lastAt: number;
    startedAt: number | null;
    endedAt: number | null;
    feedback: 'correct' | 'wrong' | null;
};
export function newCash(seed: number): CashState { return { seed: seedOf(seed), index: 0, amount: 0, mistakes: 0, rejected: 0, lastAt: -RULES.cashCooldown, startedAt: null, endedAt: null, feedback: null }; }
export function sortCash(s: CashState, index: number, accept: boolean, now: number): {
    state: CashState;
    kind: 'correct' | 'wrong' | 'ignored';
} {
    if (index !== s.index || s.endedAt !== null || !Number.isFinite(now) || now < 0 || now < s.lastAt + RULES.cashCooldown)
        return { state: s, kind: 'ignored' };
    const card = cashDeck(s.seed)[s.index];
    if (!card)
        return { state: s, kind: 'ignored' };
    if (accept !== card.valid)
        return { state: { ...s, startedAt: s.startedAt ?? now, mistakes: s.mistakes + 1, lastAt: now, feedback: 'wrong' }, kind: 'wrong' };
    return { state: { ...s, index: s.index + 1, amount: s.amount + card.amount, rejected: s.rejected + Number(!card.valid), startedAt: s.startedAt ?? now, lastAt: now, endedAt: s.index === 29 ? now : null, feedback: 'correct' }, kind: 'correct' };
}
export type RunClock = {
    elapsed: number;
    last: number | null;
    running: boolean;
};
export function tick(clock: RunClock, now: number): RunClock { if (!clock.running || !Number.isFinite(now) || now < 0 || (clock.last !== null && now < clock.last))
    return clock; return { running: true, last: now, elapsed: clock.elapsed + (clock.last === null ? 0 : Math.max(0, now - clock.last)) }; }
export function pause(clock: RunClock): RunClock { return { ...clock, running: false, last: null }; }
export function resume(clock: RunClock): RunClock { return { ...clock, running: true, last: null }; }
export function seconds(ms: number) { return (Math.max(0, ms) / 1000).toFixed(1); }
