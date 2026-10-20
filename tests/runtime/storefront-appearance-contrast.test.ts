import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {ACCENT_PRESETS} from '../../contracts/guild-launchpad/v1/storefront-appearance.js';

// Independent WCAG sRGB calculation; no production colour helper is imported.
function luminance(hex:string){
  const c=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;
}
function ratio(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
test('eight named accent presets meet text, component boundary and focus contrast on the existing page',()=>{
  assert.equal(ACCENT_PRESETS.length,8);assert.equal(new Set(ACCENT_PRESETS.map(p=>p.id)).size,8);
  for(const preset of ACCENT_PRESETS){
    assert.ok(preset.name.length>0);assert.ok(ratio(preset.text,preset.fill)>=4.5,preset.id+' text');
    assert.ok(Math.max(ratio(preset.fill,'#f6f8fb'),ratio(preset.border,'#f6f8fb'))>=3,preset.id+' boundary');
    assert.ok(ratio(preset.focus,'#f6f8fb')>=3,preset.id+' focus');
  }
  for(const id of ['lime','gold']){const p=ACCENT_PRESETS.find(p=>p.id===id)!;assert.ok(ratio(p.fill,'#f6f8fb')<3);assert.ok(ratio(p.border,'#f6f8fb')>=3);}
});
test('appearance CSS keeps the old lime fill/text/focus and gates the new border by opt-in markup',()=>{
  const css=readFileSync(new URL('../../apps/portal-web/public/shops.css',import.meta.url),'utf8');
  const lime=ACCENT_PRESETS[0];assert.deepEqual(lime,{id:'lime',name:'萊姆綠（預設）',fill:'#c4ff20',text:'#172200',border:'#537300',focus:'#537300'});
  assert.match(css,/--green: #c4ff20;/);assert.match(css,/a:focus-visible, summary:focus-visible \{ outline: 3px solid #537300/);
  for(const p of ACCENT_PRESETS){
    const selector=p.id==='lime'?'body[data-store-appearance="v1"]':`body[data-shop-accent="${p.id}"]`;
    assert.ok(css.includes(`${selector} { --shop-accent: ${p.fill}; --shop-on-accent: ${p.text}; --shop-accent-border: ${p.border}; --shop-focus: ${p.focus}; }`));
  }
  assert.match(css,/body\[data-store-appearance="v1"\] \.shop-button:not\(\.shop-button-secondary\)/);
});
