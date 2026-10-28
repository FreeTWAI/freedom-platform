import type {CDPSession,Page,TestInfo} from '@playwright/test';

// Diagnostic only: Node's timer/hrtime and V8 sampling are not page.clock time.
// One CPU window with a 30s stop request and bounded cleanup waits; never changes the action, its assertions or timeout.
export async function withBoundedCpuProfile(page:Page,info:Pick<TestInfo,'attach'>,action:()=>Promise<void>){
 let session:CDPSession|undefined,started=false,startRequested=false,retired=false,timer:ReturnType<typeof setTimeout>|undefined;
 let stop:Promise<void>|undefined,cleanup:Promise<void>|undefined,profile:unknown;
 const bounded=async<T>(work:Promise<T>)=>{let deadline:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(Error('CPU diagnostic command exceeded 5s')),5000);})]);}finally{if(deadline)clearTimeout(deadline);}};
 const errors:string[]=[],begin=process.hrtime.bigint();
 // Stop is queued after the start request, not after its acknowledgement. A timed-out
 // start may still execute: its owning session must receive stop and then detach.
 const finish=()=>stop??=(async()=>{if(startRequested&&session)try{profile=(await bounded(session.send('Profiler.stop'))).profile;}catch(error){errors.push(error instanceof Error&&['Error','TimeoutError','TargetClosedError'].includes(error.name)?error.name:'DiagnosticError');}})();
 const release=()=>{if(!session)return Promise.resolve();return cleanup??=(async()=>{await finish();try{await bounded(session!.detach());}catch(error){errors.push(error instanceof Error&&['Error','TimeoutError','TargetClosedError'].includes(error.name)?error.name:'DiagnosticError');}})();};
 const setup=async()=>{
  const owned=await page.context().newCDPSession(page);session=owned;
  // Even a session delivered after setup/finally timed out retains a cleanup owner.
  if(retired){await release();return;}
  await owned.send('Profiler.enable');if(retired)return;
  await owned.send('Profiler.setSamplingInterval',{interval:10000});if(retired)return;
  startRequested=true;timer=setTimeout(()=>{retired=true;void release();},30000);
  await owned.send('Profiler.start');if(!retired)started=true;
 };
 try{
  try{await bounded(setup());}catch(error){errors.push(error instanceof Error&&['Error','TimeoutError','TargetClosedError'].includes(error.name)?error.name:'DiagnosticError');retired=true;if(timer)clearTimeout(timer);void release();}
  await action();
 }finally{
  retired=true;if(timer)clearTimeout(timer);
  await release();
  const wallMs=Number(process.hrtime.bigint()-begin)/1e6;
  try{
   if(profile){const safe=JSON.parse(JSON.stringify(profile));for(const node of safe.nodes??[]){const frame=node.callFrame;if(frame){const basename=String(frame.url??'').split(/[?#]/)[0].split('/').pop()??'';frame.url=/^[\w.-]*$/.test(basename)?basename:'[script]';}}await bounded(info.attach('kitchen-pan-v8.cpuprofile',{body:Buffer.from(JSON.stringify(safe)),contentType:'application/json'}));}
   await bounded(info.attach('kitchen-pan-profile-metadata.json',{body:Buffer.from(JSON.stringify({samplingIntervalUs:10000,stopRequestedAfterMs:30000,diagnosticAndActionWallMs:wallMs,started,profileObtained:!!profile,errors,limits:'Stop requested after30s; stop and detach each have5s await limits, not a guaranteed capture maximum if CDP stalls. V8 CPU samples only; not GPU time, FPS, native acceptance or uninstrumented performance.'})),contentType:'application/json'}));
  }catch(error){console.warn('CPU profile attachment unavailable.');}
 }
}
