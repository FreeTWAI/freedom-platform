import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ingredientVisual,ingredientPolygonPoints} from '../../apps/portal-web/src/games/cooking/ingredient-visuals';
import {RECIPES,type Shape} from '../../apps/portal-web/src/games/cooking/catalog';

const cases=[['香蕉','fruit','banana'],['檸檬','fruit','citrus'],['柚子片','fruit','citrus'],['番茄','fruit','tomato'],['芒果','fruit','mango'],['芒果丁','fruit','mango'],['酪梨','greens','avocado']] as const;
test('ingredient visuals match only explicit labels and their existing shape',()=>{
  for(const [label,shape,id] of cases){
    assert.equal(ingredientVisual(label,shape)?.id,id);
    assert.equal(ingredientVisual(label,'cream'),null);
    assert.equal(ingredientVisual(label,shape==='greens'?'fruit':'greens'),null);
    for(const changed of [` ${label}`,`${label} `,`${label}醬`,`${label}與生菜`])assert.equal(ingredientVisual(changed,shape),null);
  }
  for(const label of ['__proto__','constructor','toString','','番茄醬','香蕉奶昔','酪梨與番茄','新鮮蔬菜']){
    for(const shape of ['fruit','greens','meat','dough'] as Shape[])assert.equal(ingredientVisual(label,shape),null);
  }
});
test('actual catalog keeps all seven covered steps and every other label on the fallback',()=>{
  const covered=RECIPES.flatMap(recipe=>recipe.steps.flatMap((step,index)=>ingredientVisual(step.ingredient,step.shape)?[`${recipe.id}/${index}`]:[]));
  assert.deepEqual(covered,['fish-and-chips/3','seafood-paella/0','yuzu-soda/0','banana-smoothie/0','mango-shaved-ice/0','mango-shaved-ice/1','avocado-toast/0']);
  assert.equal(RECIPES.length,66);
});
test('shared original contours are finite, nondegenerate, bounded and modest',()=>{
  for(const [label,shape] of cases){
    const visual=ingredientVisual(label,shape)!;
    assert.ok(visual.layers.length>=2&&visual.layers.length<=7,label);
    assert.ok(new Set(visual.layers.map(layer=>layer.color)).size<=4,'at most four opaque batch materials');
    for(const layer of visual.layers){
      assert.match(layer.color,/^#[0-9a-f]{6}$/);
      assert.ok(layer.points.length>=3&&layer.points.length<=16);
      let area=0;
      layer.points.forEach(([x,y],i)=>{
        assert.ok(Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x)<=1&&Math.abs(y)<=1);
        const [nextX,nextY]=layer.points[(i+1)%layer.points.length];area+=x*nextY-y*nextX;
      });
      assert.ok(Math.abs(area)>.01,'each filled contour has area');
      const svg=ingredientPolygonPoints(layer.points).split(' ').map(pair=>pair.split(',').map(Number));
      assert.deepEqual(svg,layer.points.map(([x,y])=>[x*26,y*26]),'SVG uses the same complete contour, not an independent glyph');
    }
  }
});
test('contours have no self intersections and concave banana remains a crescent',()=>{
  const cross=(a:readonly number[],b:readonly number[],c:readonly number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(const [label,shape] of cases)for(const {points} of ingredientVisual(label,shape)!.layers){
    for(let i=0;i<points.length;i++)for(let j=i+2;j<points.length;j++){
      if(i===0&&j===points.length-1)continue;
      const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
      assert.ok(!(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0),`${label}: crossing edges ${i}/${j}`);
    }
  }
  const banana=ingredientVisual('香蕉','fruit')!.layers[0].points;
  const turns=banana.map((p,i)=>cross(p,banana[(i+1)%banana.length],banana[(i+2)%banana.length]));
  assert.ok(turns.some(n=>n>0)&&turns.some(n=>n<0),'banana is not another oval or berry');
});
test('shared visual data is deeply immutable and calls reuse the same definitions',()=>{
  for(const [label,shape] of cases){
    const visual=ingredientVisual(label,shape)!;
    assert.equal(ingredientVisual(label,shape),visual);
    assert.ok(Object.isFrozen(visual)&&Object.isFrozen(visual.layers));
    for(const layer of visual.layers){assert.ok(Object.isFrozen(layer)&&Object.isFrozen(layer.points));for(const point of layer.points)assert.ok(Object.isFrozen(point));}
    const before=JSON.stringify(visual);ingredientPolygonPoints(visual.layers[0].points);assert.equal(JSON.stringify(visual),before);
  }
});
