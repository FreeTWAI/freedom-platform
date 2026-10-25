import { useId, useState } from 'react';
import type { Recipe, CategoryId } from './catalog';
import { ART_CLIPS } from './art-clips';

export const foodAtlas = (recipe: Recipe) => `/games/absurd-daily/cooking/${recipe.category}.webp`;
export const ART_FRAMES:Record<CategoryId,readonly (readonly [number,number,number,number])[]>={"taiwan":[[26,120,387,265],[441,113,392,274],[898,45,212,349],[1165,131,419,247],[17,448,410,265],[439,441,368,295],[810,472,389,247],[1201,419,391,317]],"japan":[[21,106,402,256],[435,97,377,266],[823,69,390,303],[1233,112,351,284],[15,412,398,309],[418,422,408,280],[825,439,387,261],[1207,402,383,328]],"italy":[[10,104,394,264],[403,102,392,275],[797,101,395,277],[1195,101,396,260],[11,413,391,290],[401,426,410,257],[809,416,391,264],[1199,412,390,292]],"korea":[[18,89,395,305],[418,108,396,267],[816,100,385,292],[1204,112,384,264],[17,451,408,258],[424,414,381,310],[803,428,399,282],[1200,416,391,297]],"world":[[13,104,401,266],[421,77,386,291],[808,111,392,258],[1201,120,391,249],[13,404,401,293],[399,403,423,301],[816,399,376,304],[1189,404,407,297]],"bakery":[[18,92,399,291],[426,118,384,260],[815,122,380,260],[1199,113,385,268],[12,446,403,264],[417,416,392,293],[813,444,389,265],[1202,439,388,270]],"drinks":[[76,61,263,335],[443,109,365,287],[874,61,252,343],[1286,18,235,386],[43,457,354,288],[407,472,407,251],[825,407,338,361],[1191,416,395,356]],"vegetables":[[16,80,392,301],[422,110,385,270],[809,122,386,248],[1198,119,397,252],[12,439,390,296],[400,424,411,287],[805,434,404,283],[1208,419,392,299]]};
export const foodFrame=(recipe:Recipe):readonly [number,number,number,number]=>ART_FRAMES[recipe.category]?.[recipe.art]??[recipe.art%4*400,Math.floor(recipe.art/4)*400,400,400];
/** CK-2/6: explicit source frames exclude neighboring artwork; each keeps its own aspect ratio. */
export function FoodArt({recipe, className = ''}: {recipe: Recipe; className?: string}) {
  const [missing, setMissing] = useState(false),clip=useId().replace(/:/g,'');
  return <div className={`ck-food-art ${className}`}>
    {missing ? <span className="ck-art-fallback">{recipe.name}<small>插畫暫時未載入，仍可開始料理。</small></span> :
      <svg viewBox={foodFrame(recipe).join(' ')} role="img" aria-label={`${recipe.name}・手繪料理插畫`} preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id={clip}><path d={ART_CLIPS[recipe.category][recipe.art]}/></clipPath></defs><image clipPath={`url(#${clip})`} href={foodAtlas(recipe)} width="1600" height="800" onError={() => setMissing(true)} />
      </svg>}
  </div>;
}
