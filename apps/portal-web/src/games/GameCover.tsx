import {useEffect,useState} from 'react';
import {GAMES} from './domain';
import {PARTY_GAMES} from './party/catalog';
import {recipeOf} from './cooking/catalog';

/** UX-15: an illustration is a cover, never an earned result or a native screenshot. */
export function coverOf(id:string){
 const name=recipeOf(id)?.name??GAMES.find(g=>g.id===id)?.title??PARTY_GAMES.find(g=>g.id===id)?.title;
 return name?{id,name,src:`/games/absurd-daily/illustrated/${id}.webp`}:null;
}
export function GameCover({id,eager=false,className=''}:{id:string;eager?:boolean;className?:string}){
 const art=coverOf(id),[missing,setMissing]=useState(false);useEffect(()=>setMissing(false),[id]);
 if(!art)return null;
 return <span className={`sg-cover ${className}`} data-cover-id={id}>{missing?<span className="sg-cover-fallback"><strong>{art.name}</strong><span>封面暫時未載入，仍可開始遊戲。</span></span>:<img src={art.src} alt={`${art.name}的原創插畫封面`} width="512" height="340" loading={eager?'eager':'lazy'} decoding="async" onError={()=>setMissing(true)}/>}</span>;
}
