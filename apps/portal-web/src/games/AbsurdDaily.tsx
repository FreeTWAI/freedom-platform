import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { beginStamps, cashDeck, challengeUrl, clamp, CLIENTS, documentTitle, gameOf, GAMES, gradePhoto, newCash, newStamps, pause, resume, RULES, seconds, seedOf, sortCash, stamp, stampTarget, tick, type CashState, type GameId, type Point, type RunClock, type StampState } from './domain';
import { saveGameDraft } from './result-bridge';
import { resultExports, type RunResult, type ArcadeGameId } from './result-card';
import { ResultShare } from './ResultShare';
import {marketOf,readMarket} from './cooking/market-domain';
import type {MarketRun} from './cooking/market-domain';
import {MarketScore} from './cooking/MarketScore';
import {DishShowcase} from './cooking/DishShowcase';
import { gameShareText } from './result-share';
import type { Stage, StageView } from './stage';
import {syncDiagnostics} from './diagnostics';
import './arcade.css';
import './toy-theme.css';
import './illustration-theme.css';
import './toy-console.css';
import { ArcadeLobby, type LobbyState } from './cooking/ArcadeLobby';
import { RECIPES, recipeOf, type Recipe } from './cooking/catalog';
import { emptyCookbook, readCookbook, readCookingRun, updateCookbook, COOKBOOK_KEY, type Cookbook, type CookingStorage } from './cooking/storage';
import type { CookingRun } from './cooking/domain';
import {PARTY_GAMES,partyOf,type PartyGameId} from './party/catalog';
type PartyComponent = typeof import('./party/PartyGame')['PartyGame'];
function PartyLoader(props:Parameters<PartyComponent>[0]) {
    const [Game,setGame]=useState<PartyComponent|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
    useEffect(()=>{let current=true;setError('');const timeout=setTimeout(()=>{if(current){current=false;setError('派對入口載入較久，可以重試。');}},15000);void import('./party/PartyGame').then(module=>{if(current){clearTimeout(timeout);setGame(()=>module.PartyGame);}}).catch(()=>{if(current){clearTimeout(timeout);setError('派對入口未能載入，請重試。');}});return()=>{current=false;clearTimeout(timeout);};},[attempt]);
    return Game?<Game {...props}/>:<div className="ck-empty"><p role={error?'alert':'status'}>{error||'派對準備中…'}</p>{error&&<button onClick={()=>setAttempt(n=>n+1)}>重試派對入口</button>}<button className="ad-secondary" onClick={props.onBack}>回遊戲大廳</button></div>;
}
type CookingComponent = typeof import('./cooking/CookingGame')['CookingGame'];
type MarketComponent=typeof import('./cooking/MarketGame')['MarketGame'];
function MarketLoader(props:Parameters<MarketComponent>[0]) {
 const [Game,setGame]=useState<MarketComponent|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let current=true;setError('');const timeout=setTimeout(()=>{if(current){current=false;setError('料理入口載入較久，請重試。');}},15000);void import('./cooking/MarketGame').then(m=>{if(current){clearTimeout(timeout);setGame(()=>m.MarketGame);}}).catch(()=>{if(current){clearTimeout(timeout);setError('料理入口未能載入。');}});return()=>{current=false;clearTimeout(timeout);};},[attempt]);
 return Game?<Game {...props}/>:<div className="ck-empty"><p role={error?'alert':'status'}>{error||'正在開攤…'}</p>{error&&<button onClick={()=>setAttempt(n=>n+1)}>重試開攤</button>}<button className="ad-secondary" onClick={props.onBack}>回遊戲大廳</button></div>;
}
function CookingLoader(props:Parameters<CookingComponent>[0]) {
    const [Game,setGame]=useState<CookingComponent|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
    useEffect(()=>{let current=true;setError('');const timeout=setTimeout(()=>{if(current){current=false;setError('料理手帳載入較久。請重試，這一盤的進度會保留。');}},15000);void import('./cooking/CookingGame').then(module=>{if(current){clearTimeout(timeout);setGame(()=>module.CookingGame);}}).catch(()=>{if(current){clearTimeout(timeout);setError('料理手帳未能載入，請重試。');}});return()=>{current=false;clearTimeout(timeout);};},[attempt]);
    return Game?<Game {...props}/>:<div className="ck-empty"><p role={error?'alert':'status'}>{error||'正在打開料理手帳…'}</p>{error&&<button onClick={()=>setAttempt(n=>n+1)}>重試料理手帳</button>}<button className="ad-secondary" onClick={props.onBack}>回遊戲大廳</button></div>;
}
const localBook:CookingStorage={getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v),removeItem:k=>localStorage.removeItem(k)};
const tabBook:CookingStorage={getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v),removeItem:k=>sessionStorage.removeItem(k)};
type Photo = NonNullable<RunResult['photos']>[number];
type Pointer = {
    id: number;
    x: number;
    y: number;
    pan: Point;
    index: number;
};
type Live = {
    game: GameId;
    seed: number;
    clock: RunClock;
    client: number;
    roundAt: number;
    film: number;
    photos: Photo[];
    pan: Point;
    targetPan: Point;
    fov: number;
    stamps: StampState;
    cash: CashState;
    stampPoint: Point;
    raised: boolean;
    pointer: Pointer | null;
    done: boolean;
    started: boolean;
    paused: boolean;
};
const hints = { photo: '拖曳取景，抓到怪事再按快門。方向鍵也能移鏡。', stamp: '按住拖到藍圈，放手蓋章。也可以直接點藍圈。', cash: '道具鈔往右滑，怪票券往左滑。左右方向鍵也可以。' };
function freshSeed() { const value = new Uint32Array(1); crypto.getRandomValues(value); return seedOf(value[0]); }
function initialGame():ArcadeGameId|null { const q=new URLSearchParams(location.search); return q.get('game')==='kitchen'&&recipeOf(q.get('recipe'))?'kitchen':partyOf(q.get('game'))??gameOf(q.get('game')); }
function GameBoard({ game, seed, onBack, onResult }: {
    game: GameId;
    seed: number;
    onBack: () => void;
    onResult: (result: RunResult) => void;
}) {
    const host = useRef<HTMLDivElement>(null), section = useRef<HTMLElement>(null), stage = useRef<Stage | null>(null), frame = useRef(0), generation = useRef(0), loop = useRef<(time: number) => void>(() => { }), audio = useRef<AudioContext | null>(null), soundRef = useRef(false), motionRef = useRef(!matchMedia('(prefers-reduced-motion: reduce)').matches);
    const live = useRef<Live>({ game, seed, clock: { elapsed: 0, last: null, running: false }, client: 0, roundAt: 0, film: 0, photos: [], pan: { x: 0, y: 0 }, targetPan: { x: 0, y: 0 }, fov: 44, stamps: newStamps(seed), cash: newCash(seed), stampPoint: stampTarget(seed, 0), raised: false, pointer: null, done: false, started: false, paused: false });
    const [, repaint] = useState(0), [ready, setReady] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0), [notice, setNotice] = useState(''), [sound, setSound] = useState(false), [flash, setFlash] = useState(0);
    const pendingResult = useRef<Omit<RunResult, 'image'> | null>(null), [captureError, setCaptureError] = useState(false);
    const updateUi = () => repaint(n => n + 1), lastUi = useRef(0);
    const view = (): StageView => { const l = live.current; return { game, seed, seconds: game === 'photo' ? (l.clock.elapsed - l.roundAt) / 1000 : l.clock.elapsed / 1000, client: l.client, pan: l.pan, fov: l.fov, stamp: l.stamps, stampPoint: l.stampPoint, raised: l.raised, cash: l.cash, motion: motionRef.current }; };
    function draw() { stage.current?.update(view()); if (stage.current && host.current) {
        const stats = stage.current.stats();
        syncDiagnostics(host.current,{renderCalls:stats.calls,renderTriangles:stats.triangles,renderTextures:stats.textures});
    } }
    function render(){try{draw();return true;}catch{stop();live.current.paused=true;setReady(false);setError('3D 畫面暫時中斷。按重試恢復這一局。');void audio.current?.suspend().catch(()=>{});updateUi();return false;}}
    function sfx(kind: 'photo' | 'stamp' | 'cash' | 'wrong') {
        if (!soundRef.current)
            return;
        try {
            const ctx = audio.current ?? (audio.current = new AudioContext());
            void ctx.resume().catch(() => { });
            const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime;
            osc.type = kind === 'stamp' ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(kind === 'photo' ? 900 : kind === 'stamp' ? 140 : kind === 'wrong' ? 130 : 600, t);
            osc.frequency.exponentialRampToValueAtTime(kind === 'wrong' ? 70 : kind === 'photo' ? 120 : kind === 'stamp' ? 45 : 950, t + .085);
            gain.gain.setValueAtTime(.075, t);
            gain.gain.exponentialRampToValueAtTime(.001, t + .09);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + .1);
        }
        catch { /* Sound is optional; it never blocks an accepted action. */ }
    }
    function stop() { cancelAnimationFrame(frame.current); frame.current = 0; live.current.clock = pause(live.current.clock); live.current.pointer = null; live.current.raised = false; }
    function finish(result: RunResult) { if (live.current.done)
        return; live.current.done = true; stop(); onResult(result); }
    function settle(summary: Omit<RunResult, 'image'>) { stop(); pendingResult.current = summary; try {
        if(!render())throw Error('Scene unavailable');
        if (!stage.current)
            throw Error('Scene unavailable');
        finish({ ...summary, image: stage.current.capture() });
    }
    catch {
        setCaptureError(true);
        setNotice('這局已完成，成果畫面還沒保存。請重試產生圖片，完成次數不會重算。');
        updateUi();
    } }
    function photosDone() { const l = live.current; if (!l.photos.length) {
        l.started = false;
        l.clock = { elapsed: 0, last: null, running: false };
        l.client = 0;
        l.roundAt = 0;
        setNotice('這局還沒拍到照片。再開一次照相館，按快門留下怪事。');
        updateUi();
        return;
    } const best = l.photos.reduce((a, b) => a.stars >= b.stars ? a : b); finish({ game, seed, title: GAMES[0].title, caption: best.caption, details: best.details, image: best.image, photos: l.photos }); }
    function syncClock() { live.current.clock = tick(live.current.clock, performance.now()); }
    function nextClient() { syncClock(); const l = live.current; if (l.done)
        return; if (l.client === 2) {
        photosDone();
        return;
    } l.client++; l.roundAt = l.clock.elapsed; l.film = 0; l.pointer = null; l.pan = { x: 0, y: 0 }; l.targetPan = { x: 0, y: 0 }; l.fov = 44; setNotice(CLIENTS[l.client].title); render(); updateUi(); }
    function shoot() {
        syncClock();
        const l = live.current;
        if (!ready || !l.started || l.paused || l.done || l.film >= RULES.film || !stage.current)
            return;
        try {
            if(!render())return;
            const { visible, blocked, lift } = stage.current.framing(), grade = gradePhoto(CLIENTS[l.client].id, visible, (l.clock.elapsed - l.roundAt) / 1000, blocked, lift), image = stage.current.capture();
            l.photos.push({ ...grade, image });
            l.film++;
            sfx('photo');
            setNotice(`${grade.caption} ${grade.details}`);
            if (motionRef.current)
                setFlash(n => n + 1);
            updateUi();
        }
        catch (cause) {
            setNotice(cause instanceof Error ? cause.message : '這張未能保存，請重試。');
        }
    }
    function applyStamp(point: Point, index = live.current.stamps.practice ? -1 : live.current.stamps.index) { syncClock(); const l = live.current; if (!l.started || l.paused || l.done)
        return; const outcome = stamp(l.stamps, index, point, l.clock.elapsed); if (outcome.kind === 'ignored')
        return; l.stamps = outcome.state; l.raised = false; l.stampPoint = point; sfx(outcome.kind === 'miss' ? 'wrong' : 'stamp'); setNotice(outcome.kind === 'practice' ? '練習完成。十二張正式公文，開始！' : outcome.kind === 'hit' ? '啪！已閱，但看不懂。' : '章歪了。墨跡留下，這張再蓋一次。'); render(); updateUi(); if (l.stamps.endedAt !== null) {
        const elapsed = l.stamps.endedAt - (l.stamps.startedAt ?? l.stamps.endedAt);
        settle({ game, seed, title: GAMES[1].title, caption: l.stamps.misses ? '主管：印象深刻，文件也是。' : '主管：下班可以，先批准你的下班。', details: `完成 12 份文件 · ${seconds(elapsed)} 秒 · 多蓋 ${l.stamps.misses} 次` });
    } }
    function applyCash(accept: boolean, index = live.current.cash.index) { syncClock(); const l = live.current; if (!l.started || l.paused || l.done)
        return; const outcome = sortCash(l.cash, index, accept, l.clock.elapsed); if (outcome.kind === 'ignored')
        return; l.cash = outcome.state; sfx(outcome.kind === 'wrong' ? 'wrong' : 'cash'); setNotice(outcome.kind === 'wrong' ? '這張分錯了，退回來重新看看。' : accept ? '道具鈔收到。財富看起來很有希望。' : '這張不是錢，老闆先收回去。'); render(); updateUi(); if (l.cash.endedAt !== null) {
        const elapsed = l.cash.endedAt - (l.cash.startedAt ?? l.cash.endedAt);
        settle({ game, seed, title: GAMES[2].title, caption: '數完一百萬，還收到了老闆畫的大餅。', details: `100 萬道具鈔 · 退回 ${l.cash.rejected} 張票券 · ${seconds(elapsed)} 秒 · 分錯 ${l.cash.mistakes} 次` });
    } }
    loop.current = (now: number) => { const l = live.current; if (!stage.current || l.done || !l.clock.running || l.paused)
        return; const before = l.clock.elapsed; l.clock = tick(l.clock, now); const blend = 1 - Math.exp(-20 * Math.min(.05, (l.clock.elapsed - before) / 1000)); l.pan = { x: l.pan.x + (l.targetPan.x - l.pan.x) * blend, y: l.pan.y + (l.targetPan.y - l.pan.y) * blend }; try {
        render();
    }
    catch {
        stop();
        l.paused = true;
        void audio.current?.suspend().catch(() => { });
        setReady(false);
        setError('3D 畫面暫時中斷。按重試恢復這一局。');
        return;
    } if (game === 'photo' && l.clock.elapsed - l.roundAt >= RULES.photoMs)
        nextClient(); if (now - lastUi.current > 100) {
        lastUi.current = now;
        updateUi();
    } if (!l.done && l.clock.running)
        frame.current = requestAnimationFrame(loop.current); };
    function start() { if (!ready)
        return; const l = live.current; l.started = true; l.paused = false; l.clock = { ...resume(l.clock), last: performance.now() }; cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(loop.current); section.current?.focus({ preventScroll: true });section.current?.querySelector('.ad-play-layout')?.scrollIntoView({block:'start',behavior:'instant'}); setNotice(game === 'photo' ? '底片只有兩張。漂亮的、離譜的，都能留下。' : hints[game]); updateUi(); }
    function setPaused() { const l = live.current; if (!l.started || l.done)
        return; stop(); l.paused = true; void audio.current?.suspend().catch(() => { }); updateUi(); }
    useEffect(() => { const change = () => { motionRef.current = !matchMedia('(prefers-reduced-motion: reduce)').matches; render(); }; const media = matchMedia('(prefers-reduced-motion: reduce)'); media.addEventListener('change', change); const hidden = () => { if (document.hidden)
        setPaused(); }; const blur = () => setPaused(); document.addEventListener('visibilitychange', hidden); window.addEventListener('blur', blur); return () => { media.removeEventListener('change', change); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', blur); }; }, []);
    useEffect(() => {
        const current = ++generation.current;
        let mounted = true, owned: Stage | null = null;
        setReady(false);
        setError('');
        const timeout = window.setTimeout(() => { if (mounted && generation.current === current) {
            generation.current++;
            setError('遊戲場景載入較久。請重試，或回遊樂場。');
        } }, 15000);
        void import('./stage').then(module => { if (!mounted || generation.current !== current)
            return; try {
            owned = module.createStage(host.current!, () => { if (!mounted)
                return; stop(); live.current.paused = true; setReady(false); setError('3D 畫面暫時中斷。按重試恢復這一局。'); });
            stage.current = owned;
            owned.update(view());
            clearTimeout(timeout);
            setReady(true);
        }
        catch {
            owned?.dispose();
            stage.current = null;
            clearTimeout(timeout);
            setError('此瀏覽器暫時無法開啟 3D 場景。可重試，或改用支援 WebGL 2 的瀏覽器。');
        } }).catch(() => { if (mounted && generation.current === current) {
            clearTimeout(timeout);
            setError('遊戲素材未能載入。請重試。');
        } });
        return () => { mounted = false; generation.current++; clearTimeout(timeout); stop(); owned?.dispose(); stage.current = null; };
    }, [retry]);
    useEffect(() => () => { void audio.current?.close().catch(() => { }); }, []);
    function pan(dx: number, dy: number) { const l = live.current; l.targetPan = { x: clamp(l.targetPan.x + dx, -1.8, 1.8), y: clamp(l.targetPan.y + dy, -2.8, 2.8) }; }
    function keyboard(event: KeyboardEvent) { if ((event.target as HTMLElement).closest('input,textarea,select,button,a') || event.altKey || event.metaKey || event.ctrlKey || !live.current.started || live.current.paused)
        return; const l = live.current, key = event.key; if (key === 'Escape') {
        event.preventDefault();
        setPaused();
        return;
    } if (game === 'photo') {
        if (key.startsWith('Arrow')) {
            event.preventDefault();
            pan(key === 'ArrowRight' ? .25 : key === 'ArrowLeft' ? -.25 : 0, key === 'ArrowUp' ? .25 : key === 'ArrowDown' ? -.25 : 0);
        }
        if ((key === ' ' || key === 'Enter') && !event.repeat) {
            event.preventDefault();
            shoot();
        }
    }
    else if (game === 'cash' && (key === 'ArrowLeft' || key === 'ArrowRight') && !event.repeat) {
        event.preventDefault();
        applyCash(key === 'ArrowRight');
    }
    else if (game === 'stamp') {
        if (key.startsWith('Arrow')) {
            event.preventDefault();
            l.stampPoint = { x: clamp(l.stampPoint.x + (key === 'ArrowRight' ? .06 : key === 'ArrowLeft' ? -.06 : 0), -1.1, 1.1), y: clamp(l.stampPoint.y + (key === 'ArrowDown' ? .06 : key === 'ArrowUp' ? -.06 : 0), -1.1, 1.1) };
            render();
        }
        if ((key === ' ' || key === 'Enter') && !event.repeat) {
            event.preventDefault();
            applyStamp(l.stampPoint);
        }
    } }
    function pointerDown(event: PointerEvent) { syncClock(); const l = live.current; if (!ready || !l.started || l.paused || l.done || l.pointer || pendingResult.current || event.button!==0 || !event.isPrimary)
        return; event.preventDefault(); l.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: { ...l.targetPan }, index: game === 'cash' ? l.cash.index : l.stamps.practice ? -1 : l.stamps.index }; event.currentTarget.setPointerCapture(event.pointerId); if (game === 'stamp') {
        l.stamps = beginStamps(l.stamps, l.clock.elapsed);
        const p = stage.current?.point(event.clientX, event.clientY);
        if (p)
            l.stampPoint = p;
        l.raised = true;
        render();
    } }
    function pointerMove(event: PointerEvent) { const l = live.current, p = l.pointer; if (!p || p.id !== event.pointerId)
        return; if (game === 'photo') {
        const rect = event.currentTarget.getBoundingClientRect();
        l.targetPan = { x: clamp(p.pan.x - (event.clientX - p.x) / rect.width * 4.8, -1.8, 1.8), y: clamp(p.pan.y + (event.clientY - p.y) / rect.height * 4.8, -2.8, 2.8) };
    }
    else if (game === 'stamp') {
        const point = stage.current?.point(event.clientX, event.clientY);
        if (point)
            l.stampPoint = point;
        render();
    } }
    function pointerUp(event: PointerEvent) { const l = live.current, p = l.pointer; if (!p || p.id !== event.pointerId)
        return; l.pointer = null; l.raised = false; if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId); if (game === 'stamp') {
        const point = stage.current?.point(event.clientX, event.clientY);
        if (point)
            applyStamp(point, p.index);
    }
    else if (game === 'cash') {
        const dx = event.clientX - p.x;
        if (Math.abs(dx) >= RULES.swipePx)
            applyCash(dx > 0, p.index);
        else
            setNotice('往右滑收鈔，往左滑退票券。也能用下方按鈕。');
    } }
    const l = live.current, remaining = Math.max(0, RULES.photoMs - (l.clock.elapsed - l.roundAt)), cashCard = cashDeck(seed)[Math.min(l.cash.index, 29)];
    return <section ref={section} className="ad-board" data-playing={l.started&&!l.paused} tabIndex={-1} onKeyDown={keyboard} aria-label={GAMES.find(g => g.id === game)!.title}>
    <div className="ad-toolbar"><button className="ad-secondary" onClick={onBack}>← 遊樂場</button><span className="ad-seed">同題 #{seed}</span><button className="ad-secondary" aria-pressed={sound} onClick={() => { soundRef.current = !sound; setSound(!sound); if (!sound)
        sfx(game); }}>聲音 {sound ? '開' : '關'}</button>{l.started && !l.paused && <button className="ad-secondary" onClick={setPaused}>暫停</button>}</div>
    <div className="ad-game-title"><div><h1>{GAMES.find(g => g.id === game)!.title}</h1><p>{game === 'photo' ? CLIENTS[l.client].title : game === 'stamp' ? documentTitle(Math.min(l.stamps.index, 11), l.stamps.practice) : '收鈔往右，票券往左'}</p></div><output className="ad-counter" aria-live="off">{game === 'photo' ? `${l.client + 1}/3 · ${Math.ceil(remaining / 1000)} 秒` : game === 'stamp' ? l.stamps.practice ? '練習中' : `${Math.min(l.stamps.index, 12)}/12` : `${l.cash.amount / 10000} / 100 萬`}</output></div>
    <div className="ad-play-layout"><div className="ad-stage-wrap"><div className="ad-stage" ref={host} data-game-stage={ready ? 'ready' : 'loading'} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={e => {if(l.pointer?.id===e.pointerId){l.pointer = null;l.raised = false;render();}}} onLostPointerCapture={e => {if(l.pointer?.id===e.pointerId){l.pointer = null;l.raised = false;}}}/>
      {game === 'photo' && ready && l.started && <div className="ad-viewfinder" aria-hidden="true"><i /><i /><i /><i /><span>FREE TWAI　●　LIVE</span></div>}
      {flash > 0 && motionRef.current && <div key={flash} className="ad-flash" aria-hidden="true"/>}
      {(!ready || !l.started || l.paused) && <div className="ad-stage-cover">{error ? <><p role="alert">{error}</p><button onClick={() => setRetry(n => n + 1)}>重試場景</button></> : !ready ? <p role="status">正在佈置現場…</p> : <><strong>{l.paused ? '休息一下，怪事等你。' : GAMES.find(g => g.id === game)!.subtitle}</strong><p>{hints[game]}</p><button onClick={start}>{l.paused ? '繼續這一局' : game === 'stamp' ? '先蓋一張練習紙' : '開始這一局'}</button></>}</div>}
    </div><div className="ad-controls"><p className="ad-instruction">{game === 'photo' ? CLIENTS[l.client].request : game === 'cash' ? `目前這張：${cashCard.label}。僅供遊戲使用。` : l.stamps.practice ? '先蓋中藍圈一次，不計時。' : '蓋中藍圈才算。印章歪了可以重蓋。'}</p>
      {captureError && <button disabled={!ready} onClick={() => { if (pendingResult.current)
        settle(pendingResult.current); }}>重試產生成果圖片</button>}
      <div className="ad-action-area" inert={!ready || !l.started || l.paused || captureError}>
      {game === 'photo' ? <><div className="ad-pan-pad" aria-label="移動鏡頭"><button aria-label="鏡頭往左" onClick={() => pan(-.35, 0)}>←</button><button aria-label="鏡頭往上" onClick={() => pan(0, .35)}>↑</button><button aria-label="鏡頭往下" onClick={() => pan(0, -.35)}>↓</button><button aria-label="鏡頭往右" onClick={() => pan(.35, 0)}>→</button></div><label className="ad-zoom"><span>廣角</span><input aria-label="鏡頭廣角" type="range" min="38" max="60" value={l.fov} onChange={e => { l.fov = Number(e.target.value); updateUi(); }}/><span>更廣</span></label><button className="ad-shutter" disabled={l.film >= RULES.film} onClick={shoot} aria-label="拍照快門"><span aria-hidden="true">◎</span><small>快門 · {2 - l.film} 張</small></button><button className="ad-secondary" onClick={nextClient}>{l.client === 2 ? '挑選照片' : '下一位客人 →'}</button></> : game === 'stamp' ? <><button className="ad-stamp-button" onPointerDown={() => { l.stamps = beginStamps(l.stamps, l.clock.elapsed); }} onClick={() => applyStamp(l.stampPoint)}>啪！蓋章</button><p className="ad-meta">方向鍵微調印章 · 空白鍵落印<br />多蓋 {l.stamps.misses} 次</p></> : <><div className="ad-sort-buttons"><button className="ad-secondary" onClick={() => applyCash(false)}>← 退票券</button><button onClick={() => applyCash(true)}>收道具鈔 →</button></div><p className="ad-meta">已分類 {l.cash.index} / 30 · 分錯 {l.cash.mistakes} 次<br />最後一張剛好湊滿一百萬。</p></>}
      </div><p className="ad-notice" role="status">{notice || hints[game]}</p>{game === 'photo' && l.photos.length > 0 && <div className="ad-contact-sheet" aria-label="這局拍到的照片">{l.photos.map((p, i) => <img key={i} src={p.image} alt={`底片 ${i + 1}：${p.caption}`} width="96" height="72"/>)}</div>}
    </div></div>
  </section>;
}
function Result({ result, onBack, onReplay, onNext }: {
    result: RunResult;
    onBack: () => void;
    onReplay: () => void;
    onNext: () => void;
}) {
    const [photoIndex, setPhotoIndex] = useState(() => result.photos?.findIndex(p => p.image === result.image) ?? -1), [selected, setSelected] = useState(result), [exports, setExports] = useState<Awaited<ReturnType<typeof resultExports>> | null>(null), [objectUrl, setObjectUrl] = useState(''), [status, setStatus] = useState(''), [manualLink, setManualLink] = useState(false), [generation, setGeneration] = useState(0), [sharing, setSharing] = useState(false), linkRef = useRef<HTMLInputElement>(null);
    const link = result.game === 'kitchen' || partyOf(result.game) ? new URL(`/play?${new URLSearchParams({game:result.game,...(result.recipe?{recipe:result.recipe}:{}),...(result.cookingMode==='guided'?{practice:'1'}:{}),seed:String(result.seed)})}`,location.origin).toString() : challengeUrl(location.origin, gameOf(result.game)!, result.seed);
    const text = gameShareText(selected,link), shareOwner = useRef(0), sharingRef = useRef(false);
    useEffect(() => { let current = true; shareOwner.current++; sharingRef.current=false;setSharing(false);setExports(null); setStatus('正在整理成果圖…'); const logo = document.querySelector<HTMLImageElement>('.ad-brand img'); void resultExports(selected, logo).then(value => { if (current) {
        setExports(value);
        setStatus('成果圖好了。選一個方式，把這份作品帶走。');
    } }).catch(() => { if (current)
        setStatus('成果圖未能產生，請按重試。'); }); return () => { current = false; shareOwner.current++; }; }, [selected, generation]);
    useEffect(() => { if (!exports) {
        setObjectUrl('');
        return;
    } const url = URL.createObjectURL(exports.png); setObjectUrl(url); return () => URL.revokeObjectURL(url); }, [exports]);
    useEffect(() => { if (manualLink) {
        linkRef.current?.focus();
        linkRef.current?.select();
    } }, [manualLink]);
    async function share() { if (!exports || sharingRef.current)
        return; const owner=shareOwner.current;sharingRef.current=true;setSharing(true); try {
        const payload = navigator.canShare?.({ files: [exports.file] }) ? { files: [exports.file], title: selected.title, text } : { title: selected.title, text: `${selected.caption}\n${selected.details}`, url: link };
        if (!navigator.share) {
            setManualLink(true);
            setStatus('這個瀏覽器沒有系統分享選單。可下載圖片，或複製同題連結。');
            return;
        }
        await navigator.share(payload);
        if(owner===shareOwner.current)setStatus('已交給系統分享選單。');
    }
    catch (cause) {
        if(owner!==shareOwner.current)return;
        if (cause instanceof Error && cause.name === 'AbortError')
            setStatus('已取消分享，成果仍在這裡。');
        else {
            setStatus('系統分享未完成。可下載圖片，或複製同題連結。');
            setManualLink(true);
        }
    }
    finally {
        if(owner===shareOwner.current){sharingRef.current=false;setSharing(false);}
    } }
    async function copy() { try {
        await navigator.clipboard.writeText(link);
        setStatus('同題連結已複製。這個連結分享題目，成果圖請另外附上。');
    }
    catch {
        setManualLink(true);
        setStatus('請長按或選取下方連結複製。');
    } }
    function workshop() { if (!exports)
        return; try {
        saveGameDraft(sessionStorage, { version: 1, createdAt: Date.now(), game: result.game, ...(result.recipe ? {recipe:result.recipe} : {}), seed: result.seed, title: selected.title, text, image: exports.site });
        location.assign('/?game-share=1#home');
    }
    catch {
        setStatus('成果還沒保存，請重試「發到自由工坊」，或先下載圖片。');
    } }
    return <section className={`ad-result ${result.market?'ad-market-result':''}`}><div className="ad-result-heading"><p className="ad-eyebrow">{result.game === 'kitchen' ? '本日料理手帳' : '本日離譜成果'}</p><h1>{result.game==='kitchen'?selected.title:selected.caption}</h1>{result.game==='kitchen'?!result.market&&<p aria-label="料理分數">{selected.caption}</p>:<p>{selected.details}</p>}</div><div className="ad-result-layout"><div className="ad-result-photo">{result.game==='kitchen'&&recipeOf(result.recipe)&&<DishShowcase recipe={recipeOf(result.recipe)!} market={result.market}/>}{result.game==='kitchen'?<details className="ck-export-preview"><summary>查看分享成果圖</summary><img src={exports?.preview??selected.image} alt={`${selected.title}・完整分享成果圖`} width="960" height="1200"/></details>:<img src={selected.image} alt={`${selected.title}・本局遊戲畫面與成績`} width="960" height="720"/>}{!!result.photos?.length && <div className="ad-photo-choices" aria-label="選一張成果照片">{result.photos.map((p, i) => <button key={i} className={photoIndex === i ? 'is-selected' : ''} aria-pressed={photoIndex === i} onClick={() => { setPhotoIndex(i); setSelected({ ...result, ...p }); }}><img src={p.image} alt=""/><span>底片 {i + 1} · 委託 {p.stars}/3</span></button>)}</div>}</div><div className="ad-share-panel">{result.market&&<MarketScore run={result.market}/>}<h2>{result.game === 'kitchen' ? '把你的拿手菜，端給大家看。' : '這次怪事，值得留一張。'}</h2><p>可以直接發到工坊，也能把圖片和同題挑戰傳給朋友。</p><button disabled={!exports} onClick={workshop}>發到自由工坊</button><small>圖片與文案帶進預覽，由你確認發布。登入後會接回這張。</small><button className="ad-secondary" disabled={!exports || sharing} onClick={() => void share()}>系統分享圖片／連結</button>{objectUrl ? <a className="ad-button ad-secondary" href={objectUrl} download={`${result.game==='kitchen'?'料理手帳':'離譜日常'}-${result.game}-${result.seed}.png`}>下載完整成果 PNG</a> : <button className="ad-secondary" onClick={() => setGeneration(n => n + 1)}>重試產生成果圖</button>}<button className="ad-secondary" onClick={() => void copy()}>複製同題挑戰連結</button><ResultShare key={photoIndex} link={link} text={text} ready={!!exports} sharing={sharing} onNative={()=>void share()} onStatus={setStatus}/><p className="ad-notice" role="status">{status}</p>{manualLink && <label className="ad-link-field">同題連結<input ref={linkRef} readOnly value={link} onFocus={e => e.currentTarget.select()}/></label>}<div className="ad-result-again"><button onClick={onReplay}>同一題再來一次</button><button className="ad-secondary" onClick={onNext}>{result.game==='kitchen'?'換一道料理 →':'換個玩法 →'}</button><button className="ad-secondary" onClick={onBack}>回遊樂場</button></div><p className="ad-meta">這是個人遊戲成果，不是貢獻值、信任分數或現金收益。</p></div></div></section>;
}
export function AbsurdDaily() {
    const [game,setGame]=useState<ArcadeGameId|null>(initialGame),[recipe,setRecipe]=useState(()=>recipeOf(new URLSearchParams(location.search).get('recipe'))),[seed,setSeed]=useState(()=>seedOf(new URLSearchParams(location.search).get('seed'))),[result,setResult]=useState<RunResult|null>(null),[run,setRun]=useState(0),[fresh,setFresh]=useState(false);
    const [book,setBook]=useState<Cookbook>(()=>readCookbook(localBook).book??emptyCookbook()),[saveNotice,setSaveNotice]=useState(()=>readCookbook(localBook).notice),[bookFailed,setBookFailed]=useState(()=>!readCookbook(localBook).available);
    const main=useRef<HTMLElement>(null),returnPoint=useRef<{top:number;key:string}|null>(null),restoreLobby=useRef(false);
    const bookRef=useRef(book), bookDirty=useRef(bookFailed);bookRef.current=book;
    const [lobby,setLobby]=useState<LobbyState>({category:'all',query:'',filter:'all',limit:8,collection:'all'});
    const changeBook=(change:Parameters<typeof updateCookbook>[2])=>{const saved=updateCookbook(localBook,bookRef.current,change,Date.now(),bookDirty.current);bookRef.current=saved.book;bookDirty.current=!saved.available;setBook(saved.book);setSaveNotice(saved.notice);setBookFailed(!saved.available);};
    const choose=useCallback((next:ArcadeGameId|null,keepSeed=false,dish:Recipe|null=null,origin='')=>{if(game===null&&next)returnPoint.current={top:window.scrollY,key:origin};restoreLobby.current=next===null;const checkpoint=dish&&!keepSeed?readCookingRun(tabBook).run:null,marketCheckpoint=dish&&!keepSeed?readMarket(tabBook):null,nextSeed=keepSeed?seed:marketCheckpoint&&dish&&marketCheckpoint.recipe===dish.id?marketCheckpoint.seed:checkpoint&&dish&&checkpoint.recipeId===dish.id?checkpoint.seed:freshSeed();setGame(next);setRecipe(dish);setSeed(nextSeed);setFresh(keepSeed);setResult(null);setRun(n=>n+1);const url=new URL(location.href);url.pathname='/play';url.search=next?new URLSearchParams({game:next,...(dish?{recipe:dish.id}:{}),seed:String(nextSeed),...(keepSeed&&new URLSearchParams(location.search).get('practice')==='1'?{practice:'1'}:{})}).toString():'';url.hash='';history.pushState(null,'',url);},[game,seed]);
    useLayoutEffect(()=>{if(!game&&restoreLobby.current){restoreLobby.current=false;const point=returnPoint.current;if(point){const card=[...document.querySelectorAll<HTMLElement>('[data-arcade-open]')].find(e=>e.dataset.arcadeOpen===point.key);card?.focus({preventScroll:true});window.scrollTo({top:point.top,behavior:'instant'});return;}}main.current?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});},[game,run,result]);
    const nextGame=()=>{if(game==='kitchen'&&recipe){const next=RECIPES[(RECIPES.findIndex(r=>r.id===recipe.id)+1)%RECIPES.length];choose('kitchen',false,next);}else{const choices=[...GAMES,...PARTY_GAMES];choose(choices[(choices.findIndex(g=>g.id===game)+1)%choices.length].id);}};
    useEffect(()=>{document.title='遊戲大廳 · 自由工坊';const previousScroll=history.scrollRestoration;history.scrollRestoration='manual';const back=()=>{restoreLobby.current=initialGame()===null;setGame(initialGame());setRecipe(recipeOf(new URLSearchParams(location.search).get('recipe')));setSeed(seedOf(new URLSearchParams(location.search).get('seed')));setFresh(false);setResult(null);setRun(n=>n+1);};const changed=(event:StorageEvent)=>{if(event.key===COOKBOOK_KEY&&!bookDirty.current){const saved=readCookbook(localBook);bookRef.current=saved.book;setBook(saved.book);setSaveNotice(saved.notice);}};window.addEventListener('popstate',back);window.addEventListener('storage',changed);return()=>{history.scrollRestoration=previousScroll;window.removeEventListener('popstate',back);window.removeEventListener('storage',changed);};},[]);
    const invalid=new URLSearchParams(location.search).get('game')==='kitchen'&&!game;
    const partyGame:PartyGameId|null=partyOf(game);
    return <div className="ad-root ad-toy-console"><a className="ad-skip" href="#ad-main">跳到遊戲內容</a><header className="ad-header"><a className="ad-brand" href="/"><img src="/brand/freedom-workshop.webp" alt="自由工坊" width="72" height="40"/><span>遊戲大廳</span></a><a className="ad-home-link" href="/">回自由工坊 ↗</a></header><main id="ad-main" ref={main} tabIndex={-1}>
      {saveNotice&&<div className="ck-save-warning" role="status"><p>{saveNotice}</p>{bookFailed&&<button className="ad-secondary" onClick={()=>changeBook({kind:'retry'})}>重試保存食譜本</button>}</div>}
      {result?<Result result={result} onBack={()=>choose(null)} onReplay={()=>choose(game,true,recipe)} onNext={nextGame}/>:game==='kitchen'&&recipe&&marketOf(recipe.id)&&new URLSearchParams(location.search).get('practice')!=='1'?<MarketLoader key={`${recipe.id}/${run}`} recipe={recipe} seed={seed} fresh={fresh} onBack={()=>choose(null)} onResult={setResult} onComplete={(completed:MarketRun)=>changeBook({kind:'market-complete',run:completed})}/>:game==='kitchen'&&recipe?<CookingLoader key={`${recipe.id}/${run}`} recipe={recipe} seed={seed} fresh={fresh} onBack={()=>choose(null)} onResult={setResult} onComplete={(completed:CookingRun)=>changeBook({kind:'complete',run:completed})}/>:partyGame?<PartyLoader key={`${partyGame}/${run}`} game={partyGame} seed={seed} onBack={()=>choose(null)} onResult={setResult}/>:game&&game!=='kitchen'?<GameBoard key={`${game}/${run}`} game={gameOf(game)!} seed={seed} onBack={()=>choose(null)} onResult={setResult}/>:<ArcadeLobby state={lobby} onState={setLobby} book={book} onFavorite={id=>changeBook({kind:'favorite',id})} onGame={(g,key)=>choose(g,false,null,key)} onRecipe={(r,key)=>choose('kitchen',false,r,key)} notice={invalid?'這道料理連結無法辨識，請從食譜本選一道。':''}/>}
    </main><footer className="ad-footer">自由工坊原創遊戲 · 作品由你確認後分享</footer></div>;
}
