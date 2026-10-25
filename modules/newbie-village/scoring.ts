import {CLASSES_V2,EXTRA_DATA_V2,QUESTIONS_V2,DIMENSION_MAP_V2,type Career,type Dimension} from './content.js';
export const CAREER_KEYS = Object.keys(CLASSES_V2) as Career[];
export const DIMENSIONS: Dimension[] = ['personality','lifestyle','capability'];
export type Answers = number[][];
export function validAnswer(answer: unknown, index: number): answer is number[] {
  const q=QUESTIONS_V2[index];
  return !!q && Array.isArray(answer) && answer.length>=1 && answer.length<=(q.maxSelect??1) && new Set(answer).size===answer.length && answer.every(i=>Number.isInteger(i)&&i>=0&&i<q.options.length);
}
export function completeAnswers(answers: Answers) {return answers.length===15&&QUESTIONS_V2.every((_,i)=>validAnswer(answers[i],i));}
const emptyScores=()=>Object.fromEntries(CAREER_KEYS.map(k=>[k,0])) as Record<Career,number>;
// Stable ties use source career order. No randomness, inference service or hidden inputs.
export function calculateResult(answers: Answers) {
  const scores=emptyScores();
  const scoresByDim=Object.fromEntries(DIMENSIONS.map(d=>[d,emptyScores()])) as Record<Dimension,Record<Career,number>>;
  QUESTIONS_V2.forEach((q,index)=>{
    if(!validAnswer(answers[index],index))return;
    const selected=answers[index],weight=selected.length>1?0.7:1;
    for(const i of selected)for(const [key,points] of Object.entries(q.options[i].scores)){
      const career=key as Career; scores[career]+=points*weight;scoresByDim[DIMENSION_MAP_V2[index]][career]+=points*weight;
    }
  });
  const ranked=(s:Record<Career,number>)=>[...CAREER_KEYS].sort((a,b)=>s[b]-s[a]);
  const primary=ranked(scores)[0];
  const dimensionWinners=Object.fromEntries(DIMENSIONS.map(d=>[d,ranked(scoresByDim[d])[0]])) as Record<Dimension,Career>;
  const total=Object.values(scores).reduce((a,b)=>a+b,0);
  const axes=Object.fromEntries(Object.keys(EXTRA_DATA_V2.content.traits).map(axis=>{
    const key=axis as keyof typeof EXTRA_DATA_V2.content.traits;
    const value=total?CAREER_KEYS.reduce((sum,c)=>sum+EXTRA_DATA_V2[c].traits[key]*scores[c],0)/total:2.5;
    return [key,Math.round(Math.max(1,value)*2)/2];
  }));
  return {primary,scores,scoresByDim,dimensionWinners,axes};
}
export function lifestyleBaseline(answers: Answers) {
  return [2,3,6,7,9,10,13,14].flatMap(i=>validAnswer(answers[i],i)?answers[i].map(j=>`${QUESTIONS_V2[i].q}：${QUESTIONS_V2[i].options[j].text}`):[]).join('\n');
}
