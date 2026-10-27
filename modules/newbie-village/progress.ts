import {QUESTIONS_V2} from './content.js';
import {completeAnswers,validAnswer,type Answers} from './scoring.js';
export const STORAGE_KEY='freedom-newbie-village-v1';
export const QUESTS=['framework','quiz','card','guild','checkin'] as const;
export type Quest=typeof QUESTS[number];
export type Progress={version:1;answers:Answers;done:Quest[];baseline:string;action:string;checkin:string};
export const freshProgress=():Progress=>({version:1,answers:QUESTIONS_V2.map(()=>[]),done:[],baseline:'',action:'',checkin:''});
export function parseProgress(raw:string|null):Progress {
  try{
    if(!raw||raw.length>50000)return freshProgress();
    const p=JSON.parse(raw);if(p.version!==1)return freshProgress();
    const answers=QUESTIONS_V2.map((_,i)=>validAnswer(p.answers?.[i],i)?p.answers[i]:[]);
    const text=(key:string)=>typeof p[key]==='string'?p[key].slice(0,4000):'';
    const done=QUESTS.filter(q=>Array.isArray(p.done)&&p.done.includes(q));
    return {version:1,answers,done:done.filter(q=>q!=='quiz'||completeAnswers(answers)),baseline:text('baseline'),action:text('action'),checkin:text('checkin')};
  }catch{return freshProgress();}
}
export const badges=(p:Progress)=>p.done.map(q=>`newbie-${q}`);
