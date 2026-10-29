import assert from 'node:assert/strict';
import {test} from 'node:test';
import {seasonalDecorationAt, millisecondsUntilTaipeiMidnight} from '../../apps/portal-web/src/seasonal/calendar.js';

const season = (iso: string) => seasonalDecorationAt(new Date(iso));
for (const [start, end, expected] of [
  ['2026-10-24T16:00:00.000Z', '2026-10-31T16:00:00.000Z', 'halloween'],
  ['2026-12-14T16:00:00.000Z', '2026-12-25T16:00:00.000Z', 'christmas'],
  ['2026-12-27T16:00:00.000Z', '2027-01-03T16:00:00.000Z', 'newyear'],
] as const) {
  test(`${expected} switches exactly at Taipei midnight on both boundaries`, () => {
    assert.equal(seasonalDecorationAt(new Date(Date.parse(start)-1)), null);
    assert.equal(season(start), expected);
    assert.equal(seasonalDecorationAt(new Date(Date.parse(end)-1)), expected);
    assert.equal(season(end), null);
  });
}

test('ordinary days, leap days and invalid dates do not create an image', () => {
  for (const iso of ['2026-02-17T00:00:00Z','2028-02-29T12:00:00Z','2026-12-26T04:00:00Z']) assert.equal(season(iso), null);
  assert.equal(seasonalDecorationAt(new Date(NaN)), null);
});

test('the calendar repeats without a hard-coded year', () => {
  assert.equal(season('2030-10-30T23:00:00Z'), 'halloween');
  assert.equal(season('2031-01-01T00:00:00Z'), 'newyear');
});

test('next-midnight delay stays positive through month, leap-day and year rollovers', () => {
  for (const iso of ['2026-12-31T15:59:59.999Z','2028-02-29T15:59:59.999Z','2026-10-31T15:59:59.999Z']) {
    assert.equal(millisecondsUntilTaipeiMidnight(new Date(iso)), 1);
  }
  assert.equal(millisecondsUntilTaipeiMidnight(new Date('2027-01-01T16:00:00Z')), 86_400_000);
  assert.equal(millisecondsUntilTaipeiMidnight(new Date('2026-10-28T00:00:00Z')), 57_600_000);
  assert.equal(millisecondsUntilTaipeiMidnight(new Date(NaN)), 60_000);
});

import {parseSeasonalPreference,readSeasonalPreference,saveSeasonalPreference,resolveSeasonalTheme,SEASONAL_STORAGE_KEY} from '../../apps/portal-web/src/seasonal/preferences.js';
test('manual, auto and off are independent of the base appearance theme',()=>{
 const now=new Date('2026-10-28T00:00:00Z');
 assert.equal(resolveSeasonalTheme('auto',now),'halloween');
 assert.equal(resolveSeasonalTheme('off',now),null);
 assert.equal(resolveSeasonalTheme('christmas',now),'christmas');
 for(const bad of [null,undefined,'dark','__proto__','<img>',42])assert.equal(parseSeasonalPreference(bad),'auto');
});
test('preferences use one local-only key and blocked storage never prevents the visit',()=>{
 const saved:string[][]=[];
 saveSeasonalPreference('off',{setItem:(key,value)=>saved.push([key,value])});
 assert.deepEqual(saved,[[SEASONAL_STORAGE_KEY,'off']]);
 assert.equal(readSeasonalPreference({getItem:()=> 'newyear'}),'newyear');
 assert.equal(readSeasonalPreference({getItem:()=>{throw Error('blocked');}}),'auto');
 assert.doesNotThrow(()=>saveSeasonalPreference('off',{setItem:()=>{throw Error('blocked');}}));
});

import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
test('all three shipped hero assets match their provenance and selected-theme byte budgets',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../../docs/design/seasonal-theme-art-manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.assets.length,3);
 for(const name of ['halloween','christmas','newyear']){
  const entries=manifest.assets.filter((asset:{path:string})=>asset.path.split('/').at(-1)?.startsWith(name));
  assert.equal(entries.length,1);let total=0;
  for(const asset of entries){
   const bytes=readFileSync(new URL('../../'+asset.path,import.meta.url));total+=bytes.length;
   assert.equal(bytes.length,asset.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
   const limit=asset.path.includes('-hero')?102400:asset.path.includes('-edge')?25600:12288;assert.ok(bytes.length<=limit);
  }
  assert.ok(total<=184320);
 }
});

test('seasonal art uses independent contain columns without changing brand or primary tokens',()=>{
 const base=new URL('../../apps/portal-web/src/',import.meta.url);
 const css=readFileSync(new URL('seasonal/SeasonalTheme.css',base),'utf8');
 const ui=readFileSync(new URL('seasonal/SeasonalTheme.tsx',base),'utf8');
 const app=readFileSync(new URL('App.tsx',base),'utf8');
 assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/object-fit:contain/);assert.doesNotMatch(css,/--(?:green|ink|blue|bg|focus)\s*:/);
 assert.doesNotMatch(css,/url\(|animation|background-image/);
 assert.match(ui,/seasonal-art-column/);assert.doesNotMatch(ui,/SeasonalBadge|edge\.webp/);
 assert.match(app,/<img className="brand-home-logo" src="\/brand\/freedom-workshop-compact\.jpeg" alt="自由工坊" width="1536" height="512"\/><\/a>/);
 assert.match(app,/onShare=\{\(\)=>chooseShare\('post'\)\}/);
});
