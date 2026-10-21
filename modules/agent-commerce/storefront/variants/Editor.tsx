import {parseMajorToMinor,formatMinor} from '../../../../apps/portal-web/src/format';
import {useEffect,useRef,useState} from 'react';
import {ApiError,type PortalClient} from '../../../../apps/portal-web/src/api';
import {ProductViewSchema} from '../../../../contracts/guild-launchpad/v1/storefront';
import {ProductGroupPageSchema,ReplaceProductGroupInputSchema,VariantCommandAckSchema,CreateVariantProductInputSchema,type ProductGroupDraft} from '../../../../contracts/guild-launchpad/v1/storefront-variants';
import {catalogAttempt,holdCatalogAttempt,releaseCatalogAttempt,type CatalogAttempt} from './editor-state';
import './editor.css';
type Page=ReturnType<typeof ProductGroupPageSchema.parse>;
type Draft=ReturnType<typeof ReplaceProductGroupInputSchema.parse>;
const fromGroup=(g:ProductGroupDraft):Draft=>({title:g.title,description:g.description,axes:structuredClone(g.axes),members:g.members.map(m=>({product_id:m.product.product_id,product_version:m.product.version,value_keys:[...m.value_keys]})),default_product_id:g.default_product_id,order:g.order});
export function VariantsEditor({client,userId,root,writable,locked,refresh,onState,onSaved,categoriesEnabled=false}:{categoriesEnabled?:boolean;client:PortalClient;userId:string;root:string;writable:boolean;locked:boolean;refresh:string;onState:(dirty:boolean,blocking:boolean)=>void;onSaved:()=>Promise<void>}){
 const scope=userId+'/'+root+'/variants',[page,setPage]=useState<Page|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(()=>catalogAttempt(client,scope)?'暫時無法確認儲存結果，請用原操作重試。':'');
 const [attempt,setAttempt]=useState<CatalogAttempt|undefined>(()=>catalogAttempt(client,scope)),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[revision,setRevision]=useState(0),[messageError,setMessageError]=useState(false);
 const messageRef=useRef<HTMLParagraphElement>(null);useEffect(()=>{if(messageError)messageRef.current?.focus();},[message,messageError]);
 const session=useRef(client.sessionGeneration),alive=useRef(true),sequence=useRef(0),sending=useRef(false),state=useRef(onState);state.current=onState;
 useEffect(()=>{alive.current=true;return()=>{const pending=catalogAttempt(client,scope);if(pending)holdCatalogAttempt(client,scope,{...pending,hadUnknown:true});alive.current=false;sequence.current++;};},[]);
 useEffect(()=>{state.current(dirty||!!attempt,busy||!!attempt);},[dirty,attempt,busy]);
 useEffect(()=>()=>state.current(false,false),[]);
 const current=()=>alive.current&&session.current===client.sessionGeneration;
 async function load(){const ticket=++sequence.current;try{const next=ProductGroupPageSchema.parse(await client.get(root+'/product-groups'));if(!current()||ticket!==sequence.current)return;setPage(next);setSelected(old=>next.items.some(g=>g.group_key===old)?old:next.items[0]?.group_key??'');setError('');}catch{if(current()&&ticket===sequence.current)setError('無法取得規格，請稍後重試。');}}
 useEffect(()=>{if(!dirty&&!attempt)void load();},[root,refresh,revision]);
 async function send(value:CatalogAttempt){
  if(sending.current||!writable||locked)return;sending.current=true;setBusy(true);setAttempt(value);holdCatalogAttempt(client,scope,value);state.current(true,true);setMessageError(false);setMessage('正在儲存規格…');
  try{
   const result=await client[value.method](value.path,JSON.parse(value.body),{idempotencyKey:value.key,ifMatch:value.expected});
   const ack=value.kind==='group'?VariantCommandAckSchema.parse(result):null,next=ack?.current??null;
   if(ack){const match=/\/product-groups\/([^/]+)(?:\/(products|split))?$/.exec(value.path),operation=match?.[2]==='products'?'create-product':match?.[2]==='split'?'split':'replace';
    if(!match||ack.group_key!==match[1]||ack.operation!==operation||BigInt(ack.completed_version)<BigInt(value.expected))throw new Error('variant_reply_mismatch');
   }
   const product=value.kind==='product'?ProductViewSchema.parse(result):null;
   if(product&&(!value.path.endsWith('/products/'+product.product_id)||BigInt(product.version)<BigInt(value.expected)))throw new Error('product_reply_mismatch');
   releaseCatalogAttempt(client,scope);if(!current())return;
   setAttempt(undefined);setMessage(value.notice);
   if(product)setPage(old=>old?{...old,items:old.items.map(g=>({...g,members:g.members.map(m=>m.product.product_id===product.product_id?{...m,product}:m)}))}:old);
   else{setDirty(false);if(next)setPage(next);setRevision(n=>n+1);}
   await onSaved();
  }catch(e){if(!current())return;
   const unknown=!(e instanceof ApiError)||e.network||e.timedOut||e.accessExpired||e.status>=500;
   if(unknown||value.hadUnknown){const pending={...value,hadUnknown:true};holdCatalogAttempt(client,scope,pending);setAttempt(pending);setMessage('暫時無法確認儲存結果，請用原操作重試。');}
   else{releaseCatalogAttempt(client,scope);setAttempt(undefined);setMessageError(true);setMessage(e.status===412?'規格已更新，請重新讀取後再儲存。':e.message);}
  }finally{sending.current=false;if(current())setBusy(false);}
 }
 function fresh(method:CatalogAttempt['method'],path:string,body:unknown,expected:string,notice:string,kind:CatalogAttempt['kind']='group'){
  if(locked||busy||attempt||!writable)return;
  void send({method,path,body:JSON.stringify(body),expected,key:crypto.randomUUID(),kind,notice});
 }
 const g=page?.items.find(g=>g.group_key===selected),blocked=locked||busy||!!attempt;
 return <section className="store-variants-editor stack" aria-labelledby="store-variants-heading"><h3 id="store-variants-heading">規格</h3>
  <p className="field-hint">最多 2 個選項，每個選項最多 20 個值。每個規格都有自己的售價與庫存；每個規格各占一項商品名額。</p>
  {page&&<p className="field-hint">目前 {page.items.reduce((n,g)=>n+g.members.length,0)} / 200 項商品；儲存後可預覽，再發布到商店。</p>}
  {!page&&!error&&<p role="status">正在讀取規格…</p>}{error&&<p role="alert">{error} <button type="button" className="btn btn-ghost" disabled={blocked} onClick={()=>void load()}>重試</button></p>}
  {message&&<p ref={messageRef} tabIndex={-1} role={messageError?'alert':'status'} aria-live={messageError?'assertive':'polite'}>{message}</p>}
  {attempt&&!busy&&<button type="button" className="btn btn-ghost" disabled={locked||!writable} onClick={()=>void send(attempt)}>重試原操作</button>}
  {page&&page.items.length>0&&<label>規格商品<select aria-label="規格商品" value={selected} disabled={blocked||dirty} onChange={e=>setSelected(e.target.value)}>{page.items.map(g=><option key={g.group_key} value={g.group_key}>{g.title} · {g.members.map(m=>m.product.sku).join('／')}</option>)}</select></label>}
  {g&&(!writable||!g.editable)&&<div className="stack"><h4>{g.title}</h4><p>{g.description}</p>{g.members.map(m=><p key={m.selection_id}>{m.buyer_label} · {m.product.sku} · {formatMinor(m.product.price_minor,m.product.currency)}</p>)}{!g.editable&&<p>供貨選品目前各自顯示，不可加入商品組。</p>}</div>}
  {g&&writable&&g.editable&&<GroupEditor key={g.group_key+'/'+g.version} group={g} page={page!} writable={writable&&g.editable} locked={blocked} onDirty={setDirty}
   onSave={body=>fresh('put',root+'/product-groups/'+g.group_key,body,g.version,'已儲存規格，尚未發布。')}
   onSplit={()=>fresh('post',root+'/product-groups/'+g.group_key+'/split',{},g.version,'已拆分商品，尚未發布。')}
   onCreate={body=>fresh('post',root+'/product-groups/'+g.group_key+'/products',body,g.version,'已新增規格商品，尚未發布。')}
   onProduct={(id,version,body)=>fresh('patch',root+'/products/'+id,body,version,'已儲存商品，尚未發布。','product')}
   onReload={()=>{if(!dirty||window.confirm('要捨棄未儲存的變更嗎？')){setDirty(false);setPage(null);void load();}}}/>}
  {categoriesEnabled&&g&&writable&&g.editable&&<p className="field-hint">合併或拆分後，請在商品分類確認各商品的分類。</p>}
  {!writable&&<p>你目前只有檢視權限。</p>}
 </section>;
}
function numericProductFields(price:string,stock:string,currency:string){
 const amount=parseMajorToMinor(price),cap=CreateVariantProductInputSchema.shape.product.shape.price_minor.maxValue!;
 if(amount>cap)throw new Error(`價格上限為 ${formatMinor(cap,currency)}。`);
 if(!/^\d+$/.test(stock))throw new Error('庫存須為整數。');
 const fields=CreateVariantProductInputSchema.shape.product.shape,priceValue=fields.price_minor.safeParse(amount),stockValue=fields.stock.safeParse(Number(stock));
 if(!priceValue.success||!stockValue.success)throw Object.assign(new Error('有欄位格式不符，請檢查後再送出。'),{field:!stockValue.success?'stock':'price_minor'});return {price_minor:priceValue.data,stock:stockValue.data};
}
function GroupEditor({group:g,page,writable,locked,onDirty,onSave,onSplit,onCreate,onProduct,onReload}:{group:ProductGroupDraft;page:Page;writable:boolean;locked:boolean;onDirty:(v:boolean)=>void;onSave:(v:Draft)=>void;onSplit:()=>void;onCreate:(v:unknown)=>void;onProduct:(id:string,version:string,body:unknown)=>void;onReload:()=>void}){
 const [draft,setDraft]=useState(()=>fromGroup(g)),[attach,setAttach]=useState(''),[newOpen,setNewOpen]=useState(false),[newProduct,setNewProduct]=useState({title:'',description:'',price_minor:'',stock:'0'}),[newValues,setNewValues]=useState<string[]>([]),[productDirty,setProductDirty]=useState<Record<string,boolean>>({}),[fieldError,setFieldError]=useState(''),[reset,setReset]=useState(0);
 const [invalidFields,setInvalidFields]=useState<string[]>([]),errorRef=useRef<HTMLDivElement>(null),errorId='variant-'+g.group_key+'-errors';
 useEffect(()=>{if(fieldError)errorRef.current?.focus();},[fieldError,invalidFields]);
 const fieldId=(path:string)=>'variant-'+g.group_key+'-'+path.replaceAll('.','-');
 const field=(path:string)=>({id:fieldId(path),'aria-invalid':invalidFields.includes(path)||undefined,'aria-describedby':invalidFields.includes(path)?errorId:undefined});
 const fieldName=(path:string)=>path==='title'?'商品組名稱':path==='description'?'商品組介紹':path==='new.title'?'商品名稱':path==='new.description'?'商品介紹':path==='new.stock'?'庫存':path==='new.price_minor'?'售價':path.includes('.values.')?'選項值':'選項名稱';
 function invalid(message:string,paths:string[]){setInvalidFields([...new Set(paths)]);setFieldError(message);}
 function save(){
  const parsed=ReplaceProductGroupInputSchema.safeParse(currentDraft);
  if(!parsed.success){invalid('規格設定格式無效，請檢查商品組、選項與成員。',parsed.error.issues.map(i=>i.path.join('.')).filter(p=>p==='title'||p==='description'||/^axes\.\d+\.(?:name|values\.\d+\.name)$/.test(p)));return;}
  if(draft.members.some(m=>(draft.title.trim().normalize('NFC')+(draft.axes.length?'（'+draft.axes.map((a,n)=>(a.values.find(v=>v.key===m.value_keys[n])?.name??'').trim().normalize('NFC')).join('／')+'）':'')).length>120)){invalid('完整商品名稱含規格最多 120 字，請縮短商品組名稱或選項值。',['title']);return;}
  setFieldError('');setInvalidFields([]);onSave(parsed.data);
 }
 // Product saves replace only that member's fields. Keep other local price
 // drafts mounted and use current product versions for the next metadata save.
 const currentDraft={...draft,members:draft.members.map(m=>({...m,product_version:page.items.flatMap(g=>g.members).find(v=>v.product.product_id===m.product_id)!.product.version}))};
 const metadataDirty=JSON.stringify(currentDraft)!==JSON.stringify(fromGroup(g)),otherDirty=Object.values(productDirty).some(Boolean),dirty=metadataDirty||otherDirty||newOpen;
 useEffect(()=>onDirty(dirty),[dirty]);
 const update=(patch:Partial<Draft>)=>{setFieldError('');setInvalidFields([]);setDraft(old=>({...old,...patch}));};
 const axes=(next:Draft['axes'])=>setDraft(old=>({...old,axes:next,members:old.members.map(m=>({...m,value_keys:next.map(a=>{const value=m.value_keys[old.axes.findIndex(axis=>axis.key===a.key)];return a.values.some(v=>v.key===value)?value:a.values[0]?.key??'';})}))}));
 const candidates=page.items.filter(row=>row.group_id===null&&row.editable&&!draft.members.some(m=>m.product_id===row.members[0].product.product_id));
 const member=(id:string)=>page.items.flatMap(g=>g.members).find(m=>m.product.product_id===id)!;
 function create(){try{const fields=numericProductFields(newProduct.price_minor,newProduct.stock,g.members[0].product.currency),parsed=CreateVariantProductInputSchema.shape.product.safeParse({title:newProduct.title,description:newProduct.description,...fields});if(!parsed.success){invalid('有欄位格式不符，請檢查後再送出。',parsed.error.issues.map(i=>'new.'+i.path.join('.')));return;}setFieldError('');setInvalidFields([]);onCreate({product:parsed.data,value_keys:newValues});}catch(e){invalid(e instanceof Error?e.message:'請檢查商品資料。',['new.'+((e as {field?:string})?.field??(e instanceof Error&&e.message.includes('庫存')?'stock':'price_minor'))]);}}
 return <div className="stack">
  {fieldError&&<div role="alert" tabIndex={-1} ref={errorRef} id={errorId}><p>{fieldError}</p>{invalidFields.length>0&&<ul>{invalidFields.map(path=><li key={path}><a href={'#'+fieldId(path)} onClick={e=>{e.preventDefault();document.getElementById(fieldId(path))?.focus();}}>{fieldName(path)}</a></li>)}</ul>}</div>}
  {!g.group_id&&<p className="field-hint">這是單一商品。加入選項與商品即可建立規格。</p>}
  {!g.can_anchor&&<p role="note">這項商品仍是原商品組的保留起點，不能建立新的商品組；可重新加入原商品組，或加入其他商品組。</p>}
  <fieldset disabled={locked||!writable||!g.can_anchor} className="store-variant-fields stack"><label>商品組名稱<input {...field('title')} value={draft.title} maxLength={120} onChange={e=>update({title:e.target.value})}/></label>
   <label>商品組介紹<textarea {...field('description')} aria-label="商品組介紹" value={draft.description} onChange={e=>update({description:e.target.value})}/></label>
   <p className="field-hint">商品組名稱與介紹會顯示在商品卡與商品頁；各規格原有的名稱與介紹會保留，拆分後恢復顯示。預設款的圖組會共用在這個商品組；各商品原有照片會保留，拆分後恢復顯示。</p>
   <div className="store-variant-axes">{draft.axes.map((axis,n)=><section className="stack" key={axis.key}><label>選項名稱<input {...field(`axes.${n}.name`)} aria-label={`選項名稱（選項 ${n+1}）`} value={axis.name} onChange={e=>axes(draft.axes.map((a,k)=>k===n?{...a,name:e.target.value}:a))}/></label>
    {axis.values.map((v,k)=><div className="store-variant-inline" key={v.key}><label>選項值<input {...field(`axes.${n}.values.${k}.name`)} aria-label={`選項值（選項 ${n+1}，值 ${k+1}）`} value={v.name} onChange={e=>axes(draft.axes.map((a,j)=>j===n?{...a,values:a.values.map(value=>value.key===v.key?{...value,name:e.target.value}:value)}:a))}/></label><button type="button" className="btn btn-ghost" aria-label={`移除選項值：${axis.name} ${v.name||k+1}`} disabled={axis.values.length===1} onClick={()=>axes(draft.axes.map((a,j)=>j===n?{...a,values:a.values.filter(value=>value.key!==v.key)}:a))}>移除選項值</button></div>)}
    <div className="actions">{axis.values.length<20&&<button type="button" className="btn btn-ghost" onClick={()=>axes(draft.axes.map((a,j)=>j===n?{...a,values:[...a.values,{key:crypto.randomUUID(),name:''}]}:a))}>新增選項值</button>}<button type="button" className="btn btn-ghost" aria-label={`移除選項：${axis.name||n+1}`} onClick={()=>axes(draft.axes.filter(a=>a.key!==axis.key))}>移除選項</button></div>
   </section>)}</div>
   {draft.axes.length<2&&<div><button type="button" className="btn btn-ghost" onClick={()=>axes([...draft.axes,{key:crypto.randomUUID(),name:'',values:[{key:crypto.randomUUID(),name:''}]}])}>新增選項</button></div>}
   <h4>規格商品</h4><div className="store-variant-members">{draft.members.map((m,n)=>{const row=member(m.product_id),values=draft.axes.map((a,k)=>a.values.find(v=>v.key===m.value_keys[k])?.name??'');return <article className="store-variant-member stack" key={m.product_id}>
    <p className="store-variant-label"><strong>完整商品名稱</strong> {draft.title}{values.length?'（'+values.join('／')+'）':''}</p><p className="field-hint">商品編號 {row.product.sku}</p>
    <label className="store-variant-default"><input type="radio" name={'variant-default-'+g.group_key} checked={draft.default_product_id===m.product_id} onChange={()=>update({default_product_id:m.product_id})}/>預設款：{row.product.sku}</label>
    {draft.axes.map((a,k)=><label key={a.key}>{a.name||`選項 ${k+1}`}<select aria-label={`${row.product.sku} ${a.name||`選項 ${k+1}`}`} value={m.value_keys[k]??''} onChange={e=>update({members:draft.members.map(v=>v.product_id===m.product_id?{...v,value_keys:v.value_keys.map((key,j)=>j===k?e.target.value:key)}:v)})}>{a.values.map(v=><option value={v.key} key={v.key}>{v.name||'請填寫選項值'}</option>)}</select></label>)}
    <MemberPrice key={row.product.version+'/'+reset} row={row} locked={locked||metadataDirty||newOpen} writable={writable} onDirty={value=>setProductDirty(old=>({...old,[m.product_id]:value}))} onSave={body=>onProduct(m.product_id,row.product.version,body)}/>
    <div className="actions">{(['上移','下移'] as const).map((text,k)=><button type="button" className="btn btn-ghost" key={text} disabled={k===0?n===0:n===draft.members.length-1} aria-label={`${text}：${row.product.sku}`} onClick={()=>{const members=[...draft.members],to=n+(k===0?-1:1);[members[n],members[to]]=[members[to],members[n]];update({members});}}>{text}</button>)}<button type="button" className="btn btn-ghost" disabled={draft.members.length===1} aria-label={`拆成單一商品：${row.product.sku}`} onClick={()=>update({members:draft.members.filter(v=>v.product_id!==m.product_id),default_product_id:draft.default_product_id===m.product_id?draft.members.find(v=>v.product_id!==m.product_id)!.product_id:draft.default_product_id})}>拆成單一商品</button></div>
   </article>;})}</div>
   <label>加入現有商品<select aria-label="加入現有商品" value={attach} onChange={e=>setAttach(e.target.value)}><option value="">選擇商品</option>{candidates.map(g=><option key={g.group_key} value={g.members[0].product.product_id}>{g.title} · {g.members[0].product.sku}</option>)}</select></label>
   {!candidates.length&&<p className="field-hint">沒有可加入的單一商品。你可以新增規格商品。</p>}
   <div className="actions"><button type="button" className="btn btn-ghost" disabled={!attach} onClick={()=>{const row=member(attach);update({members:[...draft.members,{product_id:attach,product_version:row.product.version,value_keys:draft.axes.map(a=>a.values[0]?.key??'')}]});setAttach('');}}>加入商品組</button>
    <button type="button" className="btn btn-ghost" disabled={metadataDirty||otherDirty||!g.axes.length} onClick={()=>{setNewOpen(true);setNewValues(g.axes.map(a=>a.values[0].key));}}>新增規格商品</button></div>
   {newOpen&&<div className="store-variant-new stack"><label>商品名稱<input {...field('new.title')} value={newProduct.title} onChange={e=>setNewProduct({...newProduct,title:e.target.value})}/></label><label>商品介紹<textarea {...field('new.description')} aria-label="商品介紹" value={newProduct.description} onChange={e=>setNewProduct({...newProduct,description:e.target.value})}/></label><label>售價<input {...field('new.price_minor')} inputMode="numeric" value={newProduct.price_minor} onChange={e=>setNewProduct({...newProduct,price_minor:e.target.value})}/></label><label>庫存<input {...field('new.stock')} inputMode="numeric" value={newProduct.stock} onChange={e=>setNewProduct({...newProduct,stock:e.target.value})}/></label>{g.axes.map((a,n)=><label key={a.key}>{a.name}<select value={newValues[n]} onChange={e=>setNewValues(old=>old.map((v,k)=>k===n?e.target.value:v))}>{a.values.map(v=><option key={v.key} value={v.key}>{v.name}</option>)}</select></label>)}<div className="actions"><button type="button" className="btn btn-primary" onClick={create}>加入商品組</button><button type="button" className="btn btn-ghost" onClick={()=>setNewOpen(false)}>取消變更</button></div></div>}
   <div className="actions"><button type="button" className="btn btn-primary" disabled={!metadataDirty||otherDirty||newOpen} onClick={save}>儲存規格</button><button type="button" className="btn btn-ghost" disabled={!dirty} onClick={()=>{setDraft(fromGroup(g));setNewOpen(false);setProductDirty({});setReset(n=>n+1);}}>取消變更</button>{g.group_id&&<button type="button" className="btn btn-ghost" disabled={dirty} onClick={()=>{if(window.confirm('要拆成各別商品嗎？各商品會恢復原有名稱、介紹與照片；發布後才會更新公開頁。'))onSplit();}}>拆成各別商品</button>}</div>
   {metadataDirty&&<p className="field-hint">請先儲存規格，再新增規格商品或調整售價與庫存。</p>}
  </fieldset>
  <button type="button" className="btn btn-ghost" disabled={locked} onClick={onReload}>重新讀取</button>
 </div>;
}
function MemberPrice({row,locked,writable,onDirty,onSave}:{row:ProductGroupDraft['members'][number];locked:boolean;writable:boolean;onDirty:(v:boolean)=>void;onSave:(v:unknown)=>void}){
 const [price,setPrice]=useState(String(row.product.price_minor/100)),[stock,setStock]=useState(String(row.product.stock??'')),[error,setError]=useState(''),dirty=price!==String(row.product.price_minor/100)||stock!==String(row.product.stock??'');
 const [invalid,setInvalid]=useState(''),errorRef=useRef<HTMLParagraphElement>(null),errorId='variant-'+row.product.sku+'-price-error';
 useEffect(()=>{if(error)errorRef.current?.focus();},[error,invalid]);
 useEffect(()=>onDirty(dirty),[dirty]);
 function save(){try{const fields=numericProductFields(price,stock,row.product.currency);setError('');setInvalid('');onSave(fields);}catch(e){setInvalid((e as {field?:string})?.field??(e instanceof Error&&e.message.includes('庫存')?'stock':'price_minor'));setError(e instanceof Error?e.message:'請檢查售價與庫存。');}}
 return <fieldset className="store-variant-price" disabled={locked||!writable}><label>售價<input aria-invalid={invalid==='price_minor'||undefined} aria-describedby={invalid==='price_minor'?errorId:undefined} aria-label={`${row.product.sku} 售價`} inputMode="numeric" value={price} onChange={e=>{setPrice(e.target.value);setError('');setInvalid('');}}/></label><label>庫存<input aria-invalid={invalid==='stock'||undefined} aria-describedby={invalid==='stock'?errorId:undefined} aria-label={`${row.product.sku} 庫存`} inputMode="numeric" value={stock} onChange={e=>{setStock(e.target.value);setError('');setInvalid('');}}/></label><button type="button" className="btn btn-ghost" disabled={!dirty} onClick={save}>儲存商品：{row.product.sku}</button>{error&&<p role="alert" tabIndex={-1} ref={errorRef} id={errorId}>{error}</p>}</fieldset>;
}
