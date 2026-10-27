import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsLeaveRegistry} from '../../apps/portal-web/src/modules/account-settings-leave.js';

test('independent editor guards cannot replace or release another pending editor',()=>{
  const registry=createSettingsLeaveRegistry();let first=true,second=true;
  const removeFirst=registry.register(()=>!first),removeSecond=registry.register(()=>!second);
  assert.equal(registry.canLeave(),false);
  first=false;assert.equal(registry.canLeave(),false);
  removeFirst();removeFirst();assert.equal(registry.canLeave(),false);
  second=false;assert.equal(registry.canLeave(),true);
  second=true;assert.equal(registry.canLeave(),false);
  removeSecond();assert.equal(registry.canLeave(),true);
});
test('guards read synchronous live pending state, not the last render',()=>{
  const registry=createSettingsLeaveRegistry();const state={pending:false};
  registry.register(()=>!state.pending);assert.equal(registry.canLeave(),true);
  state.pending=true;assert.equal(registry.canLeave(),false);
  state.pending=false;assert.equal(registry.canLeave(),true);
});
test('duplicate callbacks have independent cleanup and broken guards fail closed',()=>{
  const registry=createSettingsLeaveRegistry(),same=()=>false;
  const a=registry.register(same),b=registry.register(same);a();assert.equal(registry.canLeave(),false);b();assert.equal(registry.canLeave(),true);
  const bad=registry.register(()=>{throw Error('guard unavailable');});assert.equal(registry.canLeave(),false);bad();assert.equal(registry.canLeave(),true);
});
test('a new account registry does not inherit the previous account pending state',()=>{
  const old=createSettingsLeaveRegistry(),next=createSettingsLeaveRegistry();old.register(()=>false);
  assert.equal(old.canLeave(),false);assert.equal(next.canLeave(),true);
});

test('actual command store blocks same-stack busy and post-rejection microtask navigation without a React render',async t=>{
  const {PortalClient,ApiError}=await import('../../apps/portal-web/src/api.js');
  const {performModuleMutation}=await import('../../apps/portal-web/src/modules/shared.js');
  const {sharingMutationState,setSharingDraftAccount}=await import('../../apps/portal-web/src/modules/authoring-drafts.js');
  const {settingsMutationBlocksLeave}=await import('../../apps/portal-web/src/modules/account-settings-leave.js');
  setSharingDraftAccount('settings-guard-test',100);
  const state=sharingMutationState({userId:'settings-guard-test',type:'account-settings'}),client=new PortalClient();
  let reject!:(reason:unknown)=>void;
  const blocked=new Promise<never>((_,fail)=>{reject=fail;});
  t.mock.method(client,'post',()=>blocked);
  const operation=performModuleMutation(client,state,'/me/account',{nickname:'test'},3);
  assert.equal(state.listeners.size,0,'no React subscribers or render participates in this test');
  assert.equal(settingsMutationBlocksLeave(state),true,'same synchronous stack sees busy');
  reject(new ApiError({message:'lost response',network:true}));
  assert.equal(await operation,undefined);
  assert.equal(state.snapshot.busy,false);
  assert.equal(settingsMutationBlocksLeave(state),true,'busy finally cleared, but unknown store still blocks in this microtask');
  const registry=createSettingsLeaveRegistry();registry.register(()=>!settingsMutationBlocksLeave(state));
  assert.equal(registry.canLeave(),false);
  setSharingDraftAccount(null,101);
  assert.equal(settingsMutationBlocksLeave(state),false,'invalidated session store no longer controls another account');
});

test('confirmed command failure is distinguished from an unknown response synchronously',async t=>{
  const {PortalClient,ApiError}=await import('../../apps/portal-web/src/api.js');
  const {performModuleMutation}=await import('../../apps/portal-web/src/modules/shared.js');
  const {sharingMutationState,setSharingDraftAccount}=await import('../../apps/portal-web/src/modules/authoring-drafts.js');
  const {settingsMutationBlocksLeave}=await import('../../apps/portal-web/src/modules/account-settings-leave.js');
  setSharingDraftAccount('settings-confirmed-test',102);
  const state=sharingMutationState({userId:'settings-confirmed-test',type:'account-settings'}),client=new PortalClient();
  t.mock.method(client,'post',async()=>{throw new ApiError({message:'conflict',status:412});});
  assert.equal(await performModuleMutation(client,state,'/me/account',{nickname:'test'},3),undefined);
  assert.equal(state.snapshot.lastFailureUnknown,false);
  assert.equal(settingsMutationBlocksLeave(state),false,'dirty draft confirmation remains a separate guard');
  setSharingDraftAccount(null,103);
});
