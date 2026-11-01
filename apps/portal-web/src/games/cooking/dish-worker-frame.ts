/** GPU completion plus an intervening worker rendering opportunity. This is not a
 * compositor/screen presentation receipt; native pixel assertions remain required. */
export function waitForDishFrame(canvas:OffscreenCanvas,signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{
  const gl=canvas.getContext('webgl2');
  if(!gl||typeof requestAnimationFrame!=='function'||typeof cancelAnimationFrame!=='function'){reject(Error('Background frame synchronization unavailable'));return;}
  let sync:WebGLSync|null=null,timer:ReturnType<typeof setTimeout>|undefined,pollTimer:ReturnType<typeof setTimeout>|undefined,frame:number|undefined,settled=false;
  const expires=performance.now()+15000;
  const releaseSync=()=>{const owned=sync;sync=null;if(owned)gl.deleteSync(owned);};
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(pollTimer);if(frame!==undefined){try{cancelAnimationFrame(frame);}catch{/* Owner teardown may invalidate its frame provider. */}}signal.removeEventListener('abort',abort);
   try{releaseSync();}catch{/* Context teardown still settles ownership. */}
   error?reject(error):resolve();
  };
  const abort=()=>finish(new DOMException('Preview owner closed','AbortError'));
  const valid=()=>{if(signal.aborted){abort();return false;}try{if(gl.isContextLost()){finish(Error('Background context lost'));return false;}}catch{finish(Error('Background context unavailable'));return false;}if(performance.now()>=expires){finish(Error('Background frame timed out'));return false;}return true;};
  const afterGpu=()=>{if(!valid())return;
   // The first callback precedes its rendering update; the next callback crosses
   // that update rather than acknowledging the draw from its original task.
   try{frame=requestAnimationFrame(()=>{frame=undefined;if(!valid())return;try{frame=requestAnimationFrame(()=>{frame=undefined;if(valid())finish();});}catch{finish(Error('Background frame provider unavailable'));}});}catch{finish(Error('Background frame provider unavailable'));}
  };
  const poll=()=>{pollTimer=undefined;if(!valid())return;
   try{const state=gl.clientWaitSync(sync!,0,0);if(state===gl.ALREADY_SIGNALED||state===gl.CONDITION_SATISFIED){releaseSync();afterGpu();}
    else if(state===gl.TIMEOUT_EXPIRED)pollTimer=setTimeout(poll,16);
    else finish(Error('Background GPU synchronization failed'));
   }catch{finish(Error('Background GPU synchronization failed'));}
  };
  if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>finish(Error('Background frame timed out')),15000);
  try{if(!valid())return;sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);if(!sync){finish(Error('Background GPU fence unavailable'));return;}gl.flush();pollTimer=setTimeout(poll,0);}
  catch{finish(Error('Background GPU synchronization failed'));}
 });
}
