import {useEffect,useId,useRef,useState} from 'react';
import {POLICY_KINDS,POLICY_LABELS,POLICY_CHECKLISTS,SELLER_FIELDS,SellerPoliciesInputSchema,normalizeSellerPolicies,SellerPoliciesWireSchema,type SellerPoliciesDraft,type SellerPoliciesInput,type PolicyKind,type PolicyDraft} from '../../../../contracts/guild-launchpad/v1/storefront-policies';
import {ApiError,type PortalClient} from '../api';
import {sendPoliciesAttempt} from './hosted-store-policies-client';
import {policiesFields,frozenPolicyFields,heldPoliciesAttempt,holdPoliciesAttempt,restorePoliciesAttempt,releasePoliciesAttempt,retainedPoliciesFailure,reviewPoliciesAttempt,type PoliciesAttempt} from './hosted-store-policies-state';
import './HostedStorePolicies.css';
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function HostedStorePolicies({client,userId,tenantId,instanceId,draft,writable,locked,onState,onSaved}:{client:PortalClient;userId:string;tenantId:string;instanceId:string;draft:SellerPoliciesDraft;writable:boolean;locked:boolean;onState:(dirty:boolean,blocking:boolean)=>void;onSaved:()=>Promise<void>}){
 const [restored]=useState(()=>restorePoliciesAttempt(client,userId,{tenantId,instanceId}));
 const [value,setValue]=useState<SellerPoliciesInput>(()=>restored?.body??policiesFields(draft)),[attempt,setAttempt]=useState<PoliciesAttempt|null>(restored);
 const [phase,setPhase]=useState<'idle'|'sending'|'unknown'|'review'|'error'>(restored?'unknown':'idle'),[message,setMessage]=useState(restored?'原操作仍待確認。重新登入不會自動重送，請重試原操作。':''),[errors,setErrors]=useState<Record<string,string>>({});
 const id=useId(),mounted=useRef(false),busy=useRef(false),generation=useRef(client.sessionGeneration),held=useRef(attempt),baseline=useRef(policiesFields(draft)),callback=useRef(onState);callback.current=onState;
 const dirty=!equal(value,policiesFields(draft)),blocking=phase==='sending'||phase==='unknown',frozen=locked||blocking||phase==='review';
 const current=()=>mounted.current&&generation.current===client.sessionGeneration;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;callback.current(false,false);};},[]);
 useEffect(()=>{callback.current(dirty||attempt!==null,blocking);},[dirty,attempt,blocking]);
 useEffect(()=>{const next=policiesFields(draft);if(!equal(next,baseline.current)){if(equal(value,baseline.current)&&!held.current)setValue(next);baseline.current=next;}},[draft,value]);
 async function send(original:PoliciesAttempt){
  if(busy.current)return;busy.current=true;held.current=original;setAttempt(original);setPhase('sending');setMessage('正在儲存賣方資訊與商店政策…');holdPoliciesAttempt(client,userId,original);onState(true,true);
  try{const ack=await sendPoliciesAttempt(client,original);releasePoliciesAttempt(client,userId,original);if(!current())return;held.current=null;setAttempt(null);setValue(policiesFields(ack.current));await onSaved();if(!current())return;setPhase('idle');setErrors({});setMessage('已儲存賣方資訊與商店政策。重新發布後，公開頁才會更新。');}
  catch(error){const unknown=!(error instanceof ApiError)||error.network||error.timedOut||error.accessExpired,retained=retainedPoliciesFailure(original,unknown||heldPoliciesAttempt(client,userId,original)?.hadUnknown===true);
   if(retained.hadUnknown)holdPoliciesAttempt(client,userId,retained);else releasePoliciesAttempt(client,userId,original);
   if(!current())return;held.current=retained;setAttempt(retained);
   if(retained.hadUnknown){setPhase('unknown');setMessage('尚未確認原操作結果。原內容仍保留，請重試確認後再離開。');}
   else if(error instanceof ApiError&&error.status===412){setPhase('review');setMessage('商店資料已更新，輸入仍保留。請核對最新內容後，再明確確認套用。');await onSaved();}
   else{setPhase('error');setMessage(error instanceof Error?error.message:'賣方資訊與商店政策尚未儲存。');}
  }finally{busy.current=false;}
 }
 function save(){if(frozen||!writable||!dirty||held.current?.hadUnknown)return;const raw=SellerPoliciesWireSchema.safeParse(value);const parsed=raw.success?SellerPoliciesInputSchema.safeParse(normalizeSellerPolicies(raw.data)):raw;
  if(!parsed.success){
   const fields=Object.fromEntries(parsed.error.issues.map(i=>[i.path.join('.'),i.message]));setErrors(fields);setMessage('請檢查標示的欄位後再儲存。');
   const first=parsed.error.issues[0]?.path.map(String),field=first?.join('.');
   const target=field?document.getElementById(first?.[0]==='policies'&&first?.[2]==='body'?id+'-'+first[1]:id+'-'+field):null;
   const policy=target?.closest('details');if(policy)policy.open=true;target?.focus();return;
  }
  void send(Object.freeze({tenantId,instanceId,body:frozenPolicyFields(parsed.data),expected:draft.version,key:crypto.randomUUID(),hadUnknown:false}));
 }
 const errorFor=(field:string)=>errors[field]?<p id={id+'-'+field+'-error'} className="field-error" role="alert">{errors[field]}</p>:null;
 const updateBody=(kind:PolicyKind,body:string)=>setValue(old=>({...old,policies:{...old.policies,[kind]:{...old.policies[kind],body}}}));
 const preview=`/api/v1/tenants/${tenantId}/storefronts/${instanceId}/preview-page`;
 return <section className="hosted-store-policies stack" aria-labelledby={id+'-title'}>
  <h4 id={id+'-title'}>賣方資訊與商店政策</h4>
  <p className="field-hint">先儲存草稿，再預覽與發布。公開頁會保留目前發布的版本。</p>
  <p className="hosted-policies-warning">這些資料會公開顯示在商店頁尾與『關於本店』頁。</p>
  <p className="field-hint">平台只檢查格式，不認證賣方資料。請自行確認內容。</p>
  {!writable&&<p>你目前只有檢視權限，無法修改賣方資訊與商店政策。</p>}
  {writable?<fieldset className="hosted-policies-fields stack" disabled={frozen}>
   <legend>賣方資訊</legend><div className="hosted-policies-seller-grid">{Object.entries(SELLER_FIELDS).map(([key,[label,max]])=>{
    const field='seller.'+key;return <div key={key}><label className="field" htmlFor={id+'-'+field}>{label}<input id={id+'-'+field} autoComplete="off" inputMode={key==='tax_id'?'numeric':key==='email'?'email':key==='phone'?'tel':'text'} value={value.seller[key as keyof typeof value.seller]} aria-invalid={Boolean(errors[field])||undefined} aria-describedby={id+'-'+field+'-hint'+(errors[field]?' '+id+'-'+field+'-error':'')} onChange={e=>setValue(old=>({...old,seller:{...old.seller,[key]:e.target.value}}))}/></label>
    <p id={id+'-'+field+'-hint'} className="field-hint">{key==='business_name'?'填寫任何賣方欄位時必填；這是零售負責方。填寫後，商店頁尾才會顯示賣方資訊、「關於本店」與政策連結。':key==='address'?'請填營業地址或可收受文書的地址。':key==='tax_id'?'選填，8 位半形數字；僅檢查格式。':'此階段選填。'}最多 {max} 個字。</p>{errorFor(field)}</div>;
   })}</div>
   <fieldset className="hosted-policies-fields stack"><legend>商店政策</legend>
    <p className="field-hint">賣方資訊只顯示最新發布的內容；移除電話或地址並重新發布後，公開頁就不再顯示。</p>
    <p className="field-hint">政策內文一經發布，就會留下有公開網址的版本。之後修改或清空，舊版仍可透過原網址查看，目前無法撤下。請不要在政策內文寫入個人電話、住址等個人資料；聯絡方式請填在上方的賣方資訊。</p>
    <p className="field-hint">只接受純文字，不支援 Markdown、HTML 或自動連結。每項最多 10,000 個字。</p>
    {POLICY_KINDS.map(kind=>{const field='policies.'+kind+'.body',policy=value.policies[kind],count=[...policy.body.replace(/\r\n/g,'\n').trim()].length;return <details className="hosted-policies-policy" key={kind} open={kind==='shipping'}><summary>{POLICY_LABELS[kind]}{kind==='terms'?'（選填）':''}<small>{policy.body?'已填寫':'尚未填寫'}</small></summary><div className="stack"><div className="hosted-policies-policy-grid"><div><div className="field"><label htmlFor={id+'-'+kind}>{POLICY_LABELS[kind]}內容</label><textarea id={id+'-'+kind} rows={10} value={policy.body} aria-invalid={count>10000||Boolean(errors[field])||undefined} aria-describedby={id+'-'+kind+'-count'+(errors[field]?' '+id+'-'+field+'-error':'')} onChange={e=>updateBody(kind,e.target.value)}/></div><p id={id+'-'+kind+'-count'} className="field-hint">{count.toLocaleString('en-US')}／10,000 個字</p>{errorFor(field)}</div><aside className="hosted-policies-checklist" aria-label={POLICY_LABELS[kind]+'段落清單'}><p>建議涵蓋的段落</p><ul>{POLICY_CHECKLISTS[kind].map(heading=><li key={heading}>{heading}</li>)}</ul></aside></div>
     {policy.kind==='returns'&&<div className="hosted-policies-returns">{(['window_days','return_by_days'] as const).map(key=><div key={key}><label className="field">{key==='window_days'?'售後申請期間（天，可留空）':'核准後寄回期限（天）'}<input id={id+'-policies.returns.'+key} type="number" min={key==='window_days'?7:1} max={3650} value={policy[key]??''} aria-invalid={Boolean(errors['policies.returns.'+key])||undefined} aria-describedby={errors['policies.returns.'+key]?id+'-policies.returns.'+key+'-error':undefined} onChange={e=>setValue(old=>({...old,policies:{...old.policies,returns:{...old.policies.returns,[key]:e.target.value===''?null:Number(e.target.value)}}}))}/></label>{errorFor('policies.returns.'+key)}</div>)}<p className="field-hint">申請期間為 7–3650 天；寄回期限為 1–3650 天，預設 14 天。目前只供顯示。</p></div>}
     {policy.kind==='privacy'&&<div className="stack">{draft.has_supplied_products&&<p className="field-hint">本店有供應商來源商品，請確認必要收件資料的提供方式。目前尚無代出貨同意，這個勾選不會開啟或阻擋結帳。</p>}<label className="hosted-policies-checkbox"><input type="checkbox" checked={policy.drop_ship_disclosed} onChange={e=>setValue(old=>({...old,policies:{...old.policies,privacy:{...old.policies.privacy,drop_ship_disclosed:e.target.checked}}}))}/>已說明代出貨時會把必要收件資料提供給負責出貨的供應商</label></div>}
    </div></details>;})}
   </fieldset>
   <div className="actions"><button type="button" className="btn btn-ghost btn-sm" disabled={!dirty} onClick={save}>儲存賣方資訊與商店政策</button>{(dirty||attempt)&&<button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setValue(policiesFields(draft));held.current=null;setAttempt(null);setErrors({});setPhase('idle');setMessage('已取消這次賣方資訊與商店政策變更。');}}>取消這次變更</button>}</div>
  </fieldset>:<><dl className="detail-list">{Object.entries(SELLER_FIELDS).map(([key,[label]])=><div key={key}><dt>{label}</dt><dd>{draft.seller[key as keyof typeof draft.seller]||'未填寫'}</dd></div>)}</dl>{POLICY_KINDS.map(kind=><section key={kind}><h5>{POLICY_LABELS[kind]}</h5><ReadonlyPolicy policy={draft.policies[kind]}/></section>)}</>}
  {phase==='unknown'&&attempt&&<div className="actions"><button type="button" className="btn btn-ghost btn-sm" onClick={()=>void send(attempt)}>重試原賣方資訊與商店政策操作</button></div>}
  {phase==='review'&&attempt&&<div className="stack"><p>最新已儲存的營業名稱：{draft.seller.business_name||'未填寫'}。輸入仍保留在上方。</p><details><summary>核對最新已儲存的賣方資訊與政策</summary><dl className="detail-list">{Object.entries(SELLER_FIELDS).map(([key,[label]])=><div key={key}><dt>{label}</dt><dd>{draft.seller[key as keyof typeof draft.seller]||'未填寫'}</dd></div>)}</dl>{POLICY_KINDS.map(kind=><section key={kind}><h5>{POLICY_LABELS[kind]}</h5><ReadonlyPolicy policy={draft.policies[kind]}/></section>)}</details><div className="actions"><button type="button" className="btn btn-ghost btn-sm" disabled={locked||!writable||draft.version===attempt.expected} onClick={()=>void send(reviewPoliciesAttempt(attempt,draft.version,crypto.randomUUID()))}>確認以最新版本儲存賣方資訊與商店政策</button><button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={()=>{held.current=null;setAttempt(null);setValue(policiesFields(draft));setPhase('idle');setMessage('已取消這次賣方資訊與商店政策變更。');}}>取消這次變更</button></div></div>}
  {message&&<p role={phase==='error'?'alert':'status'} className="field-hint">{message}</p>}
  <div className="actions"><a href={preview+'/about'} target="_blank" rel="noopener">預覽已儲存的賣方資訊與政策</a></div>
  {dirty&&<p className="field-hint">請先儲存這一節，再開啟預覽與發布。</p>}
 </section>;
}

function ReadonlyPolicy({policy}:{policy:PolicyDraft}){return <><p className="hosted-policies-readonly">{policy.body||'尚未填寫'}</p>{policy.kind==='returns'&&<p>售後申請期間：{policy.window_days===null?'未填寫':policy.window_days+' 天'}；核准後寄回期限：{policy.return_by_days} 天。</p>}{policy.kind==='privacy'&&<p>代出貨必要收件資料說明：{policy.drop_ship_disclosed?'已勾選':'未勾選'}。</p>}</>;}
