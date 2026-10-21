import {useEffect,useId,useRef,useState} from 'react';
import {ACCENT_PRESETS,AnnouncementSchema,StorefrontAppearanceInputSchema,type AppearanceRole,type StorefrontAppearanceDraft} from '../../../../contracts/guild-launchpad/v1/storefront-appearance';
import {prepareBrowserRaster,socialImageProblem} from '../../../../packages/asset-storage/browser-raster';
import {ApiError,type PortalClient} from '../api';
import {sendAppearanceAttempt} from './hosted-store-appearance-client';
import {appearanceFields,forgetRefusedAppearanceAttempt,heldAppearanceAttempt,holdAppearanceAttempt,releaseAppearanceAttempt,
  restoreAppearanceAttempt,retainedAppearanceFailure,reviewAppearanceAttempt,type AppearanceAttempt,type AppearanceFields} from './hosted-store-appearance-state';
import './HostedStoreAppearance.css';

const names={cover:'封面圖',logo:'店標'} as const;
const fields=(draft:StorefrontAppearanceDraft)=>appearanceFields({template_id:draft.template_id,accent_preset:draft.accent_preset,
  announcement:draft.announcement,featured_product_ids:draft.featured_product_ids});
const equal=(a:AppearanceFields,b:AppearanceFields)=>JSON.stringify(a)===JSON.stringify(b);
export function HostedStoreAppearance({client,userId,tenantId,instanceId,draft,writable,locked,onState,onSaved}:{
  client:PortalClient;userId:string;tenantId:string;instanceId:string;draft:StorefrontAppearanceDraft;writable:boolean;locked:boolean;
  onState:(dirty:boolean,blocking:boolean)=>void;onSaved:()=>Promise<void>;
}){
  const [restored]=useState(()=>restoreAppearanceAttempt(client,userId,{tenantId,instanceId}));
  const [value,setValue]=useState<AppearanceFields>(()=>restored?.kind==='settings'?restored.body:fields(draft));
  const [files,setFiles]=useState<Record<AppearanceRole,File|null>>(()=>({cover:restored?.kind==='cover'?restored.file:null,logo:restored?.kind==='logo'?restored.file:null}));
  const [attempt,setAttempt]=useState<AppearanceAttempt|null>(restored),[phase,setPhase]=useState<'idle'|'sending'|'unknown'|'review'|'rejected'>(restored?'unknown':'idle');
  const [message,setMessage]=useState(restored?'原外觀操作仍待確認。重新登入不會自動重送，請重試原操作。':'');
  const [preparing,setPreparing]=useState<AppearanceRole|null>(null),[selected,setSelected]=useState(''),[failedPaths,setFailedPaths]=useState<string[]>([]);
  const [previews,setPreviews]=useState<Record<string,string>>({});
  const id=useId(),busy=useRef(false),mounted=useRef(false),generation=useRef(client.sessionGeneration),serial=useRef(0),held=useRef(attempt);
  const stateRef=useRef(onState);stateRef.current=onState;
  const metadataDirty=!equal(value,fields(draft)),localImages=Boolean(files.cover||files.logo||preparing);
  const announcementInvalid=!AnnouncementSchema.safeParse(value.announcement).success;
  const blocking=phase==='sending'||phase==='unknown',frozen=locked||blocking||phase==='review'||preparing!==null;
  const current=()=>mounted.current&&generation.current===client.sessionGeneration;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;serial.current++;stateRef.current(false,false);};},[]);
  useEffect(()=>{stateRef.current(metadataDirty||localImages||attempt!==null,blocking);},[metadataDirty,localImages,attempt,blocking]);
  useEffect(()=>{
    const urls:Record<string,string>={};for(const role of ['cover','logo'] as const)if(files[role])urls[role]=URL.createObjectURL(files[role]!);
    setPreviews(urls);return()=>Object.values(urls).forEach(url=>URL.revokeObjectURL(url));
  },[files]);
  const previousVersion=useRef(draft.version),baseline=useRef(fields(draft));
  useEffect(()=>{
    if(previousVersion.current!==draft.version){
      previousVersion.current=draft.version;if(equal(value,baseline.current)&&!held.current)setValue(fields(draft));baseline.current=fields(draft);
    }
  },[draft,value]);
  function change(patch:Partial<AppearanceFields>){setValue(old=>({...old,...patch}));}
  function title(productId:string){return draft.eligible_products.find(p=>p.product_id===productId)?.title
    ??draft.featured_products.find(p=>p.product_id===productId)?.title??'商品已不在目前目錄';}
  async function choose(role:AppearanceRole,file:File){
    if(frozen||!writable||held.current?.hadUnknown)return;
    const error=socialImageProblem(file);if(error){setMessage(error);return;}
    const ticket=++serial.current;setPreparing(role);setMessage('正在裝置上準備圖片…');
    try{
      // Both small and large sources use the existing device-side WebP pipeline.
      const prepared=await prepareBrowserRaster(file);
      if(!current()||ticket!==serial.current)return;
      if(role==='logo'){
        const bitmap=await createImageBitmap(prepared);try{if(bitmap.width!==bitmap.height)throw Error('店標請使用正方形圖片。');}finally{bitmap.close();}
      }
      if(!current()||ticket!==serial.current)return;
      setFiles(old=>({...old,[role]:prepared}));setMessage('圖片準備好了，儲存後才會上傳。');
    }catch(error){if(current()&&ticket===serial.current)setMessage(error instanceof Error?error.message:'這張圖片暫時無法處理，請重新選取或換一張照片。');}
    finally{if(current()&&ticket===serial.current)setPreparing(null);}
  }
  async function send(original:AppearanceAttempt){
    if(busy.current)return;busy.current=true;held.current=original;setAttempt(original);setPhase('sending');
    holdAppearanceAttempt(client,userId,original);onState(true,true);
    setMessage(original.kind==='settings'?'正在儲存店面外觀…':`正在儲存${names[original.kind]}…`);
    try{
      const ack=await sendAppearanceAttempt(client,original);releaseAppearanceAttempt(client,userId,original);
      if(!current())return;
      held.current=null;setAttempt(null);
      if(original.kind==='settings')setValue(fields(ack.current));
      else setFiles(old=>({...old,[original.kind]:null}));
      await onSaved();if(!current())return;setPhase('idle');
      setMessage(original.kind==='settings'?'已儲存店面外觀。重新發布後，公開頁才會更新。'
        :ack.changed?`已儲存${names[original.kind]}變更。重新發布後，公開頁才會更新。`:`已經沒有草稿${names[original.kind]}。`);
    }catch(error){
      const unknown=!(error instanceof ApiError)||error.network||error.timedOut||error.accessExpired;
      const retained=retainedAppearanceFailure(original,unknown||heldAppearanceAttempt(client,userId,original)?.hadUnknown===true);
      if(retained.hadUnknown)holdAppearanceAttempt(client,userId,retained);else forgetRefusedAppearanceAttempt(client,userId,original);
      if(!current())return;
      held.current=retained;setAttempt(retained);
      if(retained.hadUnknown){setPhase('unknown');setMessage(original.kind==='settings'
        ?'尚未確認原操作結果。原設定仍保留，請重試確認後再離開。':'尚未確認原操作結果。圖片與原操作仍保留，請重試確認後再離開。');}
      else if(error instanceof ApiError&&error.status===412){setPhase('review');setMessage('商店資料已更新，變更仍保留。請核對最新外觀後，再明確確認套用。');await onSaved();}
      else{setPhase('rejected');setMessage(error instanceof Error?error.message:'店面外觀操作未完成。');}
    }finally{busy.current=false;}
  }
  function freshSettings(){
    if(frozen||!writable||!metadataDirty||held.current?.hadUnknown)return;
    const parsed=StorefrontAppearanceInputSchema.safeParse({...value,announcement:value.announcement.trim()});
    if(!parsed.success){setMessage(parsed.error.issues[0]?.message==='公告列最多 80 個字。'?'公告列最多 80 個字。':'請檢查公告是否為單行文字，並最多選擇 8 件不重複的主打商品。');return;}
    void send(Object.freeze({tenantId,instanceId,kind:'settings',body:appearanceFields(parsed.data),key:crypto.randomUUID(),expected:draft.version,hadUnknown:false}));
  }
  function freshImage(role:AppearanceRole,action:'upload'|'remove'){
    if(frozen||metadataDirty||!writable||held.current?.hadUnknown||!draft.media_installed||(action==='upload'&&(!files[role]||!draft.uploads_enabled)))return;
    void send(Object.freeze({tenantId,instanceId,kind:role,action,file:action==='upload'?files[role]:null,key:crypto.randomUUID(),expected:draft.version,hadUnknown:false}));
  }
  function move(productId:string,direction:number){
    const ids=[...value.featured_product_ids],index=ids.indexOf(productId),next=index+direction;
    if(index<0||next<0||next>=ids.length)return;
    [ids[index],ids[next]]=[ids[next],ids[index]];change({featured_product_ids:ids});setMessage(`已將「${title(productId)}」移到第 ${next+1} 項。`);
    requestAnimationFrame(()=>document.getElementById(id+'-featured-'+productId)?.focus());
  }
  const retryName=attempt?.kind==='settings'?'重試原外觀操作':attempt?`重試原${names[attempt.kind]}操作`:'';
  const reviewName=attempt?.kind==='settings'?'確認以最新版本儲存外觀':attempt?`確認以最新版本套用${names[attempt.kind]}變更`:'';
  const recovery=(phase==='unknown'||phase==='review')?<div className="hosted-appearance-recovery stack">
    {message&&<p role="status" className="field-hint">{message}</p>}
    {phase==='unknown'&&attempt&&<div className="actions"><button type="button" className="btn btn-ghost" onClick={()=>void send(attempt)}>{retryName}</button></div>}
    {phase==='review'&&attempt&&<div className="stack"><p className="field-hint">目前外觀版本：{draft.version}。公告列：{draft.announcement||'未設定'}；主色：{ACCENT_PRESETS.find(p=>p.id===draft.accent_preset)?.name}。</p>
      <p className="field-hint">版型：{draft.template_id==='catalog-list-v1'?'直列目錄':'格狀目錄'}；主打商品：{draft.featured_products.map(p=>p.title??'商品已不在目前目錄').join('、')||'未設定'}。</p>
      <div className="actions"><button type="button" className="btn btn-ghost" disabled={locked||!writable||draft.version===attempt.expected||(attempt.kind!=='settings'&&attempt.action==='upload'&&!draft.uploads_enabled)} onClick={()=>void send(reviewAppearanceAttempt(attempt,draft.version,crypto.randomUUID()))}>{reviewName}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={()=>void onSaved()}>重新讀取店面外觀</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={()=>{if(attempt.kind==='settings')setValue(fields(draft));else setFiles(old=>({...old,[attempt.kind]:null}));held.current=null;setAttempt(null);setPhase('idle');setMessage('已取消這次外觀變更。');}}>取消這次外觀變更</button></div>
    </div>}
  </div>:null;
  return <section className="hosted-store-appearance stack" aria-labelledby={id+'-title'}>
    <h4 id={id+'-title'}>店面外觀</h4>
    <p className="field-hint">先儲存草稿，再預覽與發布。公開頁會保留目前發布的版本。</p>
    {!writable&&<p>你目前只有檢視權限，無法修改店面外觀。</p>}
    {writable?<fieldset className="hosted-appearance-fields stack" disabled={frozen}>
      <legend>版型與品牌</legend>
      <fieldset className="hosted-store-templates"><legend>商店版型</legend>
        {([['catalog-grid-v1','格狀目錄','商品並排展示，手機改為單欄。'],['catalog-list-v1','直列目錄','商品逐項排列，方便閱讀較長說明。']] as const).map(([key,label,hint])=><label key={key}>
          <input type="radio" name={id+'-template'} checked={value.template_id===key} onChange={()=>change({template_id:key})}/><span>{label}<small>{hint}</small></span></label>)}
      </fieldset>
      <fieldset className="hosted-appearance-fields"><legend>主色</legend><div className="hosted-appearance-swatches">
        {ACCENT_PRESETS.map(preset=><label key={preset.id}><input type="radio" name={id+'-accent'} checked={value.accent_preset===preset.id} onChange={()=>change({accent_preset:preset.id})}/>
          <span aria-hidden="true" className="hosted-appearance-swatch" style={{background:preset.fill,borderColor:preset.border,color:preset.text}}>Aa</span><span>{preset.name}</span></label>)}
      </div></fieldset>
      <label className="field">公告列<input value={value.announcement} aria-invalid={announcementInvalid||undefined} aria-describedby={id+'-announcement-hint'+(announcementInvalid?' '+id+'-announcement-error':'')} onChange={event=>change({announcement:event.target.value})}/></label>
      <p id={id+'-announcement-hint'} className="field-hint">單行純文字，最多 80 個字。{[...value.announcement.trim()].length}／80</p>
      {announcementInvalid&&<p id={id+'-announcement-error'} role="alert">公告列最多 80 個字，請使用單行純文字。</p>}
      <fieldset className="hosted-appearance-fields stack"><legend>主打商品</legend>
        <p className="field-hint">最多 8 件，依下列順序顯示在完整目錄前。</p>
        {draft.has_supplied_products&&<p className="field-hint">主打商品目前只能選自有商品。</p>}
        {value.featured_product_ids.length?<ol className="hosted-appearance-featured">{value.featured_product_ids.map((productId,index)=><li key={productId}>
          <span id={id+'-featured-'+productId} tabIndex={-1}>{title(productId)}</span>
          {!draft.eligible_products.some(p=>p.product_id===productId)&&<p className="field-hint">這項商品已不在目前目錄，發布時不會顯示。</p>}
          {writable&&<div className="actions"><button type="button" className="btn btn-ghost btn-sm" aria-label={'上移主打商品：'+title(productId)} disabled={index===0} onClick={()=>move(productId,-1)}>上移</button>
            <button type="button" className="btn btn-ghost btn-sm" aria-label={'下移主打商品：'+title(productId)} disabled={index===value.featured_product_ids.length-1} onClick={()=>move(productId,1)}>下移</button>
            <button type="button" className="btn btn-ghost btn-sm" aria-label={'移除主打商品：'+title(productId)} onClick={()=>{
              change({featured_product_ids:value.featured_product_ids.filter(key=>key!==productId)});setMessage(`已移除主打商品「${title(productId)}」。`);
              requestAnimationFrame(()=>document.getElementById(id+'-product')?.focus());
            }}>移除</button></div>}
        </li>)}</ol>:<p>尚未設定主打商品。</p>}
        {writable&&(draft.eligible_products.length?<><label className="field">選擇主打商品<select id={id+'-product'} value={selected} disabled={value.featured_product_ids.length>=8} onChange={event=>setSelected(event.target.value)}>
          <option value="">請選擇商品</option>{draft.eligible_products.filter(p=>!value.featured_product_ids.includes(p.product_id)).map(p=><option value={p.product_id} key={p.product_id}>{p.title}</option>)}</select></label>
          <div className="actions"><button type="button" className="btn btn-ghost btn-sm" disabled={!selected||value.featured_product_ids.length>=8} onClick={()=>{
            if(!selected||value.featured_product_ids.includes(selected))return;change({featured_product_ids:[...value.featured_product_ids,selected]});setSelected('');
          }}>加入主打商品</button></div></>:<p>先新增並開放自有商品的零售展示，再設定主打商品。</p>)}
      </fieldset>
      {writable&&<div className="actions"><button type="button" className="btn btn-ghost" disabled={!metadataDirty} onClick={freshSettings}>儲存店面外觀</button>
        {(metadataDirty||attempt?.kind==='settings')&&phase!=='review'&&<button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setValue(fields(draft));if(attempt?.kind==='settings'){held.current=null;setAttempt(null);setPhase('idle');}setMessage('已取消這次外觀變更。');}}>取消外觀變更</button>}</div>}
    </fieldset>:<dl className="detail-list">
      <div><dt>商店版型</dt><dd>{draft.template_id==='catalog-list-v1'?'直列目錄':'格狀目錄'}</dd></div>
      <div><dt>主色</dt><dd>{ACCENT_PRESETS.find(p=>p.id===draft.accent_preset)?.name}</dd></div>
      <div><dt>公告列</dt><dd>{draft.announcement||'未設定'}</dd></div>
      <div><dt>主打商品</dt><dd>{draft.featured_products.length?<ol>{draft.featured_products.map(p=><li key={p.product_id}>{p.title??'商品已不在目前目錄'}</li>)}</ol>:'尚未設定主打商品。'}</dd></div>
    </dl>}
    {attempt?.kind==='settings'&&recovery}
    {blocking&&attempt?.kind!=='settings'&&<p className="field-hint">請先確認圖片操作結果，再儲存店面外觀。</p>}
    {blocking&&attempt?.kind==='settings'&&<p className="field-hint">請先確認外觀操作結果，再儲存圖片變更。</p>}
    {preparing&&<p className="field-hint">正在裝置上準備{names[preparing]}，完成後即可繼續。</p>}
    {!draft.media_installed?<p>店面圖片功能目前未啟用，仍可調整主色、公告與主打商品。</p>:<>
      {!draft.uploads_enabled&&<p>圖片上傳目前未啟用；已儲存圖片仍可預覽或移除。</p>}
      <div className="hosted-appearance-images">{(['cover','logo'] as const).map(role=>{
        const image=draft[role],file=files[role];return <section className="hosted-appearance-image stack" aria-label={names[role]} key={role}>
          <h5>{names[role]}</h5>
          {image&&!failedPaths.includes(image.read_path)?<img className={'hosted-appearance-saved '+role} src={image.read_path} alt={'已儲存的'+names[role]} width={image.width} height={image.height} onError={()=>setFailedPaths(old=>[...old,image.read_path])}/>
            :<p>{image?`${names[role]}暫時無法讀取。`:`尚未加入${names[role]}。`}</p>}
          {role==='cover'?<p className="field-hint">建議使用橫式圖片，例如 16:9 或 3:2。</p>:<p className="field-hint">請使用正方形圖片；圖片會完整顯示。</p>}
          {writable&&<>
            {draft.uploads_enabled&&<><label className="field">{names[role]}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={frozen} onChange={event=>{const chosen=event.target.files?.[0];event.target.value='';if(chosen)void choose(role,chosen);}}/></label>
              <p className="field-hint">PNG、JPEG 或 WebP，原始圖片最多 20 MB；圖片會在裝置上自動縮小。先看完整預覽，再儲存；公開頁需重新發布。</p></>}
            {file&&<p className="field-hint">已選擇：{file.name}</p>}
            {file&&previews[role]&&<figure className="hosted-photo-draft"><img src={previews[role]} alt={'待儲存的完整'+names[role]}/><figcaption>裝置上的預覽・{(file.size/1024/1024).toFixed(2)} MB・{phase==='unknown'?'儲存結果尚未確認':'尚未儲存'}</figcaption></figure>}
            <div className="actions">
              {file&&draft.uploads_enabled&&<button type="button" className="btn btn-ghost btn-sm" disabled={frozen||metadataDirty} onClick={()=>freshImage(role,'upload')}>{image?'儲存替換'+names[role]:'儲存'+names[role]}</button>}
              {image&&<button type="button" className="btn btn-ghost btn-sm" disabled={frozen||metadataDirty} onClick={()=>{if(window.confirm(`移除草稿${names[role]}？公開頁會保留到重新發布。`))freshImage(role,'remove');}}>移除{names[role]}</button>}
              {(file||attempt?.kind===role)&&phase!=='review'&&<button type="button" className="btn btn-ghost btn-sm" disabled={frozen} onClick={()=>{setFiles(old=>({...old,[role]:null}));if(attempt?.kind===role){held.current=null;setAttempt(null);setPhase('idle');}setMessage(`已取消這次${names[role]}變更。`);}}>取消{names[role]}變更</button>}
            </div>
            {metadataDirty&&(file||image)&&<p className="field-hint">請先儲存店面外觀，再儲存圖片變更。</p>}
          </>}
          {attempt?.kind===role&&recovery}
        </section>;
      })}</div>
    </>}
    {attempt&&attempt.kind!=='settings'&&!draft.media_installed&&recovery}
    {phase!=='unknown'&&phase!=='review'&&message&&<p role="status" className="field-hint">{message}</p>}
  </section>;
}
