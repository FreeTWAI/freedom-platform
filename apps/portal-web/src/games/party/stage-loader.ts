/** One owner per load attempt, including its live scene. Late imports never construct. */
export function loadPartyStage<T extends {dispose:()=>void}>(options:{
  load:()=>Promise<(lost:()=>void)=>T>;
  install:(stage:T)=>void;
  ready:()=>void;
  failed:(reason:'timeout'|'load'|'lost')=>void;
  timeoutMs:number;
  schedule?:(callback:()=>void,ms:number)=>unknown;
  clear?:(timer:unknown)=>void;
}) {
  let active=true,owned:T|null=null;
  const schedule=options.schedule??((fn,ms)=>setTimeout(fn,ms));
  const clear=options.clear??(timer=>clearTimeout(timer as ReturnType<typeof setTimeout>));
  let timer:unknown;
  const dispose=()=>{const value=owned;owned=null;try{value?.dispose();}catch{/* A lost device must not block recovery. */}};
  const cancel=()=>{active=false;clear(timer);dispose();};
  const fail=(reason:'timeout'|'load'|'lost')=>{if(!active)return;cancel();options.failed(reason);};
  timer=schedule(()=>fail('timeout'),options.timeoutMs);
  void Promise.resolve().then(()=>active?options.load():null).then(create=>{
    if(!active||!create)return;
    const created=create(()=>fail('lost'));
    if(!active){try{created.dispose();}catch{}return;}
    owned=created;
    options.install(created);
    if(!active)return;
    clear(timer);options.ready();
  }).catch(()=>fail('load'));
  return {cancel,fail};
}
