import {useEffect,useRef,useState} from 'react';
import {sellerConsoleHref,type SellerConsoleRoute,type SellerQuery} from '../route';
import {displayNumberPattern,normalizeSellerOrderFilters,sameSellerOrderFilters,sellerOrderFilterSummary,SELLER_ORDER_SHORTCUTS,SELLER_PAYMENT_METHODS} from '../order-filters';
import {words} from './view';

/** Editing filters is not a server query; only an explicit apply/shortcut changes the route. */
export function OrderFilters({route}:{route:SellerConsoleRoute}){
 const [filters,setFilters]=useState<SellerQuery>(route.query),[submitted,setSubmitted]=useState(false),[composing,setComposing]=useState(false);
 const composition=useRef(false),input=useRef<HTMLInputElement>(null),queryKey=JSON.stringify(route.query);
 // Keep the input node mounted for clear/apply focus; browser history replaces only draft values.
 useEffect(()=>{setFilters(JSON.parse(queryKey) as SellerQuery);setSubmitted(false);composition.current=false;setComposing(false);},[queryKey]);
 const next=normalizeSellerOrderFilters(filters),invalid=!!next.display_number&&!displayNumberPattern.test(next.display_number);
 const changed=!sameSellerOrderFilters(filters,route.query),routeInvalid=!!route.query.display_number&&!displayNumberPattern.test(route.query.display_number);
 function clear(){setFilters({});setSubmitted(false);input.current?.focus();}
 return <form className="stack" aria-label="篩選訂單" noValidate onSubmit={event=>{
  event.preventDefault();if(composition.current)return;setSubmitted(true);
  if(invalid){input.current?.focus();return;}
  setFilters(next);window.location.hash=sellerConsoleHref(route,'orders',{query:next});
 }}>
  <nav className="actions" aria-label="快速篩選訂單">{SELLER_ORDER_SHORTCUTS.map(shortcut=><a key={shortcut.label} className="btn btn-ghost"
   href={sellerConsoleHref(route,'orders',{query:shortcut.query})} aria-current={sameSellerOrderFilters(route.query,shortcut.query)?'page':undefined}
   onClick={event=>{if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&event.button===0){setFilters({...shortcut.query});setSubmitted(false);}}}>{shortcut.label}</a>)}</nav>
  <p className="field-hint" role="status">{routeInvalid?'目前的訂單編號格式不符，尚未查詢。':`目前套用：${sellerOrderFilterSummary(route.query)}。`}</p>
  {submitted&&invalid&&!composing&&<p role="alert"><a href="#seller-display-number" onClick={event=>{event.preventDefault();input.current?.focus();}}>請修正訂單編號再套用篩選。</a></p>}
  <div className="seller-filters">
   <label className="field">狀態<select aria-label="狀態" value={filters.lifecycle??''} onChange={e=>setFilters(old=>({...old,lifecycle:(e.target.value||undefined) as SellerQuery['lifecycle']}))}>
    <option value="">全部</option>{Object.entries(words.lifecycle).map(([v,t])=><option key={v} value={v}>{t}</option>)}
   </select></label>
   <label className="field">付款方式<select value={filters.payment_method??''} onChange={e=>setFilters(old=>({...old,payment_method:(e.target.value||undefined) as SellerQuery['payment_method']}))}>
    <option value="">全部付款方式</option>{Object.entries(SELLER_PAYMENT_METHODS).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></label>
   <div className="field"><label htmlFor="seller-display-number">訂單編號</label><input ref={input} id="seller-display-number" autoComplete="off" spellCheck={false} value={filters.display_number??''}
    aria-invalid={!composing&&invalid} aria-describedby={`seller-display-number-hint${!composing&&invalid?' seller-display-number-error':''}`}
    onChange={e=>setFilters(old=>({...old,display_number:e.target.value}))}
    onCompositionStart={()=>{composition.current=true;setComposing(true);}} onCompositionEnd={()=>{composition.current=false;setComposing(false);}}
    onKeyDown={e=>{if(e.key==='Enter'&&(composition.current||e.nativeEvent.isComposing||e.keyCode===229))e.preventDefault();}}/>
    <span className="field-hint" id="seller-display-number-hint">可直接貼上訂單編號；套用時會轉成半形大寫並去掉頭尾空格。</span>
    {!composing&&invalid&&<span className="field-hint" id="seller-display-number-error">格式為六位日期、連字號及六位大寫編號，例如 261016-ABCDEF。</span>}
   </div>
  </div>
  <div className="seller-filters">
   <label className="choice"><input type="checkbox" checked={filters.awaiting_offline_payment==='true'} onChange={e=>setFilters(old=>({...old,awaiting_offline_payment:e.target.checked?'true':undefined}))}/>只看待確認收款</label>
   <label className="choice"><input type="checkbox" checked={filters.needs_action==='true'} onChange={e=>setFilters(old=>({...old,needs_action:e.target.checked?'true':undefined}))}/>只看需處理</label>
  </div>
  <p className="field-hint">待確認收款只包含尚未確認收款的進行中匯款／面交現金訂單；需處理是訂單有未結案問題，不代表尚未付款。多個條件會一起套用。</p>
  {changed&&<p role="status" className="field-hint">篩選條件已修改，按「套用篩選」後更新清單。</p>}
  <div className="actions"><button className="btn btn-ghost" type="submit">套用篩選</button>
   <a className="btn btn-ghost" href={sellerConsoleHref(route,'orders')} onClick={event=>{if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&event.button===0)clear();}}>清除篩選</a>
  </div>
 </form>;
}
