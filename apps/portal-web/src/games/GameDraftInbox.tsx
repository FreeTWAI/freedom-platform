import { useCallback, useEffect, useState } from 'react';
import { clearGameDraft, GAME_HANDOFF_EVENT, readGameDraft, type GameDraft } from './result-bridge';
/** AD-7: survives login/onboarding in this tab; importing never publishes. */
export function useGameDraftInbox(sessionGeneration: number) {
    const [inbox, setInbox] = useState<{
        generation: number;
        value: GameDraft | null;
    } | null>(null);
    const draft = inbox?.generation === sessionGeneration ? inbox.value : null;
    const setDraft = useCallback((value: GameDraft | null) => setInbox({ generation: sessionGeneration, value }), [sessionGeneration]);
    useEffect(() => {
        const read = () => { let next: GameDraft | null = null; try {
            next = readGameDraft(sessionStorage);
        }
        catch { /* Browser storage can be unavailable. */ } setDraft(next); };
        read();
        window.addEventListener('pageshow', read);
        window.addEventListener(GAME_HANDOFF_EVENT, read);
        return () => { window.removeEventListener('pageshow', read); window.removeEventListener(GAME_HANDOFF_EVENT, read); };
    }, [sessionGeneration, setDraft]);
    const discard = useCallback(() => { if (draft) {
        try {
            clearGameDraft(sessionStorage, draft.createdAt);
        }
        catch { /* Keep the current editor untouched even if storage is denied. */ }
    } setDraft(null); }, [draft]);
    return { draft, setDraft, discard };
}
export function GameDraftNotice({ draft, busy, hasImage, tooLong, error, onImport, onDiscard }: {
    draft: GameDraft;
    busy: boolean;
    hasImage: boolean;
    tooLong: boolean;
    error: string;
    onImport: () => void;
    onDiscard: () => void;
}) {
    return <aside className="card stack" aria-label="剛才的遊戲成果">
    <strong>你剛才的離譜成果還在。</strong>
    <p>{draft.title}：圖片和文案已準備好，可以加入工坊貼文。</p>
    {hasImage ? <p className="field-hint">原草稿已有圖片，先完成或移除原圖，再帶入成果。你的草稿保持原樣。</p> : tooLong ? <p className="field-hint">加上成果會超過 2,000 字。先縮短原草稿，再帶入。</p> : <p className="field-hint">原草稿有文字時，成果會接在後面；由你確認發布。</p>}
    {error && <p role="alert">{error}</p>}
    <div className="messages-actions"><button type="button" className="btn btn-primary" disabled={busy || hasImage || tooLong} onClick={onImport}>{busy ? '正在準備圖片…' : '帶圖建立貼文'}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={onDiscard}>不帶入這份成果</button></div>
  </aside>;
}
