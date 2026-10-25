import { GAMES, type GameId } from '../domain';
import {useState} from 'react';
import {PARTY_GAMES,type PartyGameId} from '../party/catalog';
import { CATEGORIES, RECIPES, recipeSearch, TECHNIQUES, type Recipe } from './catalog';
import { FoodArt } from './FoodArt';
import type { Cookbook } from './storage';
import './lobby.css';
import '../party/party.css';

export type LobbyState = {category:string;query:string;filter:string;limit:number;collection:'all'|'kitchen'|'observe'|'reflex'};
const PAGE_SIZE = 8;
const TYPES = [
  {id:'all',name:'全部遊戲',label:'全部遊戲',count:RECIPES.length+GAMES.length+PARTY_GAMES.length,icon:'play'},
  {id:'kitchen',name:'料理小遊戲',label:'料理廚房',count:RECIPES.length,icon:'pan'},
  {id:'observe',name:'觀察攝影',label:'觀察攝影',count:1,icon:'camera'},
  {id:'reflex',name:'反應手速',label:'派對手速',count:2+PARTY_GAMES.length,icon:'bolt'},
] as const;
function HubIcon({kind}:{kind:string}) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind==='pan'?<><path d="M3 11h14a7 7 0 0 1-14 0ZM17 12l5-4M7 3v3m5-4v4"/><path d="M2 20h17"/></>:
      kind==='camera'?<><path d="m8 5 1-2h6l1 2h4a2 2 0 0 1 2 2v12H2V7a2 2 0 0 1 2-2Z"/><circle cx="12" cy="12" r="4"/></>:
      kind==='bolt'?<path d="m14 2-9 12h6l-1 8 9-12h-6l1-8Z"/>:
      <><rect x="2" y="5" width="20" height="15" rx="5"/><path d="M6 12h6m-3-3v6m8-5h.1m2 4h.1M9 5V2h6"/></>}
  </svg>;
}

