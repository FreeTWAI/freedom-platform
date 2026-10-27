import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readEventParticipationToken} from '../../apps/portal-web/src/modules/event-participation-token';

const token='Ab09_-'.repeat(7)+'Z';

test('participation capability accepts exactly 43 base64url characters without normalization',()=>{
  for(const value of [token,'a'.repeat(43),'Z'.repeat(43),'0'.repeat(43),'_'.repeat(43),'-'.repeat(43)]){
    assert.equal(readEventParticipationToken(`#participation=${value}`),value);
  }
});

test('participation capability never reads a query, full URL, encoded token or another fragment',()=>{
  for(const hash of ['',token,`participation=${token}`,`?participation=${token}`,`https://example.test/events/1#participation=${token}`,
    `#event/1?participation=${token}`,`#Participation=${token}`,`#participation=${token}&other=1`,
    `#participation=${token}#home`,`#participation=${token}?next=1`,`#participation=${encodeURIComponent('/'.repeat(43))}`,
    `#participation=${'%41'+token.slice(1)}`,`#participation=${token.slice(1)}`,`#participation=${token}a`,
    `#participation=${'/'.repeat(43)}`,`#participation=${'+'.repeat(43)}`,`#participation=${'中'.repeat(43)}`,
    ` #participation=${token}`,`#participation=${token} `,`#participation=${token.slice(0,21)}\n${token.slice(22)}`]){
    assert.equal(readEventParticipationToken(hash),null,JSON.stringify(hash));
  }
});

test('participation capability rejects trailing line terminators and fragment continuations',()=>{
  for(const ending of ['\n','\r','\r\n','\u2028','\u2029']){
    assert.equal(readEventParticipationToken(`#participation=${token}${ending}`),null);
  }
  assert.equal(readEventParticipationToken(`#participation=${token}\n#home`),null);
});
