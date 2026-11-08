import {MemberGameUpload} from './MemberGameUpload';
import { flushSync } from 'react-dom';
import { FullscreenGame, type FullscreenGameHandle } from './FullscreenGame';
import {GameCover} from './GameCover';
import {CommunityGameSubmission} from './CommunityGameSubmission';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type MouseEvent, type ReactNode } from 'react';
import { beginStamps, cashDeck, challengeUrl, clamp, CLIENTS, documentTitle, gameOf, GAMES, gradePhoto, newCash, newStamps, pause, resume, RULES, seconds, seedOf, sortCash, stamp, stampTarget, tick, type CashState, type GameId, type Point, type RunClock, type StampState } from './domain';
import { cashNotice, photoNotice, stampNotice } from './daily-feedback';
import {holidayInput} from './party/light-holiday';
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
import './shotengai.css';
import './daily-scene.css';
import './cooking/immersive-kitchen.css';
import './cooking/market.css';
import './daily-photo.css';
import './daily-stamp.css';
import { ArcadeLobby, type LobbyState } from './cooking/ArcadeLobby';
import { RECIPES, recipeOf, type Recipe } from './cooking/catalog';
import { emptyCookbook, readCookbook, readCookingRun, updateCookbook, COOKBOOK_KEY, type Cookbook, type CookingStorage } from './cooking/storage';
import type { CookingRun } from './cooking/domain';
import {PARTY_GAMES,partyOf,type PartyGameId} from './party/catalog';
type PartyComponent = typeof import('./party/PartyGame')['PartyGame'];
function PartyLoader(props:Parameters<PartyComponent>[0]) {
    const [Game,setGame]=useState<PartyComponent|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
    useEffect(()=>{let current=true;setError('');const timeout=setTimeout(()=>{if(current){current=false;setError('派對入口載入較久，可以重試。');}},15000);void import('./party/PartyGame').then(module=>{if(current){clearTimeout(timeout);setGame(()=>module.PartyGame);}}).catch(()=>{if(current){clearTimeout(timeout);setError('派對入口未能載入，請重試。');}});return()=>{current=false;clearTimeout(timeout);};},[attempt]);
    return Game?<Game {...props}/>:<div className="ck-empty"><p role={error?'alert':'status'}>{error||'派對準備中…'}</p>{error&&<button onClick={()=>setAttempt(n=>n+1)}>重試派對入口</button>}<button className="fw-arcade-secondary" onClick={props.onBack}>回遊戲大廳</button></div>;
}
type CookingComponent = typeof import('./cooking/CookingGame')['CookingGame'];
type MarketComponent=typeof import('./cooking/MarketGame')['MarketGame'];
function MarketLoader(props:Parameters<MarketComponent>[0]) {
 const [Game,setGame]=useState<MarketComponent|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let current=true;setError('');const timeout=setTimeout(()=>{if(current){current=false;setError('料理入口載入較久，請重試。');}},15000);void import('./cooking/MarketGame').then(m=>{if(current){clearTimeout(timeout);setGame(()=>m.MarketGame);}}).catch(()=>{if(current){clearTimeout(timeout);setError('料理入口未能載入。');}});return()=>{current=false;clearTimeout(timeout);};},[attempt]);
 return Game?<Game {...props}/>:<div className="ck-empty">{props.bookNotice}<p role={error?'alert':'status'}>{error||'正在開攤…'}</p>{error&&<button onClick={()=>setAttempt(n=>n+1)}>重試開攤</button>}<button className="fw-arcade-secondary" onClick={props.onBack}>回遊戲大廳</button></div>;
}
function CookingLoader(props:Parameters<CookingComponent>[0]) {
    const [Game,setGame]=useState<CookingComponent|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
    useEffect(()=>{let current=true;setError('');const timeout=setTimeout(()=>{if(current){current=false;setError('料理手帳載入較久。請重試，這一盤的進度會保留。');}},15000);void import('./cooking/CookingGame').then(module=>{if(current){clearTimeout(timeout);setGame(()=>module.CookingGame);}}).catch(()=>{if(current){clearTimeout(timeout);setError('料理手帳未能載入，請重試。');}});return()=>{current=false;clearTimeout(timeout);};},[attempt]);
    return Game?<Game {...props}/>:<div className="ck-empty"><p role={error?'alert':'status'}>{error||'正在打開料理手帳…'}</p>{error&&<button onClick={()=>setAttempt(n=>n+1)}>重試料理手帳</button>}<button className="fw-arcade-secondary" onClick={props.onBack}>回遊戲大廳</button></div>;
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
    owner?: Element;
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
    cashDrag: Point;
    stampFeedback?: { point: Point; hit: boolean; at: number };
    done: boolean;
    started: boolean;
    paused: boolean;
};
const hints = { photo: '拖曳取景，抓到怪事再按快門。方向鍵也能移鏡。', stamp: '按住拖到藍圈，放手蓋章。也可以直接點藍圈。', cash: '道具鈔往右滑，怪票券往左滑。左右方向鍵也可以。' };
function freshSeed() { const value = new Uint32Array(1); crypto.getRandomValues(value); return seedOf(value[0]); }
function initialGame():ArcadeGameId|null { const q=new URLSearchParams(location.search); return q.get('game')==='kitchen'&&recipeOf(q.get('recipe'))?'kitchen':partyOf(q.get('game'))??gameOf(q.get('game')); }
function GameBoard({ game, seed, onBack, onResult, onStart }: {
    game: GameId;
    seed: number;
    onBack: () => void;
    onResult: (result: RunResult) => void;
    onStart: (focusTarget: HTMLElement | null) => void;
}) {
    const host = useRef<HTMLDivElement>(null), section = useRef<HTMLElement>(null), stage = useRef<Stage | null>(null), frame = useRef(0), generation = useRef(0), loop = useRef<(time: number) => void>(() => { }), audio = useRef<AudioContext | null>(null), soundRef = useRef(false), motionRef = useRef(!matchMedia('(prefers-reduced-motion: reduce)').matches);
    const initialLive = (): Live => ({ game, seed, clock: { elapsed: 0, last: null, running: false }, client: 0, roundAt: 0, film: 0, photos: [], pan: { x: 0, y: 0 }, targetPan: { x: 0, y: 0 }, fov: 44, stamps: newStamps(seed), cash: newCash(seed), stampPoint: stampTarget(seed, 0), raised: false, pointer: null, cashDrag: {x:0,y:0}, done: false, started: false, paused: false });
    const live = useRef<Live>(initialLive());
    const [, repaint] = useState(0), [ready, setReady] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0), [notice, setNotice] = useState(''), [sound, setSound] = useState(false), [flash, setFlash] = useState(0);
    const pendingResult = useRef<Omit<RunResult, 'image'> | null>(null), [captureError, setCaptureError] = useState(false);
    const captureFailures = useRef(0);
    const [renderer, setRenderer] = useState<'native'|'light'>('native'), [rendererNotice, setRendererNotice] = useState('');
    const rendererRef = useRef(renderer); rendererRef.current = renderer;
    const sceneFailure = () => `${rendererRef.current === 'light' ? '輕量' : '3D '}畫面暫時中斷。按重試恢復這一局。`;
    const [dialog, setDialog] = useState<'help'|'restart'|'photos'|null>(null), dialogRef = useRef<HTMLDialogElement>(null), dialogReturn = useRef<HTMLElement|null>(null), focusAfterCommit = useRef(false);
    const controls=useRef(holidayInput()), escapeCapture=useRef<()=>void>(()=>{});
    escapeCapture.current=()=>{controls.current.cancel();const p=live.current.pointer;live.current.pointer=null;live.current.raised=false;live.current.cashDrag={x:0,y:0};if(p?.owner?.hasPointerCapture(p.id))p.owner.releasePointerCapture(p.id);};
    const updateUi = () => repaint(n => n + 1), lastUi = useRef(0);
    const view = (): StageView => { const l = live.current; return { game, seed, seconds: game === 'photo' ? (l.clock.elapsed - l.roundAt) / 1000 : l.clock.elapsed / 1000, client: l.client, pan: l.pan, fov: l.fov, stamp: l.stamps, stampPoint: l.stampPoint, raised: l.raised, cash: l.cash, cashDrag: l.cashDrag, stampFeedback: l.stampFeedback, motion: motionRef.current }; };
    function draw() { stage.current?.update(view()); if (stage.current && host.current) {
        const stats = stage.current.stats();
        syncDiagnostics(host.current,{renderCalls:stats.calls,renderTriangles:stats.triangles,renderTextures:stats.textures});
    } }
    function render(){try{draw();return true;}catch{stop();live.current.paused=true;setReady(false);setError(sceneFailure());void audio.current?.suspend().catch(()=>{});updateUi();return false;}}
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
    function stop() { controls.current.cancel(); cancelAnimationFrame(frame.current); frame.current = 0; live.current.clock = pause(live.current.clock); const pointer=live.current.pointer; live.current.pointer = null; live.current.raised = false; live.current.cashDrag={x:0,y:0}; if(pointer?.owner?.hasPointerCapture(pointer.id))pointer.owner.releasePointerCapture(pointer.id); }
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
        setNotice(`第 ${++captureFailures.current} 次產生成果圖片失敗。這局已完成，成果畫面還沒保存。請重試產生圖片，完成次數不會重算。`);
        updateUi();
    } }
    function photosDone() { const l = live.current; if (!l.photos.length) {
        stop();l.pan={x:0,y:0};l.targetPan={x:0,y:0};l.fov=44;l.film=0;l.paused=false;
        l.started = false;
        l.clock = { elapsed: 0, last: null, running: false };
        l.client = 0;
        l.roundAt = 0;
        captureFailures.current = 0;
        setNotice('這局還沒拍到照片。再開一次照相館，按快門留下怪事。');
        render();updateUi();
        return;
    } const best = l.photos.reduce((a, b) => a.stars >= b.stars ? a : b); finish({ game, seed, title: GAMES[0].title, caption: best.caption, details: best.details, image: best.image, photos: l.photos }); }
    function syncClock() { live.current.clock = tick(live.current.clock, performance.now()); }
    function nextClient() { syncClock(); const l = live.current; if (l.done || !l.started || l.paused || pendingResult.current)
        return; if (l.client === 2) {
        photosDone();
        return;
    } const pointer = l.pointer; l.pointer = null; controls.current.cancel(); if (pointer?.owner?.hasPointerCapture(pointer.id)) pointer.owner.releasePointerCapture(pointer.id);
    l.client++; l.roundAt = l.clock.elapsed; l.film = 0; l.pan = { x: 0, y: 0 }; l.targetPan = { x: 0, y: 0 }; l.fov = 44; setNotice(CLIENTS[l.client].title); render(); updateUi(); }
    function shoot(client = live.current.client) {
        syncClock();
        const l = live.current;
        if (!ready || !l.started || l.paused || l.done || client!==l.client || pendingResult.current || l.film >= RULES.film || !stage.current)
            return;
        if(l.clock.elapsed-l.roundAt>=RULES.photoMs){nextClient();return;}
        try {
            if(!render())return;
            const { visible, blocked, lift } = stage.current.framing(), grade = gradePhoto(CLIENTS[l.client].id, visible, (l.clock.elapsed - l.roundAt) / 1000, blocked, lift), image = stage.current.capture();
            l.photos.push({ ...grade, image });
            l.film++;
            sfx('photo');
            setNotice(photoNotice(`${grade.caption} ${grade.details}`, l.client, l.film));
            if (motionRef.current)
                setFlash(n => n + 1);
            updateUi();
        }
        catch (cause) {
            setNotice(photoNotice(`本局第 ${++captureFailures.current} 次拍照未保存。${cause instanceof Error ? cause.message : '這張未能保存，請重試。'}`, l.client, l.film));
        }
    }
    function applyStamp(point: Point, index = live.current.stamps.practice ? -1 : live.current.stamps.index) { syncClock(); const l = live.current; if (!l.started || l.paused || l.done || pendingResult.current)
        return; const outcome = stamp(l.stamps, index, point, l.clock.elapsed); if (outcome.kind === 'ignored')
        return; l.stamps = outcome.state; l.stampFeedback={point:{...point},hit:outcome.kind!=='miss',at:l.clock.elapsed}; l.raised = false; l.stampPoint = point; sfx(outcome.kind === 'miss' ? 'wrong' : 'stamp'); setNotice(stampNotice(l.stamps, outcome.kind)); render(); updateUi(); if (l.stamps.endedAt !== null) {
        const elapsed = l.stamps.endedAt - (l.stamps.startedAt ?? l.stamps.endedAt);
        settle({ game, seed, title: GAMES[1].title, caption: l.stamps.misses ? '主管：印象深刻，文件也是。' : '主管：下班可以，先批准你的下班。', details: `完成 12 份文件 · ${seconds(elapsed)} 秒 · 多蓋 ${l.stamps.misses} 次` });
    } }
    function applyCash(accept: boolean, index = live.current.cash.index) { syncClock(); const l = live.current; if (!l.started || l.paused || l.done || pendingResult.current)
        return; const outcome = sortCash(l.cash, index, accept, l.clock.elapsed); if (outcome.kind === 'ignored')
        return; l.cash = outcome.state; l.cashDrag={x:0,y:0}; sfx(outcome.kind === 'wrong' ? 'wrong' : 'cash'); setNotice(cashNotice(l.cash, outcome.kind, accept));
        // Settlement stops the clock and refreshes the final scene before capture.
        // Only ongoing actions need this immediate feedback draw.
        if (l.cash.endedAt === null) render();
        updateUi(); if (l.cash.endedAt !== null) {
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
        setError(sceneFailure());
        return;
    } if (game === 'photo' && l.clock.elapsed - l.roundAt >= RULES.photoMs)
        nextClient(); if (now - lastUi.current > 100) {
        lastUi.current = now;
        updateUi();
    } if (!l.done && l.clock.running)
        frame.current = requestAnimationFrame(loop.current); };
    function start() { if (!ready || pendingResult.current || dialog)
        return; const l = live.current; if (!l.started) onStart(section.current); l.started = true; l.paused = false; l.clock = { ...resume(l.clock), last: performance.now() }; cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(loop.current); focusAfterCommit.current=true; setNotice(game === 'photo' ? '底片只有兩張。漂亮的、離譜的，都能留下。' : hints[game]); updateUi(); }
    useLayoutEffect(()=>{if(focusAfterCommit.current){focusAfterCommit.current=false;if(live.current.started&&!live.current.paused&&!dialog)section.current?.focus({preventScroll:true});}});
    useLayoutEffect(()=>{if(dialog&&!dialogRef.current?.open)dialogRef.current?.showModal();},[dialog]);
    function openDialog(kind:'help'|'restart'|'photos',target:HTMLElement){dialogReturn.current=target;setPaused();setDialog(kind);}
    function closeDialog(){dialogRef.current?.close();setDialog(null);dialogReturn.current?.focus({preventScroll:true});}
    function restart(){stop();live.current=initialLive();pendingResult.current=null;captureFailures.current=0;setCaptureError(false);setNotice('同一題已重新準備。');closeDialog();render();updateUi();}
    function changeRenderer(next:'native'|'light'){stop();if(live.current.started)live.current.paused=true;setReady(false);setRenderer(next);setRetry(n=>n+1);setRendererNotice(next==='light'?'輕量插畫：相同規則、鏡頭與成績，沒有使用 WebGL。':'正在重新準備 3D 場景，保留這局進度。');}

    function setPaused() { const l = live.current; if (!l.started || l.done)
        return; syncClock(); stop(); l.paused = true; void audio.current?.suspend().catch(() => { }); render(); updateUi(); }
    useEffect(() => { const change = () => { motionRef.current = !matchMedia('(prefers-reduced-motion: reduce)').matches; render(); }; const media = matchMedia('(prefers-reduced-motion: reduce)'); media.addEventListener('change', change); const hidden = () => { if (document.hidden)
        setPaused(); }; const blur = () => setPaused(); document.addEventListener('visibilitychange', hidden); window.addEventListener('blur', blur); return () => { media.removeEventListener('change', change); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', blur); }; }, []);
    useEffect(() => {
        const current = ++generation.current;
        let mounted = true, owned: Stage | null = null;
        const currentOwner=()=>mounted&&generation.current===current;
        setReady(false);setError('');
        const fail=(message:string)=>{if(!currentOwner())return;stop();if(live.current.started)live.current.paused=true;setReady(false);setError(message);updateUi();};
        const timeout=window.setTimeout(()=>{if(currentOwner()){generation.current++;setError('遊戲場景載入較久。請重試，或回遊樂場。');}},15000);
        const load=renderer==='light'?import('./daily-scene').then(m=>()=>m.createDailyLightStage(host.current!,()=>fail('輕量畫面暫時中斷。請重試場景，這局進度仍保留。'))):import('./stage').then(m=>()=>m.createStage(host.current!,()=>fail('3D 畫面暫時中斷。按重試恢復這一局。')));
        void load.then(create=>{if(!currentOwner())return;try{
            owned=create();stage.current=owned;owned.update(view());clearTimeout(timeout);setReady(true);
        }catch{owned?.dispose();owned=null;stage.current=null;clearTimeout(timeout);
            if(renderer==='native')fail('此瀏覽器暫時無法開啟 3D 場景。可重試，或用輕量畫面繼續。');
            else fail('輕量畫面也未能建立。請重試場景，或回遊樂場。');
        }}).catch(()=>{if(!currentOwner())return;clearTimeout(timeout);fail('遊戲素材未能載入。請重試。');});
        return()=>{mounted=false;generation.current++;clearTimeout(timeout);stop();owned?.dispose();if(stage.current===owned)stage.current=null;};
    },[retry,renderer]);
    useEffect(() => () => { void audio.current?.close().catch(() => { }); }, []);
    useEffect(()=>{const cancel=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape')escapeCapture.current();};window.addEventListener('keydown',cancel,true);return()=>window.removeEventListener('keydown',cancel,true);},[]);
    function pan(dx: number, dy: number) { const l = live.current; l.targetPan = { x: clamp(l.targetPan.x + dx, -1.8, 1.8), y: clamp(l.targetPan.y + dy, -2.8, 2.8) }; }
    function inputSubject(){const l=live.current;return game==='photo'?l.client*10+l.film:game==='stamp'?l.stamps.practice?-1:l.stamps.index:l.cash.index;}
    function actionControls(id:number,action:()=>void){
        const commit=(subject:number|null)=>{const l=live.current;if(subject!==null&&subject===inputSubject()&&ready&&l.started&&!l.paused&&!l.done&&!pendingResult.current&&!dialog)action();};
        return {
            onPointerDown:(e:PointerEvent<HTMLButtonElement>)=>{if(e.button===0&&e.isPrimary)controls.current.down(id,`pointer:${e.pointerId}`,inputSubject());},
            onPointerUp:(e:PointerEvent<HTMLButtonElement>)=>controls.current.up(id,`pointer:${e.pointerId}`),
            onPointerCancel:(e:PointerEvent<HTMLButtonElement>)=>controls.current.cancel(id,`pointer:${e.pointerId}`),
            onLostPointerCapture:(e:PointerEvent<HTMLButtonElement>)=>controls.current.lost(id,`pointer:${e.pointerId}`),
            onBlur:()=>controls.current.cancel(id),
            onKeyDown:(e:KeyboardEvent<HTMLButtonElement>)=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(!e.repeat&&!e.altKey&&!e.ctrlKey&&!e.metaKey)controls.current.down(id,`key:${e.key}`,inputSubject());}},
            onKeyUp:(e:KeyboardEvent<HTMLButtonElement>)=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(e.altKey||e.ctrlKey||e.metaKey){controls.current.cancel(id);return;}commit(controls.current.click(id,inputSubject(),`key:${e.key}`));}},
            onClick:(e:MouseEvent<HTMLButtonElement>)=>commit(e.detail===0?controls.current.assistive(id,inputSubject()):controls.current.pointerClick(id)),
        };
    }
    function keyboard(event: KeyboardEvent) { if (event.key==='Escape' && live.current.started && !live.current.paused){event.preventDefault();setPaused();return;} if ((event.target as HTMLElement).closest('input,textarea,select,button,a,dialog') || event.altKey || event.metaKey || event.ctrlKey || !live.current.started || live.current.paused)
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
            shoot(l.client);
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
        return; if(game==='cash'&&stage.current?.cashContains?.(event.clientX,event.clientY)===false)return;event.preventDefault(); section.current?.focus({ preventScroll: true }); l.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: { ...l.targetPan }, index: game === 'cash' ? l.cash.index : l.stamps.practice ? -1 : l.stamps.index, owner: event.currentTarget }; event.currentTarget.setPointerCapture(event.pointerId); if (game === 'stamp') {
        const p = stage.current?.point(event.clientX, event.clientY);
        if (!p) {l.pointer=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);return;}
        l.stamps = beginStamps(l.stamps, l.clock.elapsed);
        l.stampPoint = p;
        l.raised = true;
        render();
    } }
    function pointerMove(event: PointerEvent) { const l = live.current, p = l.pointer; if (!p || p.id !== event.pointerId || l.paused || pendingResult.current)
        return; if (game === 'photo') {
        const rect = event.currentTarget.getBoundingClientRect();
        l.targetPan = { x: clamp(p.pan.x - (event.clientX - p.x) / rect.width * 4.8, -1.8, 1.8), y: clamp(p.pan.y + (event.clientY - p.y) / rect.height * 4.8, -2.8, 2.8) };
    }
    else if (game === 'stamp') {
        const point = stage.current?.point(event.clientX, event.clientY);
        if (point)
            l.stampPoint = point;
        render();
    } else if(game==='cash'){const rect=event.currentTarget.getBoundingClientRect();l.cashDrag={x:clamp((event.clientX-p.x)/Math.max(1,rect.width),-.5,.5),y:clamp((event.clientY-p.y)/Math.max(1,rect.height),-.3,.3)};render();}
    }
    function pointerUp(event: PointerEvent) { const l = live.current, p = l.pointer; if (!p || p.id !== event.pointerId)
        return; l.pointer = null; l.raised = false; l.cashDrag={x:0,y:0}; if (event.currentTarget.hasPointerCapture(event.pointerId))
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
            setNotice('往右滑收鈔，往左滑退票券。也能用畫面內的按鈕。');
        render();
    } }
    const l = live.current, remaining = Math.max(0, RULES.photoMs - (l.clock.elapsed - l.roundAt)), cashCard = cashDeck(seed)[Math.min(l.cash.index, 29)];
    const stampSeconds=Math.floor(Math.max(0,(l.stamps.endedAt??l.clock.elapsed)-(l.stamps.startedAt??l.clock.elapsed))/1000),stampTime=`${Math.floor(stampSeconds/60)}:${String(stampSeconds%60).padStart(2,'0')}`;
    return <section ref={section} data-game-content className={`fw-arcade-board daily-scene${game==='photo'?' daily-photo':game==='stamp'?' daily-stamp':''}`} data-daily-game={game} data-playing={l.started&&!l.paused} tabIndex={0} onKeyDown={keyboard} aria-label={GAMES.find(g => g.id === game)!.title}>
      <div className="fw-arcade-play-layout"><div className="fw-arcade-stage-wrap" data-daily-stage>
        <div className="daily-scene-top">
          <div className="fw-arcade-toolbar"><button className="fw-arcade-secondary daily-icon" aria-label="回遊樂場" title="回遊樂場" onClick={onBack}>←</button><button className="fw-arcade-secondary daily-icon" aria-label="玩法說明" title="玩法說明" onClick={e=>openDialog('help',e.currentTarget)}>?</button><button className="fw-arcade-secondary daily-icon" aria-label="重新開始這一局" title="重新開始這一局" onClick={e=>openDialog('restart',e.currentTarget)}>↻</button>{l.started&&!l.paused&&<button className="fw-arcade-secondary daily-icon" aria-label="暫停" title="暫停" onClick={setPaused}>Ⅱ</button>}</div>
          <div className="fw-arcade-game-title"><div className={game==='photo'||game==='stamp'?'daily-sr':undefined}><h1>{GAMES.find(g=>g.id===game)!.title}</h1><p>{game==='photo'?CLIENTS[l.client].title:game==='stamp'?documentTitle(Math.min(l.stamps.index,11),l.stamps.practice):'收鈔往右，票券往左'}</p></div><output className="fw-arcade-counter" aria-live="off">{game==='photo'?<><span data-photo-client aria-label={`第 ${l.client+1} 位客人，共 3 位`}>{l.client+1}/3</span><span aria-hidden="true"> · </span><span data-photo-time>{Math.ceil(remaining/1000)} 秒</span></>:game==='stamp'?l.stamps.practice?'練習中':`${Math.min(l.stamps.index,12)}/12`:`${l.cash.amount/10000} / 100 萬`}</output>{game==='photo'&&<output className="daily-photo-film" data-photo-film aria-label={`剩餘 ${RULES.film-l.film} 張底片`}>{RULES.film-l.film} 張</output>}</div>
          {game==='photo'&&<><output className="daily-photo-goal" data-photo-goal aria-live="polite" aria-label={CLIENTS[l.client].request} title={CLIENTS[l.client].request}>{['臉和雙腳','全身全傘','三鴿同框'][l.client]}</output>{!notice.includes('拍照未保存')&&<output className="daily-photo-feedback" data-photo-feedback aria-live="off" title={notice}>{l.film>0?`已存${l.photos[l.photos.length-1].stars}★`:'等時機'}</output>}</>}
          {game==='stamp'&&<><output className="daily-stamp-goal" data-stamp-goal aria-label="按住拖到藍圈，放手蓋章。也可以直接點藍圈。">蓋藍圈</output><output className="daily-stamp-facts" aria-live="off"><span data-stamp-time aria-label={l.stamps.practice?'練習不計時':`本局已用時間 ${stampTime}`}>{l.stamps.practice?'不計時':stampTime}</span><span aria-hidden="true"> · </span><span data-stamp-misses aria-label={`多蓋 ${l.stamps.misses} 次`}>歪{l.stamps.misses}</span></output></>}
        </div>
        <div className="daily-scene-viewport">
          {!l.started&&<GameCover id={game} eager className="sg-initial-cover"/>}
          <div className="fw-arcade-stage" ref={host} data-game-stage={ready?'ready':'loading'} data-daily-renderer={renderer} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={e=>{if(l.pointer?.id===e.pointerId){l.pointer=null;l.raised=false;l.cashDrag={x:0,y:0};render();}}} onLostPointerCapture={e=>{if(l.pointer?.id===e.pointerId){l.pointer=null;l.raised=false;l.cashDrag={x:0,y:0};render();}}}/>
          {game==='photo'&&ready&&l.started&&<div className="fw-arcade-viewfinder" aria-hidden="true"><i/><i/><i/><i/></div>}
          {flash>0&&motionRef.current&&<div key={flash} className="fw-arcade-flash" aria-hidden="true"/>}
        </div>
        <div className="fw-arcade-controls">
          <p className={`fw-arcade-instruction${game==='photo'||game==='stamp'?' daily-sr':''}`}>{game==='photo'?CLIENTS[l.client].request:game==='cash'?`目前這張：${cashCard.label}。僅供遊戲使用。`:l.stamps.practice?'先蓋中藍圈一次，不計時。':'蓋中藍圈才算。印章歪了可以重蓋。'}</p>
          <div className="fw-arcade-action-area" inert={!ready||!l.started||l.paused||captureError||!!dialog}>
            {game==='photo'?<><div className="fw-arcade-pan-pad" aria-label="移動鏡頭"><button aria-label="鏡頭往左" {...actionControls(1,()=>pan(-.35,0))}>←</button><button aria-label="鏡頭往上" {...actionControls(2,()=>pan(0,.35))}>↑</button><button aria-label="鏡頭往下" {...actionControls(3,()=>pan(0,-.35))}>↓</button><button aria-label="鏡頭往右" {...actionControls(4,()=>pan(.35,0))}>→</button></div><label className="fw-arcade-zoom"><span>廣角</span><input aria-label="鏡頭廣角" type="range" min="38" max="60" value={l.fov} onChange={e=>{l.fov=Number(e.target.value);render();updateUi();}}/></label><button className="fw-arcade-shutter" disabled={l.film>=RULES.film} {...actionControls(5,()=>shoot(live.current.client))} aria-label="拍照快門"><svg aria-hidden="true" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13"/><circle cx="16" cy="16" r="8"/></svg><small>快門</small></button><button className="fw-arcade-secondary daily-photo-next" aria-label={l.client===2?'挑選照片':'下一位客人 →'} {...actionControls(6,nextClient)}>{l.client===2?'選照片':'下一位'}</button></>:game==='stamp'?<><button className="fw-arcade-stamp-button" aria-label="啪！蓋章" {...actionControls(7,()=>applyStamp(live.current.stampPoint))}><svg aria-hidden="true" viewBox="0 0 32 32"><path d="M7 20h18v7H7zM11 20v-3h10v3M13 16V9a3 3 0 0 1 6 0v7M5 29h22"/></svg><span>蓋章</span></button><p className="fw-arcade-meta daily-sr">方向鍵微調印章 · 空白鍵落印<br/>多蓋 {l.stamps.misses} 次</p></>:<><div className="fw-arcade-sort-buttons"><button className="fw-arcade-secondary" {...actionControls(8,()=>applyCash(false))}>← 退票券</button><button {...actionControls(9,()=>applyCash(true))}>收道具鈔 →</button></div><p className="fw-arcade-meta">已分類 {l.cash.index} / 30 · 分錯 {l.cash.mistakes} 次<br/>最後一張剛好湊滿一百萬。</p></>}
          </div>
          {(game!=='photo'||l.started)&&<p className={`fw-arcade-notice${game==='photo'||game==='stamp'?' daily-sr':''}`} role="status" aria-atomic="true">{notice||hints[game]}</p>}
          {game==='photo'&&notice.includes('拍照未保存')&&<p className="daily-photo-failure" role="alert" aria-label="照片未保存，請再按快門。完整錯誤可在玩法說明檢視。" title={notice}>未存，按快門</p>}
          {game==='photo'&&l.photos.length>0&&<div className="fw-arcade-contact-sheet daily-sr" aria-label="這局拍到的照片">{l.photos.map((p,i)=><img key={i} src={p.image} alt={`底片 ${i+1}：${p.caption}`} width="96" height="72"/>)}</div>}
        </div>
          {game==='photo'&&<button className="fw-arcade-secondary daily-photo-album" aria-label="檢視本局照片與評語" disabled={!l.photos.length} onClick={e=>openDialog('photos',e.currentTarget)}>相簿</button>}
        <div className="daily-scene-mode"><button className="fw-arcade-secondary" onClick={()=>changeRenderer(renderer==='native'?'light':'native')} aria-label={renderer==='light'?'輕量插畫 · 試用 3D':'3D · 改用輕量插畫'} title={rendererNotice||(renderer==='light'?'輕量插畫 · 試用 3D':'3D · 改用輕量插畫')}>{game==='photo'||game==='stamp'?(renderer==='light'?'插畫':'3D'):renderer==='light'?'輕量插畫 · 試用 3D':'3D · 改用輕量插畫'}</button><span className="daily-sr" role="status">{rendererNotice}</span></div>
        {(!ready||!l.started||l.paused||captureError)&&<div className="fw-arcade-stage-cover" data-daily-overlay>
          {game==='photo'||game==='stamp'?<>
            <div className={game==='photo'?'daily-photo-overlay-copy':'daily-stamp-overlay-copy'}>{!l.started&&notice&&<p className="fw-arcade-notice" role="status">{notice}</p>}{captureError?<><strong>這局已完成，先保存成果。</strong><p role="alert">{notice}</p></>:error?<p role="alert">{error}</p>:!ready?<p role="status">正在佈置現場…</p>:<><strong>{l.paused?'休息一下，怪事等你。':GAMES.find(g=>g.id===game)!.subtitle}</strong>{game==='photo'&&<p>{CLIENTS[l.client].request}</p>}<p>{hints[game]}</p></>}</div>
            {captureError?<><button disabled={!ready} onClick={()=>{if(pendingResult.current)settle(pendingResult.current);}}>重試產生成果圖片</button>{!ready&&<button onClick={()=>changeRenderer('light')}>用輕量畫面恢復</button>}</>:error?<><button onClick={()=>setRetry(n=>n+1)}>重試場景</button><button className="fw-arcade-secondary" aria-label="用輕量畫面繼續" onClick={()=>changeRenderer('light')}>用插畫繼續</button></>:ready&&<button onClick={start}>{l.paused?'繼續這一局':game==='stamp'?'先蓋一張練習紙':'開始這一局'}</button>}
          </>:captureError?<><strong>這局已完成，先保存成果。</strong><p role="alert">{notice}</p><button disabled={!ready} onClick={()=>{if(pendingResult.current)settle(pendingResult.current);}}>重試產生成果圖片</button>{!ready&&<button onClick={()=>changeRenderer('light')}>用輕量畫面恢復</button>}</>:error?<><p role="alert">{error}</p><button onClick={()=>setRetry(n=>n+1)}>重試場景</button><button className="fw-arcade-secondary" onClick={()=>changeRenderer('light')}>用輕量畫面繼續</button></>:!ready?<p role="status">正在佈置現場…</p>:<><strong>{l.paused?'休息一下，怪事等你。':GAMES.find(g=>g.id===game)!.subtitle}</strong><p>{hints[game]}</p><button onClick={start}>{l.paused?'繼續這一局':'開始這一局'}</button></>}
        </div>}
        {dialog&&<dialog ref={dialogRef} className="daily-scene-dialog" aria-labelledby="daily-dialog-title" onCancel={e=>{e.preventDefault();closeDialog();}} onClose={()=>setDialog(null)} onKeyDown={e=>{if(e.key==='Tab')e.stopPropagation();}}><h2 id="daily-dialog-title">{dialog==='help'?'玩法說明':dialog==='photos'?'本局照片與評語':'重新開始同一題？'}</h2>{dialog==='photos'?<><p>{notice}</p><div className="daily-photo-gallery">{l.photos.map((p,i)=><figure key={i}><img src={p.image} alt={`底片 ${i+1}：${p.caption}`} width="960" height="720"/><figcaption>{p.caption}<br/>{p.details}</figcaption></figure>)}</div></>:dialog==='help'?<>{game==='photo'&&<><p>{GAMES[0].title} · {CLIENTS[l.client].title}</p><p>{CLIENTS[l.client].request}</p>{notice&&<p>{notice}</p>}</>}{game==='stamp'&&<><p>{documentTitle(Math.min(l.stamps.index,11),l.stamps.practice)}</p><p>方向鍵微調印章，空白鍵落印。蓋中藍圈才換下一張。</p>{notice&&<p>{notice}</p>}</>}<p>{hints[game]}</p><p>{game==='photo'?'三位客人各有 12 秒、兩張底片。入鏡與時機決定成果；移鏡與廣角也會改變實際照片。':game==='stamp'?'藍圈半徑 0.24，蓋中才換下一張；滑出紙張、取消手勢都不蓋章。先練習一張，再處理 12 份。':'30 張卡片中有 6 張非現金票券。分錯留在原張，正確分類才累積到一百萬道具鈔。'}</p><p>Escape 暫停。切換畫面或離開視窗會保留並暫停這局，按繼續才恢復。</p><button className="fw-arcade-secondary" aria-pressed={sound} onClick={()=>{soundRef.current=!sound;setSound(!sound);if(!sound)sfx(game);}}>聲音 {sound?'開':'關'}</button><p className="fw-arcade-meta">同題 #{seed} · {renderer==='light'?'輕量插畫，不使用 WebGL':'原生 3D 場景'}</p></>:<p>這局照片與進度會清除，題目不變。</p>}<div><button className="fw-arcade-secondary" onClick={closeDialog}>{dialog==='help'?'關閉說明':dialog==='photos'?'關閉相簿':'保留這一局'}</button>{dialog==='restart'&&<button onClick={restart}>確認重新開始</button>}</div></dialog>}
      </div></div>
    </section>;

}
function Result({ result, onBack, onReplay, onNext, notice }: {
    notice?: ReactNode;
    result: RunResult;
    onBack: () => void;
    onReplay: () => void;
    onNext: () => void;
}) {
    const [photoIndex, setPhotoIndex] = useState(() => result.photos?.findIndex(p => p.image === result.image) ?? -1), [selected, setSelected] = useState(result), [exports, setExports] = useState<Awaited<ReturnType<typeof resultExports>> | null>(null), [objectUrl, setObjectUrl] = useState(''), [status, setStatus] = useState(''), [manualLink, setManualLink] = useState(false), [generation, setGeneration] = useState(0), [sharing, setSharing] = useState(false), [exportPhase, setExportPhase] = useState<'pending'|'ready'|'error'>('pending'), linkRef = useRef<HTMLInputElement>(null);
    const link = result.game === 'kitchen' || partyOf(result.game) ? new URL(`/play?${new URLSearchParams({game:result.game,...(result.recipe?{recipe:result.recipe}:{}),...(result.cookingMode==='guided'?{practice:'1'}:{}),seed:String(result.seed)})}`,location.origin).toString() : challengeUrl(location.origin, gameOf(result.game)!, result.seed);
    const exportRetryAllowed=useRef(false),exportSelection=useRef(selected),exportOwner=useRef<RunResult|null>(null);
    const exportAbort=useRef<AbortController|null>(null),jpegAbort=useRef<AbortController|null>(null),jpegRetryAllowed=useRef(false);
    const [jpegs,setJpegs]=useState<{site:string;preview:string}|null>(null),[jpegPhase,setJpegPhase]=useState<'idle'|'pending'|'ready'|'error'>('idle'),[jpegGeneration,setJpegGeneration]=useState(0);
    const text = gameShareText(selected,link), shareOwner = useRef(0), sharingRef = useRef(false);
    useEffect(() => {
        let current=true;const controller=new AbortController();exportAbort.current=controller;
        shareOwner.current++;sharingRef.current=false;setSharing(false);setExports(null);exportOwner.current=null;
        exportRetryAllowed.current=false;setExportPhase('pending');setStatus('正在整理成果圖…');
        const logo=document.querySelector<HTMLImageElement>('.fw-arcade-brand img');
        void resultExports(selected,logo,controller.signal).then(value=>{
            if(!current||exportSelection.current!==selected)return;
            exportOwner.current=selected;setExports(value);setExportPhase('ready');
            setStatus('成果圖好了。選一個方式，把這份作品帶走。');
        }).catch(()=>{
            if(!current||controller.signal.aborted||exportSelection.current!==selected)return;
            exportRetryAllowed.current=true;setExportPhase('error');setStatus('成果圖未能產生，請按重試。');
        });
        return()=>{current=false;controller.abort();exportRetryAllowed.current=false;shareOwner.current++;};
    },[selected,generation]);
    useEffect(()=>{
        if(!exports||exportOwner.current!==selected){setObjectUrl('');return;}
        const url=URL.createObjectURL(exports.png);setObjectUrl(url);return()=>URL.revokeObjectURL(url);
    },[exports,selected]);
    // PNG download and native sharing no longer wait for the optional JPEG compositions.
    useEffect(()=>{
        jpegRetryAllowed.current=false;setJpegs(null);
        if(!exports||exportOwner.current!==selected){setJpegPhase('idle');return;}
        let current=true;const controller=new AbortController();jpegAbort.current=controller;setJpegPhase('pending');
        void exports.prepareJpegs(controller.signal).then(value=>{
            if(!current||exportSelection.current!==selected)return;
            setJpegs(value);setJpegPhase('ready');
        }).catch(()=>{
            if(!current||controller.signal.aborted||exportSelection.current!==selected)return;
            jpegRetryAllowed.current=true;setJpegPhase('error');
        });
        return()=>{current=false;controller.abort();jpegRetryAllowed.current=false;};
    },[exports,selected,jpegGeneration]);
    function choosePhoto(index:number){
        const photo=result.photos?.[index];if(!photo)return;
        const next={...result,...photo};exportSelection.current=next;exportOwner.current=null;
        exportAbort.current?.abort();jpegAbort.current?.abort();shareOwner.current++;
        exportRetryAllowed.current=false;jpegRetryAllowed.current=false;
        setExports(null);setJpegs(null);setObjectUrl('');setExportPhase('pending');setJpegPhase('idle');setPhotoIndex(index);setSelected(next);
    }
    useEffect(() => { if (manualLink) {
        linkRef.current?.focus();
        linkRef.current?.select();
    } }, [manualLink]);
    async function share() { if (!exports || exportOwner.current!==selected || exportSelection.current!==selected || sharingRef.current)
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
    function workshop() { if (!jpegs||exportSelection.current!==selected)
        return; try {
        saveGameDraft(sessionStorage, { version: 1, createdAt: Date.now(), game: result.game, ...(result.recipe ? {recipe:result.recipe} : {}), seed: result.seed, title: selected.title, text, image: jpegs.site });
        location.assign('/?game-share=1#home');
    }
    catch {
        setStatus('成果還沒保存，請重試「發到自由工坊」，或先下載圖片。');
    } }
    return <section data-game-content tabIndex={-1} aria-label="遊戲成果" className={`fw-arcade-result ${gameOf(result.game)?'daily-scene-result':''} ${result.market?'fw-arcade-market-result':''}`}>{notice}<div className="fw-arcade-result-heading"><p className="fw-arcade-eyebrow">{result.game === 'kitchen' ? '本日料理手帳' : '本日離譜成果'}</p><h1>{result.game==='kitchen'?selected.title:selected.caption}</h1>{result.game==='kitchen'?!result.market&&<p aria-label="料理分數">{selected.caption}</p>:<p>{selected.details}</p>}</div><div className="fw-arcade-result-layout"><div className="fw-arcade-result-photo">{result.game==='kitchen'&&recipeOf(result.recipe)&&<DishShowcase recipe={recipeOf(result.recipe)!} market={result.market} preview={selected.image} exportSettled={!!objectUrl||exportPhase==='error'}/>}{result.game==='kitchen'?<details className="ck-export-preview"><summary>查看分享成果圖</summary><img src={jpegs?.preview??selected.image} alt={`${selected.title}・完整分享成果圖`} width="960" height="1200"/></details>:<img src={selected.image} alt={`${selected.title}・${(result.game==='holiday'||result.game==='chair'||result.game==='tofu')&&selected.image.startsWith('data:image/svg')?'本局紀錄成果卡（不是3D截圖）':'本局遊戲畫面與成績'}`}  width="960" height="720"/>}{!!result.photos?.length && <div className="fw-arcade-photo-choices" aria-label="選一張成果照片">{result.photos.map((p, i) => <button key={i} className={photoIndex === i ? 'is-selected' : ''} aria-pressed={photoIndex === i} onClick={() => choosePhoto(i)}><img src={p.image} alt=""/><span>底片 {i + 1} · 委託 {p.stars}/3</span></button>)}</div>}</div><div className="fw-arcade-share-panel" data-game-share tabIndex={-1} role="region" aria-label="分享這局成果">{result.market&&<MarketScore run={result.market}/>}<h2>{result.game === 'kitchen' ? '把你的拿手菜，端給大家看。' : '這次怪事，值得留一張。'}</h2><p>可以直接發到工坊，也能把圖片和同題挑戰傳給朋友。</p><button disabled={!jpegs} onClick={workshop}>發到自由工坊</button><small>圖片與文案帶進預覽，由你確認發布。登入後會接回這張。</small>{jpegPhase==='pending'&&<p role="status">正在準備工坊圖片，PNG 已可下載或分享。</p>}{jpegPhase==='error'&&<><p role="status">工坊圖片未能產生，PNG 仍可下載或分享。</p><button className="fw-arcade-secondary" onClick={()=>{if(!jpegRetryAllowed.current||exportSelection.current!==selected)return;jpegRetryAllowed.current=false;setJpegPhase('pending');setJpegGeneration(n=>n+1);}}>重試準備工坊圖片</button></>}<button className="fw-arcade-secondary" disabled={!exports || sharing} onClick={() => void share()}>系統分享圖片／連結</button>{objectUrl ? <a className="fw-arcade-button fw-arcade-secondary" href={objectUrl} download={`${result.game==='kitchen'?'料理手帳':'離譜日常'}-${result.game}-${result.seed}.png`}>下載完整成果 PNG</a> : <button className="fw-arcade-secondary" disabled={exportPhase!=='error'} onClick={() => {if(!exportRetryAllowed.current||exportSelection.current!==selected)return;exportRetryAllowed.current=false;setExportPhase('pending');setGeneration(n => n + 1);}}>重試產生成果圖</button>}<button className="fw-arcade-secondary" onClick={() => void copy()}>複製同題挑戰連結</button><ResultShare key={photoIndex} link={link} text={text} ready={!!exports} sharing={sharing} onNative={()=>void share()} onStatus={setStatus}/><p className="fw-arcade-notice" role="status">{status}</p>{manualLink && <label className="fw-arcade-link-field">同題連結<input ref={linkRef} readOnly value={link} onFocus={e => e.currentTarget.select()}/></label>}<div className="fw-arcade-result-again"><button onClick={onReplay}>同一題再來一次</button><button className="fw-arcade-secondary" onClick={onNext}>{result.game==='kitchen'?'換一道料理 →':'換個玩法 →'}</button><button className="fw-arcade-secondary" onClick={onBack}>回遊樂場</button></div><p className="fw-arcade-meta">這是個人遊戲成果，不是貢獻值、信任分數或現金收益。</p></div></div></section>;
}
export function AbsurdDaily() {
    const [game,setGame]=useState<ArcadeGameId|null>(initialGame),[recipe,setRecipe]=useState(()=>recipeOf(new URLSearchParams(location.search).get('recipe'))),[seed,setSeed]=useState(()=>seedOf(new URLSearchParams(location.search).get('seed'))),[result,setResult]=useState<RunResult|null>(null),[run,setRun]=useState(0),[fresh,setFresh]=useState(false);
    const [book,setBook]=useState<Cookbook>(()=>readCookbook(localBook).book??emptyCookbook()),[saveNotice,setSaveNotice]=useState(()=>readCookbook(localBook).notice),[bookFailed,setBookFailed]=useState(()=>!readCookbook(localBook).available);
    const fullscreen=useRef<FullscreenGameHandle>(null),main=useRef<HTMLElement>(null),returnPoint=useRef<{top:number;key:string}|null>(null),restoreLobby=useRef(false);
    const bookRef=useRef(book), bookDirty=useRef(bookFailed);bookRef.current=book;
    const [lobby,setLobby]=useState<LobbyState>({category:'all',query:'',filter:'all',limit:8,collection:'all'});
    const changeBook=(change:Parameters<typeof updateCookbook>[2])=>{const saved=updateCookbook(localBook,bookRef.current,change,Date.now(),bookDirty.current);bookRef.current=saved.book;bookDirty.current=!saved.available;setBook(saved.book);setSaveNotice(saved.notice);setBookFailed(!saved.available);};
    const choose=useCallback((next:ArcadeGameId|null,keepSeed=false,dish:Recipe|null=null,origin='')=>{if(game===null&&next)returnPoint.current={top:window.scrollY,key:origin};restoreLobby.current=next===null;const checkpoint=dish&&!keepSeed?readCookingRun(tabBook).run:null,marketCheckpoint=dish&&!keepSeed?readMarket(tabBook):null,nextSeed=keepSeed?seed:marketCheckpoint&&dish&&marketCheckpoint.recipe===dish.id?marketCheckpoint.seed:checkpoint&&dish&&checkpoint.recipeId===dish.id?checkpoint.seed:freshSeed();const update=()=>{setGame(next);setRecipe(dish);setSeed(nextSeed);setFresh(keepSeed);setResult(null);setRun(n=>n+1);};const url=new URL(location.href);url.pathname='/play';url.search=next?new URLSearchParams({game:next,...(dish?{recipe:dish.id}:{}),seed:String(nextSeed),...(keepSeed&&new URLSearchParams(location.search).get('practice')==='1'?{practice:'1'}:{})}).toString():'';url.hash='';history.pushState(null,'',url);if(next){flushSync(update);fullscreen.current?.enter();}else update();},[game,seed]);
    useLayoutEffect(()=>{
        if(!game&&restoreLobby.current){
            restoreLobby.current=false;
            const point=returnPoint.current;
            const restore=()=>{
                if(document.fullscreenElement)return;
                const card=point&&[...document.querySelectorAll<HTMLElement>('[data-arcade-open]')].find(e=>e.dataset.arcadeOpen===point.key);
                (card||main.current)?.focus({preventScroll:true});
                window.scrollTo({top:point?.top??0,behavior:'instant'});
            };
            restore();
            // Native exit completes after the fullscreen component unmounts.
            document.addEventListener('fullscreenchange',restore);
            return()=>document.removeEventListener('fullscreenchange',restore);
        }
        (main.current?.querySelector<HTMLElement>('[data-game-content]')??main.current)?.focus({preventScroll:true});
        window.scrollTo({top:0,behavior:'instant'});
    },[game,run,result]);
    const nextGame=()=>{if(game==='kitchen'&&recipe){const next=RECIPES[(RECIPES.findIndex(r=>r.id===recipe.id)+1)%RECIPES.length];choose('kitchen',false,next);}else{const choices=[...GAMES,...PARTY_GAMES];choose(choices[(choices.findIndex(g=>g.id===game)+1)%choices.length].id);}};
    useEffect(()=>{document.title='遊戲大廳 · 自由工坊';const previousScroll=history.scrollRestoration;history.scrollRestoration='manual';const back=()=>{restoreLobby.current=initialGame()===null;setGame(initialGame());setRecipe(recipeOf(new URLSearchParams(location.search).get('recipe')));setSeed(seedOf(new URLSearchParams(location.search).get('seed')));setFresh(false);setResult(null);setRun(n=>n+1);};const changed=(event:StorageEvent)=>{if(event.key===COOKBOOK_KEY&&!bookDirty.current){const saved=readCookbook(localBook);bookRef.current=saved.book;setBook(saved.book);setSaveNotice(saved.notice);}};window.addEventListener('popstate',back);window.addEventListener('storage',changed);return()=>{history.scrollRestoration=previousScroll;window.removeEventListener('popstate',back);window.removeEventListener('storage',changed);};},[]);
    const invalid=new URLSearchParams(location.search).get('game')==='kitchen'&&!game;
    const partyGame:PartyGameId|null=partyOf(game);
    const isMarket=game==='kitchen'&&!!recipe&&!!marketOf(recipe.id)&&new URLSearchParams(location.search).get('practice')!=='1';
    const bookNotice=saveNotice?<div className="ck-save-warning" role="status"><p>{saveNotice}</p>{bookFailed&&<button className="fw-arcade-secondary" onClick={()=>changeBook({kind:'retry'})}>重試保存食譜本</button>}</div>:null;
    return <div className="fw-arcade-root fw-arcade-toy-console fw-arcade-shotengai"><a className="fw-arcade-skip" href="#fw-arcade-main">跳到遊戲內容</a><header className="fw-arcade-header" style={{flexWrap:'wrap'}}><a className="fw-arcade-brand" href="/"><img src="/brand/freedom-workshop-compact-transparent.png" alt="自由工坊" width="396" height="132" style={{width:132,height:44,maxWidth:'none',flexShrink:0}}/><span>遊戲大廳</span></a><a className="fw-arcade-home-link" href="/">回自由工坊 ↗</a></header><main id="fw-arcade-main" ref={main} tabIndex={-1}>
      <MemberGameUpload hidden={Boolean(game)}/>
      <CommunityGameSubmission hidden={Boolean(game)}/>
      {!isMarket&&bookNotice}
      {game?<FullscreenGame ref={fullscreen} resultReady={result !== null} integrated={(game==='kitchen'&&!!recipe)||!!gameOf(game)} market={isMarket} holiday={partyGame==='holiday'} chair={partyGame==='chair'} tofu={partyGame==='tofu'}>{result?<Result result={result} notice={isMarket?bookNotice:null} onBack={()=>choose(null)} onReplay={()=>choose(game,true,recipe)} onNext={nextGame}/>:game==='kitchen'&&recipe&&marketOf(recipe.id)&&new URLSearchParams(location.search).get('practice')!=='1'?<MarketLoader key={`${recipe.id}/${run}`} bookNotice={bookNotice} recipe={recipe} seed={seed} fresh={fresh} onBack={()=>choose(null)} onResult={setResult} onStart={target=>fullscreen.current?.enter(target)} onComplete={(completed:MarketRun)=>changeBook({kind:'market-complete',run:completed})}/>:game==='kitchen'&&recipe?<CookingLoader key={`${recipe.id}/${run}`} recipe={recipe} seed={seed} fresh={fresh} onBack={()=>choose(null)} onResult={setResult} onStart={(target,viewTarget)=>fullscreen.current?.enter(target,viewTarget)} onComplete={(completed:CookingRun)=>changeBook({kind:'complete',run:completed})}/>:partyGame?<PartyLoader key={`${partyGame}/${run}`} game={partyGame} seed={seed} onBack={()=>choose(null)} onResult={setResult} onStart={target=>fullscreen.current?.enter(target)}/>:game&&game!=='kitchen'?<GameBoard key={`${game}/${run}`} game={gameOf(game)!} seed={seed} onBack={()=>choose(null)} onResult={setResult} onStart={target=>fullscreen.current?.enter(target)}/>:null}</FullscreenGame>:<ArcadeLobby state={lobby} onState={setLobby} book={book} onFavorite={id=>changeBook({kind:'favorite',id})} onGame={(g,key)=>choose(g,false,null,key)} onRecipe={(r,key)=>choose('kitchen',false,r,key)} notice={invalid?'這道料理連結無法辨識，請從食譜本選一道。':''}/>}
    </main><footer className="fw-arcade-footer">自由工坊原創遊戲 · 作品由你確認後分享</footer></div>;
}