/** CK-3/8: a compact playroom, with separate browsing, artwork and action owners. */
export function ArcadeLobby({onGame,onRecipe,book,onFavorite,state,onState,notice=''}:{
  onGame:(game:GameId|PartyGameId,origin?:string)=>void;onRecipe:(recipe:Recipe,origin?:string)=>void;book:Cookbook;
  onFavorite:(id:string)=>void;state:LobbyState;onState:(state:LobbyState)=>void;notice?:string;
}) {
  const {category,query,filter,limit,collection}=state;
  const [missingArt,setMissingArt]=useState<string[]>([]);
  const featuredIds=['corn-dog','shawarma','egg-fried-rice','steak-dinner'];
  const browse=[...featuredIds.map(id=>RECIPES.find(r=>r.id===id)!),...RECIPES.filter(r=>!featuredIds.includes(r.id))];
  const filtered=browse.filter(r=>(category==='all'||r.category===category)&&recipeSearch(r,query)&&(filter==='all'||filter==='favorite'&&book.favorites.includes(r.id)||filter==='completed'&&!!book.best[r.id]));
  const completed=Object.keys(book.best).length,featured=RECIPES[0];
  const reset=()=>onState({category:'all',query:'',filter:'all',limit:PAGE_SIZE,collection:'all'});
  return <div className="ck-lobby">
    <aside className="ck-hub-sidebar">
      <div className="ck-hub-wordmark"><span>PLAYROOM</span><strong>隨手玩一下。</strong><p>小小一局，大大開心。</p></div>
      <nav className="ck-game-types" aria-label="遊戲類型">{TYPES.map(t=><button key={t.id} className="ck-type" aria-label={`${t.name} ${t.count}`} aria-pressed={collection===t.id} onClick={()=>onState({...state,collection:t.id})}><HubIcon kind={t.icon}/><span>{t.label}</span><small>{t.count}</small></button>)}</nav>
      <div className="ck-sidebar-note"><span aria-hidden="true">✳</span><p>不用註冊，想玩就玩。<br/>你的拿手菜，記得分享。</p></div>
    </aside>
    <div className="ck-hub-main">
      <header className="ck-hub-heading"><div><p>自由工坊 / PLAYROOM</p><h1>今天想玩什麼？</h1></div><span className="ck-open-label"><i aria-hidden="true"/>免登入，直接開玩</span></header>
      {collection==='kitchen'&&<div className="ck-feature-row">
        <section className="ck-feature" aria-label="今日推薦遊戲">
          <div className="ck-feature-copy"><span className="ck-feature-tag">今天推薦 · 新手友善</span><h2>今天掌廚，<br/>快樂上桌。</h2><p>黃金蛋炒飯 / 切一切、翻個面，<br/>端出你的第一道作品。</p><button data-arcade-open="featured" onClick={()=>onRecipe(featured,'featured')}>這道我來做 <span aria-hidden="true">↗</span></button></div>
          <div className="ck-feature-art" aria-hidden="true"><span className="ck-feature-orbit"/><FoodArt recipe={featured}/><span className="ck-dish-note">黃金蛋炒飯<br/><small>一口剛剛好的快樂</small></span></div>
        </section>
        <section className="ck-passport" aria-label="我的料理手帳">
          <div className="ck-passport-top"><HubIcon kind="pan"/><span>我的料理手帳</span></div>
          <div className="ck-passport-count"><b>{completed}</b><span> / {RECIPES.length}<small>道料理已完成</small></span></div>
          <div className="ck-passport-progress" role="progressbar" aria-label="料理收集進度" aria-valuemin={0} aria-valuemax={RECIPES.length} aria-valuenow={completed}><span style={{width:`${completed/RECIPES.length*100}%`}}/></div>
          <p>{completed?'一道一道，把你的食譜本填滿。':'從第一道開始，慢慢收集拿手菜。'}</p>
          <button className="ck-book-button" onClick={()=>onState({...state,collection:'kitchen',category:'all',query:'',filter:'favorite',limit:PAGE_SIZE})}><span>♡ 我的收藏</span><b>{book.favorites.length} →</b></button>
        </section>
      </div>}
      {notice&&<p className="ad-notice" role="status">{notice}</p>}
      {(collection==='all'||collection==='reflex')&&<section className="pt-party-section" aria-labelledby="pt-party-title"><div className="ck-section-heading"><div><span className="ck-section-kicker">DAY OFF PARTY</span><h2 id="pt-party-title">日常太正經？開個派對。</h2></div><p>3 款原創 3D 小遊戲，換你接招。</p></div><div className="pt-party-cards">{PARTY_GAMES.map(g=><article className="pt-party-card" key={g.id}><div className="pt-party-art" style={{background:g.color}}>{missingArt.includes(g.id)?<span className="pt-party-art-fallback">{g.title}<br/>原創 3D 派對</span>:<img src={`/games/absurd-daily/party/${g.id}.webp`} width="960" height="720" alt={`${g.title}的實際3D遊戲畫面`} loading="lazy" onError={()=>setMissingArt(ids=>ids.includes(g.id)?ids:[...ids,g.id])}/>}<span>{g.tag}</span></div><div><h3>{g.title}</h3><p>{g.subtitle}</p><button data-arcade-open={`game:${g.id}`} onClick={()=>onGame(g.id,`game:${g.id}`)}>{g.action}<span aria-hidden="true">↗</span></button><small>{g.duration} · 手機 / 鍵盤 · 免登入</small></div></article>)}</div></section>}
      {(collection==='all'||collection==='kitchen')&&<section id="ck-kitchen" className="ck-kitchen" aria-labelledby="ck-kitchen-title">
        <div className="ck-section-heading"><div><span className="ck-section-kicker">THE LITTLE KITCHEN</span><h2 id="ck-kitchen-title">選一道，開煮。</h2></div><p>{RECIPES.length} 道料理，每一道都能親手玩。</p></div>
        <div className="ck-categories" role="group" aria-label="料理分類">{[{id:'all',name:'全部料理'},...CATEGORIES].map(c=><button key={c.id} aria-pressed={category===c.id} onClick={()=>onState({...state,category:c.id,limit:PAGE_SIZE})}>{c.name}<small>{c.id==='all'?RECIPES.length:RECIPES.filter(r=>r.category===c.id).length}</small></button>)}</div>
        <div className="ck-find"><label className="ck-search"><span>找一道想做的料理</span><div><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><input type="search" placeholder="找料理、食材或玩法…" value={query} onChange={e=>onState({...state,query:e.target.value,limit:PAGE_SIZE})} maxLength={80}/></div></label><label className="ck-filter">食譜篩選<select value={filter} onChange={e=>onState({...state,filter:e.target.value,limit:PAGE_SIZE})}><option value="all">所有食譜</option><option value="favorite">我的收藏</option><option value="completed">已完成</option></select></label></div>
        <p className="ck-count" role="status">{query?`「${query}」・`:''}{filter==='favorite'?'我的收藏':filter==='completed'?'完成的料理':'這次想做哪一道？'} <span>{filtered.length} 道</span></p>
        <div className="ck-recipe-grid">{filtered.slice(0,limit).map(r=><article className={`ck-recipe-card ck-recipe-${r.category}`} key={r.id}>
          <button className="ck-recipe-open" data-arcade-open={`recipe:${r.id}`} onClick={()=>onRecipe(r,`recipe:${r.id}`)} aria-label={`開始製作${r.name}`}>
            <span className="ck-recipe-visual"><span className="ck-difficulty">{r.difficulty===1?'輕鬆上手':r.difficulty===2?'試試手感':'挑戰一下'}</span><FoodArt recipe={r}/><span className="ck-play-mark" aria-hidden="true">↗</span></span>
            <span className="ck-recipe-info"><strong>{r.name}</strong><span>{r.steps.length} 個步驟 <i>·</i> 約 {r.estimatedSeconds} 秒</span><small>{[...new Set(r.steps.map(s=>TECHNIQUES[s.kind].name))].join(' / ')}</small></span>
          </button>
          <div className="ck-card-bottom"><span>{book.best[r.id]?<><b>{book.best[r.id].score}</b> 分 · 我的最佳</>:CATEGORIES.find(c=>c.id===r.category)!.name}</span><button className="ck-favorite" aria-label={`${book.favorites.includes(r.id)?'取消收藏':'收藏'}${r.name}`} aria-pressed={book.favorites.includes(r.id)} onClick={()=>onFavorite(r.id)}><span aria-hidden="true">{book.favorites.includes(r.id)?'♥':'♡'}</span></button></div>
        </article>)}</div>
        {!filtered.length&&<div className="ck-empty"><span aria-hidden="true">♡</span><h3>{filter==='favorite'?'把喜歡的菜，留在這一頁。':'這一頁還是空白的。'}</h3><p>{filter==='favorite'?'點料理卡片的愛心，下一次就更好找。':'換個分類或關鍵字，找找下一道靈感。'}</p><button onClick={reset}>看看全部料理</button></div>}
        {filtered.length>limit&&<div className="ck-load-more"><button onClick={()=>onState({...state,limit:limit+PAGE_SIZE})}>再看看 8 道料理 <span aria-hidden="true">↓</span></button><span>{Math.min(limit,filtered.length)} / {filtered.length} 道</span></div>}
      </section>}
      {collection!=='kitchen'&&<section className="ck-other-games" aria-labelledby="ck-odd-title"><div className="ck-section-heading"><div><span className="ck-section-kicker">DAILY NONSENSE</span><h2 id="ck-odd-title">不按牌理，也很好玩。</h2></div><p>換個口味，來點離譜日常。</p></div><div className="ad-game-cards">{GAMES.filter(g=>collection==='all'||collection==='observe'&&g.id==='photo'||collection==='reflex'&&g.id!=='photo').map(g=><article key={g.id} className={`ad-game-card ad-card-${g.id}`}><div className="ad-card-art" aria-hidden="true"><img src={`/games/absurd-daily/${g.id}.jpg`} alt="" width="960" height="720" loading="lazy"/><span className="ad-art-copy">{g.id==='photo'?'觀察與攝影':g.id==='stamp'?'反應與準度':'手速與分類'}</span></div><div><h3>{g.title}</h3><p>{g.subtitle}</p><button data-arcade-open={`game:${g.id}`} onClick={()=>onGame(g.id,`game:${g.id}`)}>{g.action}<span aria-hidden="true"> ↗</span></button></div></article>)}</div></section>}
      <footer className="ck-hub-footer"><span aria-hidden="true">↗</span><div><strong>這局有點意思？傳給朋友接招。</strong><p>每款遊戲都能保存成果、分享挑戰，也能帶回自由工坊。</p></div></footer>
    </div>
  </div>;
}
