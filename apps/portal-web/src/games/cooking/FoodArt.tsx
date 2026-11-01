import {useEffect,useState} from 'react';
import type {Recipe} from './catalog';

export const foodPreview=(recipe:Recipe)=>`/games/absurd-daily/cooking/3d/${recipe.id}.webp`;
/** UX-8: a real 3D model capture, without opening a WebGL context for every catalog card. */
export function FoodArt({recipe,className=''}:{recipe:Recipe;className?:string}){
 const [missing,setMissing]=useState(false);useEffect(()=>setMissing(false),[recipe.id]);
 return <div className={`ck-food-art ${className}`}>{missing?<span className="ck-art-fallback">{recipe.name}<small>3D預覽暫時未載入，仍可開始料理。</small></span>:<img src={foodPreview(recipe)} alt={`${recipe.name}・實際3D成品預覽`} width="512" height="384" loading="lazy" onError={()=>setMissing(true)}/>}</div>;
}
