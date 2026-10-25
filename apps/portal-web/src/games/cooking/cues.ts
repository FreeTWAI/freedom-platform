import {currentStep,type CookingRun} from './domain';

/** UX-2: presentation only; the domain remains the scoring authority. */
export function cookingCue(run:CookingRun){
  const s=currentStep(run),a=run.active;
  if(s.kind==='knead')return {value:a.holdAt===null?0:(run.elapsed-a.holdAt)/s.holdMs,min:.88,max:1.12,cap:1.7,label:a.holdAt===null?'按住開始揉壓':'圓點進入目標區就放開',unit:'揉壓時機'};
  if(s.kind==='pour')return {value:a.amount,min:s.target-.035,max:s.target+.035,cap:1,label:a.holdAt===null?'按住倒入，靠近刻度再放開':'接近目標了，放開就停',unit:'倒入份量'};
  if(s.kind==='pan')return {value:a.amount,min:.35,max:.8,cap:1.15,label:a.flipped?'已翻面，保持火力煎熟':a.amount<.35?'先煎一下，目標區亮起再翻':'進入目標區，現在可以翻面',unit:'翻面時機'};
  if(s.kind==='bake')return {value:a.amount,min:.7,max:.9,cap:1.15,label:a.amount<.7?'保持溫度，等香氣出來':a.amount<=.9?'剛剛好！現在出爐':'快出爐，別烤過頭',unit:'出爐時機'};
  if(s.kind==='boil')return {value:a.foam,min:.18,max:1,cap:1,label:a.count>=s.goal?'泡沫撈好了，等湯煮熟':a.foam<.18?'等大泡沫聚起來':'泡沫冒出來了，現在撈！',unit:'泡沫量'};
  return null;
}
