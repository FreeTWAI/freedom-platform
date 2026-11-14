import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safePortalReturn} from '../../apps/portal-web/src/portal-route';
import {safeGoogleEntry} from '../../apps/portal-web/src/modules/GoogleSignIn';
import {acceptedPortalReturns,refusedPortalReturns} from '../fixtures/portal-return-cases';
Object.assign(globalThis,{window:{location:{origin:'https://portal.invalid'}}});
test('portal and Google accept the same resolvable return addresses',()=>{
 for(const value of acceptedPortalReturns){assert.equal(safePortalReturn(value),true,value);assert.equal(safeGoogleEntry('/'+value),'/'+value,value);}
});
test('portal and Google refuse unsafe or unresolvable addresses',()=>{
 for(const value of refusedPortalReturns){assert.equal(safePortalReturn(value),false,value);assert.equal(safeGoogleEntry(value.startsWith('#')?'/'+value:value),null,value);}
});
