import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isSafeInviteUrl} from '../../modules/community-hub/index.js';

test('community-hub: accepts safe invite URLs',()=>{
  for(const host of ['line.me','discord.gg','discord.com','facebook.com'])assert.equal(isSafeInviteUrl(`https://${host}/invite`),true,host);
});

test('community-hub: rejects unsafe invite URLs',()=>{
  for(const url of ['http://line.me/test','https://line.me.evil.test/x','javascript:alert(1)','https://discord.gg@evil.test/x','https://user:pass@facebook.com/x','https://discord.gg:8443/x','//line.me/x'])assert.equal(isSafeInviteUrl(url),false,url);
});
