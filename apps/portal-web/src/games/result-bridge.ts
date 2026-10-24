import { gameOf, seedOf, type GameId } from './domain';
/** AD-7: guest-owned, bounded, same-device handoff; never a publish command. */
export const GAME_HANDOFF_KEY = 'freedom.absurd-daily.pending.v1';
export const GAME_HANDOFF_EVENT = 'freedom:game-result-ready';
export const HANDOFF_TTL = 24 * 60 * 60 * 1000;
export const MAX_IMAGE = 1200000;
export type GameDraft = {
    version: 1;
    createdAt: number;
    game: GameId;
    seed: number;
    title: string;
    text: string;
    image: string;
};
export type GameStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function parseGameDraft(raw: string | null, now = Date.now()): GameDraft | null {
    if (!raw || raw.length > MAX_IMAGE + 8000)
        return null;
    try {
        const x = JSON.parse(raw);
        if (!x || x.version !== 1 || !gameOf(x.game) || seedOf(x.seed) !== x.seed || !Number.isFinite(x.createdAt) || x.createdAt > now + 60000 || now - x.createdAt > HANDOFF_TTL || typeof x.title !== 'string' || !x.title.trim() || x.title.length > 100 || typeof x.text !== 'string' || x.text.length > 2000 || typeof x.image !== 'string' || x.image.length > MAX_IMAGE || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(x.image))
            return null;
        return { version: 1, createdAt: x.createdAt, game: x.game, seed: x.seed, title: x.title, text: x.text, image: x.image };
    }
    catch {
        return null;
    }
}
export function readGameDraft(storage: GameStorage, now = Date.now()): GameDraft | null { try {
    return parseGameDraft(storage.getItem(GAME_HANDOFF_KEY), now);
}
catch {
    return null;
} }
export function saveGameDraft(storage: GameStorage, draft: GameDraft, now = Date.now()) { const raw = JSON.stringify(draft); if (!parseGameDraft(raw, now))
    throw Error('這份成果無法帶入，請先下載圖片。'); storage.setItem(GAME_HANDOFF_KEY, raw); if (storage.getItem(GAME_HANDOFF_KEY) !== raw)
    throw Error('成果尚未保存，請重試或下載圖片。'); }
export function clearGameDraft(storage: GameStorage, createdAt: number) { const current = readGameDraft(storage); if (current?.createdAt === createdAt)
    storage.removeItem(GAME_HANDOFF_KEY); }
export function gameDraftFile(draft: GameDraft): File { const bytes = Uint8Array.from(atob(draft.image.slice(draft.image.indexOf(',') + 1)), c => c.charCodeAt(0)); return new File([bytes], `離譜日常-${draft.game}-${draft.seed}.jpg`, { type: 'image/jpeg' }); }
