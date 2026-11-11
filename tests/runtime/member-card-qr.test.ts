import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {MemberCardQr,memberCardQr} from '../../apps/portal-web/src/modules/MemberCardQr.js';

test('the rendered QR independently decodes to the exact current share URL on both hosts',async()=>{
  for(const origin of ['https://freetwai.com','https://staging.freetwai.com','http://127.0.0.1:4311']){
    const url=`${origin}/member-cards/${randomBytes(32).toString('base64url')}`,qr=memberCardQr(url,origin)!;
    assert.ok(qr);
    const svg=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${qr.size*8}" height="${qr.size*8}" viewBox="0 0 ${qr.size} ${qr.size}"><rect width="${qr.size}" height="${qr.size}" fill="#fff"/><path d="${qr.path}" fill="#08090b"/></svg>`);
    const {data,info}=await sharp(svg).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(jsQR(new Uint8ClampedArray(data),info.width,info.height)?.data,url);
  }
});
test('the emitted QR decodes at its native card size and the larger event size',async()=>{
  const originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  // This synthetic capability reproduced the 128px failure in native Chromium.
  const token='wrElEDlgHqLipHAn7e_0ckLhHVK6iN-oMUHfmoE8tzA';
  try{
    for(const origin of ['http://127.0.0.1:14312','https://freetwai.com','https://staging.freetwai.com']){
      Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{origin}}});
      const url=`${origin}/member-cards/${token}`;
      const markup=renderToStaticMarkup(createElement(MemberCardQr,{url}));
      const svg=markup.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/)?.[0];assert.ok(svg);
      const opening=svg.match(/^<svg\b[^>]*>/)![0];
      const nativeWidth=Number(opening.match(/\bwidth="(\d+)"/)![1]);
      for(const width of [nativeWidth,200]){
        const resized:string=svg.replace(opening,opening.replace(/\b(width|height)="[^"]*"/g,(_,key:string)=>`${key}="${width}"`));
        const {data,info}=await sharp(Buffer.from(resized)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
        assert.equal(jsQR(new Uint8ClampedArray(data),info.width,info.height)?.data,url,`${origin} at ${width}px`);
      }
    }
  }finally{
    if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);
    else Reflect.deleteProperty(globalThis,'window');
  }
});
test('QR rejects unrelated origins, IDs, redirects, queries, credentials and invalid capability paths',()=>{
  const origin='https://freetwai.com',token='x'.repeat(43),path=`/member-cards/${token}`;
  for(const url of [`https://evil.example${path}`,`${origin}${path}?email=secret`,`${origin}${path}#private`,`${origin}/members/123`,`${origin}/member-cards/short`,`https://person:secret@freetwai.com${path}`,'javascript:alert(1)','',path])assert.equal(memberCardQr(url,origin),null,url);
});
