import type {Shape} from './catalog';

type Point = readonly [number, number];
export type IngredientLayer = Readonly<{color:string;points:readonly Point[]}>;
export type IngredientVisual = Readonly<{id:'banana'|'citrus'|'tomato'|'mango'|'avocado';layers:readonly IngredientLayer[]}>;
const ink='#73513b';

// Original cut-paper silhouettes. Coordinates are shared by SVG and the shallow
// 3D pieces, not inferred from recipe names. No texture, random detail or game state.
function layer(color:string,points:readonly Point[]):IngredientLayer {
  return Object.freeze({color,points:Object.freeze(points.map(p=>Object.freeze([p[0],p[1]] as const)))});
}
function inset(points:readonly Point[],scale:number):Point[] {return points.map(([x,y])=>[x*scale,y*scale]);}
function visual(id:IngredientVisual['id'],outline:readonly Point[],color:string,details:readonly IngredientLayer[]=[],fill:readonly Point[]=inset(outline,.9)):IngredientVisual {
  return Object.freeze({id,layers:Object.freeze([layer(ink,outline),layer(color,fill),...details])});
}
const banana=visual('banana',[
  [-.94,-.5],[-.78,-.32],[-.55,.02],[-.2,.19],[.18,.2],[.54,.02],[.75,-.3],[.8,-.69],
  [.95,-.78],[.99,-.35],[.88,.17],[.59,.55],[.16,.76],[-.33,.68],[-.72,.36],[-.95,-.08],
],'#efc85e',[
  layer('#f8e7a1',[[-.64,.19],[-.27,.42],[.17,.48],[.58,.29],[.39,.53],[.1,.62],[-.3,.54]]),
],[
  // A crescent needs its own inner edge: scaling toward its empty center would
  // push the yellow fill outside the ink along the concave rim.
  [-.81,-.2],[-.64,.1],[-.23,.30],[.20,.31],[.62,.11],[.81,-.25],[.85,-.58],
  [.89,-.32],[.78,.13],[.51,.46],[.13,.64],[-.29,.57],[-.63,.29],[-.83,-.06],
]);
const citrus=visual('citrus',[
  [-.95,-.15],[-.78,-.64],[-.31,-.94],[.2,-.98],[.68,-.72],[.96,-.24],
  [.93,.3],[.58,.76],[.08,.97],[-.48,.84],[-.85,.43],
],'#f5e4a1',[
  layer('#e5b94f',[[-.12,-.13],[-.6,-.58],[-.26,-.77],[.1,-.79]]),
  layer('#e5b94f',[[.1,-.13],[.28,-.77],[.65,-.52],[.77,-.16]]),
  layer('#e5b94f',[[.17,.07],[.78,.04],[.64,.46],[.29,.72]]),
  layer('#e5b94f',[[-.02,.18],[.09,.79],[-.31,.71],[-.66,.43]]),
  layer('#e5b94f',[[-.2,.04],[-.77,.24],[-.78,-.17],[-.68,-.39]]),
]);
const tomato=visual('tomato',[
  [-.91,-.15],[-.77,-.57],[-.4,-.71],[-.07,-.6],[.3,-.74],[.72,-.59],
  [.94,-.19],[.88,.39],[.55,.77],[.06,.91],[-.47,.77],[-.84,.37],
],'#d87564',[
  layer('#668257',[[0,-.98],[.14,-.63],[.55,-.8],[.3,-.39],[.51,-.21],[.09,-.31],[-.18,-.08],[-.24,-.42],[-.6,-.55],[-.19,-.62]]),
]);
const mango=visual('mango',[
  [-.15,-.94],[.38,-.9],[.78,-.57],[.96,-.1],[.85,.38],[.48,.79],
  [-.02,.93],[-.5,.75],[-.8,.39],[-.89,-.1],[-.67,-.55],
],'#efb64e',[
  layer('#f8d57b',[[-.59,-.49],[-.17,-.53],[-.14,-.1],[-.57,-.06]]),
  layer('#f8d57b',[[.03,-.55],[.37,-.59],[.59,-.32],[.48,-.15],[.06,-.1]]),
  layer('#f8d57b',[[-.55,.12],[-.13,.09],[-.08,.57],[-.38,.64],[-.61,.32]]),
  layer('#f8d57b',[[.09,.08],[.57,.02],[.51,.5],[.13,.56]]),
]);
const avocado=visual('avocado',[
  [-.29,-.94],[.14,-.99],[.4,-.71],[.47,-.3],[.76,.17],[.79,.59],
  [.51,.91],[.03,1],[-.48,.87],[-.77,.51],[-.69,.05],[-.44,-.4],
],'#83a269',[
  layer('#d8dca0',[[-.2,-.75],[.08,-.8],[.24,-.56],[.28,-.16],[.56,.23],[.6,.52],[.38,.71],[.02,.8],[-.35,.67],[-.58,.44],[-.5,.14],[-.28,-.29]]),
  layer('#996748',[[-.26,.11],[.04,-.01],[.29,.13],[.36,.43],[.19,.64],[-.11,.64],[-.33,.42]]),
]);

/** Exact labels and their existing shape guard: sauces, mixtures and unknowns
 * retain the old renderer. This is presentation only; catalog/save types stay put. */
export function ingredientVisual(ingredient:string,shape:Shape):IngredientVisual|null {
  if(shape==='greens')return ingredient==='酪梨'?avocado:null;
  if(shape!=='fruit')return null;
  switch(ingredient){
    case '香蕉':return banana;
    case '檸檬':case '柚子片':return citrus;
    case '番茄':return tomato;
    case '芒果':case '芒果丁':return mango;
    default:return null;
  }
}

// Match the existing fruit glyph footprint so eight slices do not cover each other.
export function ingredientPolygonPoints(points:readonly Point[]):string {
  return points.map(([x,y])=>`${x*26},${y*26}`).join(' ');
}
