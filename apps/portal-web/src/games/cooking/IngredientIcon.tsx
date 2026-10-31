import type {Ingredient} from './market-domain';

/** UX-11: recognisable, original tool silhouettes; ingredient names remain the accessible authority. */
export function IngredientIcon({kind}:{kind:Ingredient}) {
 let art;
 switch(kind){
  case 'rice':art=<><path d="M9 25h46c-2 15-11 18-23 18S12 39 9 25" fill="#7d9c91"/><path d="M14 24c0-7 7-13 18-13s18 6 18 13" fill="#f3e8c9"/><path d="m22 18 4-2m6 1 4-2m4 6 4-1m-25 3 5-1m5 1 4-1" stroke="#d4c3a0" strokeWidth="2" strokeLinecap="round"/><path d="M12 26h40" stroke="#ebe1c6" strokeWidth="3"/></>;break;
  case 'egg':art=<><path d="M13 31c-6-8 2-18 12-16 3-12 18-10 20 1 16 3 17 19 3 23-13 4-26 5-35-8" fill="#f4ead0" stroke="#d1bc96"/><ellipse cx="33" cy="25" rx="11" ry="9" fill="#e9b347"/><path d="M27 22q4-5 9-2" stroke="#f4d17b" strokeWidth="2" fill="none"/></>;break;
  case 'scallion':art=<><path d="m17 35 27-25 7 4-27 26" fill="#91ad70"/><path d="m12 29 28-20 4 4-25 23" fill="#527b47"/>{[[22,27],[35,25],[45,32],[27,37]].map(([x,y],i)=><ellipse key={i} cx={x} cy={y} rx="7" ry="4.5" fill="#668d51" stroke="#c6d39b" strokeWidth="3"/>)}</>;break;
  case 'shrimp':art=<><path d="M45 12C21-2 6 15 14 31c6 12 22 14 30 3l-6-6c-6 6-14 2-14-4s6-8 13-4" fill="#e9a37d" stroke="#b66d4e" strokeWidth="1.5"/><path d="m18 12 6 6m-9 3 8 3m-5 8 8-3m2 9 3-7m7 3 8 5-1-11" stroke="#f4ccaa" strokeWidth="2" fill="none"/></>;break;
  case 'carrot':art=<><path d="M18 13q8-6 16 1L51 39q1 4-3 3L18 25q-5-7 0-12" fill="#dd853d"/><path d="m22 25 5-5m4 12 5-5m-2-11 4-7m-9 6 1-10m-5 11-5-8" fill="none" stroke="#96562f" strokeWidth="2"/><path d="m22 14 2-10 6 8 8-9 1 10" fill="#74945c"/></>;break;
  case 'steak':art=<><path d="M10 26C6 12 20 4 32 10c16-8 29 4 23 17-4 9-16 7-22 13-11 5-21-1-23-14" fill="#a75e49" stroke="#824833" strokeWidth="2"/><path d="M14 25c1-11 14-13 19-8 13-6 22 1 17 10-4 5-15 3-19 9" fill="none" stroke="#dba68c" strokeWidth="3"/><path d="m22 14-4 18m13-17-4 17m14-17-4 15" stroke="#76482d" strokeWidth="2"/></>;break;
  case 'potato':art=<>{[[13,13,-15],[23,7,5],[34,13,12],[42,8,-8]].map(([x,y,r],i)=><g key={i} transform={`rotate(${r} ${x+4} ${y+13})`}><rect x={x} y={y} width="8" height="28" rx="2" fill={i%2?'#dbac56':'#e8bf6b'} stroke="#bf8c3f"/><path d={`M${x+2} ${y+3}v21`} stroke="#f2d792"/></g>)}</>;break;
  case 'broccoli':art=<><path d="m27 39 2-17 9 1 5 16" fill="#9ca95f"/><path d="m34 32-11-9m12 7 12-9" stroke="#94a252" strokeWidth="5"/>{[[20,20,10],[31,12,11],[45,18,10],[33,24,12]].map(([x,y,r],i)=><circle key={i} cx={x} cy={y} r={r} fill={i%2?'#5d8147':'#6b9052'} stroke="#4e733e" strokeWidth="1.5"/>)}</>;break;
  case 'bread':art=<><ellipse cx="32" cy="25" rx="26" ry="17" fill="#e2c58e" stroke="#ba965d"/><path d="m15 23 4-3m6-6 6 2m8-1 6 3m3 9 5-1m-22 9 6-2m-15-6 4 2" stroke="#b78c4c" strokeWidth="2.5" strokeLinecap="round"/></>;break;
  case 'meat':art=<>{[0,1,2,3,4].map(i=><path key={i} d={`M${12+i*3} ${18+i*4}q12-12 35-5l-5 7q-15-2-27 5z`} fill={i%2?'#b28155':'#9b6845'} stroke="#7c5134"/>)}</>;break;
  case 'lettuce':art=<><path d="M31 41C19 39 8 31 12 24 3 15 19 5 25 11 31 1 42 7 42 12c14-6 20 8 12 14 4 8-10 16-23 15" fill="#85a35b" stroke="#658344"/><path d="M31 40 29 14m2 18-13-9m13 7 14-12" stroke="#b7c883" strokeWidth="2" fill="none"/></>;break;
  case 'tomato':art=<><ellipse cx="32" cy="27" rx="23" ry="17" fill="#c95f45" stroke="#9f4432" strokeWidth="2"/><ellipse cx="32" cy="27" rx="17" ry="12" fill="#e99565"/>{[0,1,2,3,4].map(i=>{const a=i*Math.PI*2/5;return <ellipse key={i} cx={32+Math.cos(a)*11} cy={27+Math.sin(a)*8} rx="3" ry="1.8" transform={`rotate(${i*72} ${32+Math.cos(a)*11} ${27+Math.sin(a)*8})`} fill="#eed3a0"/>;})}<path d="m25 8 7 7 7-8-1 10-11-1" fill="#638344"/></>;break;
  case 'sausage':art=<><path d="m18 40 29-30" stroke="#c5a16a" strokeWidth="4" strokeLinecap="round"/><path d="M14 30 34 9c9-7 20 4 13 13L27 42C19 47 8 37 14 30" fill="#bb7450" stroke="#915639" strokeWidth="1.5"/><path d="m24 19 4 6m2-12 5 6m-18 7 5 6" stroke="#dca37b" strokeWidth="2" strokeLinecap="round"/></>;break;
 }
 return <svg viewBox="0 0 64 48" aria-hidden="true"><ellipse cx="32" cy="40" rx="25" ry="5" fill="#bfa57c" opacity=".2"/>{art}</svg>;
}
