import type {Shape} from './catalog';

type Point = readonly [number, number];
export type IngredientLayer = Readonly<{color:string;points:readonly Point[]}>;
export type IngredientVisual = Readonly<{id:'banana'|'citrus'|'tomato'|'mango'|'avocado'|'potato'|'pumpkin'|'sweet-potato'|'mushroom';layers:readonly IngredientLayer[];cutLayers?:readonly IngredientLayer[]}>;
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

// Four original preparation studies. Whole silhouettes and exposed cut faces
// share the existing footprint. No inferred mixtures, textures or random marks.
function preparation(whole:IngredientVisual,cut:IngredientVisual):IngredientVisual {
  return Object.freeze({...whole,cutLayers:cut.layers});
}
const potatoOutline:readonly Point[]=[[-.91,-.2],[-.72,-.65],[-.32,-.84],[.17,-.79],[.62,-.52],[.92,-.13],[.87,.34],[.54,.72],[.05,.87],[-.49,.69],[-.81,.3]];
const potato=preparation(visual('potato',potatoOutline,'#c69a62',[
  layer('#f3dba0',[[-.66,-.36],[-.39,-.61],[.03,-.6],[.32,-.37],[.01,-.4],[-.35,-.38]]),
  layer(ink,[[-.48,.04],[-.31,-.02],[-.27,.07],[-.39,.12]]),
  layer(ink,[[.33,.32],[.47,.27],[.53,.35],[.43,.42]]),
]),visual('potato',potatoOutline,'#c69a62',[
  layer('#f3dba0',inset(potatoOutline,.74)),
  layer('#fff0cc',[[-.46,-.25],[-.22,-.46],[.19,-.34],[.32,-.12],[.03,-.23],[-.26,-.13]]),
]));
const pumpkinOutline:readonly Point[]=[[-.95,-.1],[-.78,-.57],[-.43,-.79],[-.12,-.7],[.14,-.78],[.5,-.71],[.82,-.42],[.96,.02],[.84,.51],[.49,.83],[.09,.91],[-.27,.82],[-.65,.64],[-.88,.31]];
const pumpkin=preparation(visual('pumpkin',pumpkinOutline,'#e6a044',[
  layer('#f3dba0',[[-.31,-.59],[-.49,-.16],[-.48,.34],[-.23,.68],[-.33,.17],[-.31,-.2]]),
  layer('#f3dba0',[[.25,-.58],[.46,-.18],[.49,.29],[.26,.71],[.33,.17],[.29,-.2]]),
  layer('#668257',[[-.14,-.64],[-.18,-.94],[.03,-1],[.18,-.91],[.13,-.67],[.28,-.55],[.02,-.48]]),
]),visual('pumpkin',[
  [-.87,-.58],[.84,-.58],[.93,-.18],[.81,.31],[.5,.7],[.02,.91],[-.47,.73],[-.78,.33],[-.94,-.12],
],'#668257',[
  layer('#e6a044',[[-.76,-.5],[.73,-.5],[.8,-.16],[.69,.27],[.43,.59],[.02,.77],[-.4,.6],[-.67,.27],[-.81,-.12]]),
  layer(ink,[[-.51,-.43],[.5,-.43],[.47,-.05],[.22,.23],[-.03,.36],[-.3,.2],[-.5,-.1]]),
  layer('#f3dba0',[[-.32,-.23],[-.16,-.28],[-.12,-.12],[-.2,.05],[-.3,-.06]]),
  layer('#f3dba0',[[.13,-.22],[.29,-.3],[.34,-.14],[.24,.04],[.13,-.03]]),
]));
const sweetPotato=preparation(visual('sweet-potato',[
  [-.97,.57],[-.74,.05],[-.44,-.45],[-.05,-.77],[.42,-.88],[.9,-.75],[.83,-.31],[.56,.21],[.16,.59],[-.3,.82],[-.71,.83],
],'#a65f68',[
  layer('#f8dfa0',[[-.65,.36],[-.38,-.25],[-.02,-.54],[.41,-.66],[.12,-.4],[-.21,-.04],[-.47,.45]]),
  layer(ink,[[.16,.18],[.3,.09],[.37,.15],[.24,.25]]),
]),visual('sweet-potato',[
  [-.82,-.42],[-.4,-.78],[.08,-.84],[.55,-.6],[.86,-.16],[.79,.33],[.42,.74],[-.04,.88],[-.51,.66],[-.85,.19],
],'#a65f68',[
  layer('#efbd5c',[[-.67,-.34],[-.32,-.63],[.07,-.68],[.44,-.48],[.7,-.13],[.64,.27],[.34,.6],[-.03,.71],[-.41,.53],[-.69,.15]]),
  layer('#f8dfa0',[[-.41,-.25],[-.2,-.43],[.08,-.38],[.21,-.2],[-.02,-.26],[-.24,-.12]]),
]));
const mushroomOutline:readonly Point[]=[[-.98,.03],[-.86,-.42],[-.54,-.78],[-.08,-.95],[.38,-.83],[.78,-.49],[.97,-.06],[.83,.19],[.31,.29],[.38,.79],[.2,.96],[-.24,.96],[-.39,.77],[-.3,.29],[-.78,.23]];
const mushroom=preparation(visual('mushroom',mushroomOutline,'#f3dfb7',[
  layer('#aa7753',[[-.86,.02],[-.74,-.37],[-.45,-.66],[-.08,-.82],[.32,-.71],[.66,-.41],[.83,-.04],[.67,.1],[.16,.02],[-.34,.12],[-.72,.1]]),
  layer('#f3dfb7',[[-.58,-.35],[-.41,-.55],[-.13,-.65],[.06,-.58],[-.24,-.46],[-.41,-.27]]),
]),visual('mushroom',mushroomOutline,'#aa7753',[
  layer('#f3dfb7',[[-.78,-.05],[-.66,-.39],[-.39,-.63],[-.08,-.77],[.26,-.65],[.59,-.37],[.78,-.04],[.63,.07],[.17,-.02],[.16,.31],[.24,.76],[.14,.83],[-.18,.83],[-.25,.73],[-.16,.28],[-.16,-.02]]),
  layer(ink,[[-.7,.09],[-.27,-.04],[-.2,.05],[-.55,.18]]),
  layer(ink,[[.27,-.04],[.7,.07],[.55,.17],[.2,.05]]),
  layer(ink,[[-.08,.32],[.01,.25],[.05,.69],[-.04,.74]]),
]));

/** A cut face is a projection of a completed slice, never a timer or game rule. */
export function ingredientLayers(visual:IngredientVisual,cut=false):readonly IngredientLayer[] {
  return cut&&visual.cutLayers?visual.cutLayers:visual.layers;
}

/** Exact labels and their existing shape guard: sauces, mixtures and unknowns
 * retain the old renderer. This is presentation only; catalog/save types stay put. */
export function ingredientVisual(ingredient:string,shape:Shape):IngredientVisual|null {
  if(shape==='carrot'){
    switch(ingredient){case '馬鈴薯':return potato;case '南瓜':return pumpkin;case '地瓜':return sweetPotato;default:return null;}
  }
  if(shape==='dough')return ingredient==='蘑菇'?mushroom:null;
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
