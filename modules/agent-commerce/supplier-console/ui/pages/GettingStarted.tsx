import type {ConsoleController} from '../../state/useSupplierConsoleController';
import {supplierConsoleHref} from '../route';
import {Preparation,consoleSetupProgress} from './Preparation';

/** Existing supply actions, without inferring publication, consent or order readiness. */
export function GettingStarted({c}:{c:ConsoleController}){
 if(!c.profile?.capabilities.includes('store:write'))return null;
 const progress=consoleSetupProgress(c),empty=c.slot('overview').state==='ready'&&progress.storage.state==='ready'&&progress.storage.count===0;
 const next=!c.locked&&c.can('store:write')&&progress.nextAction?.kind==='navigate'?progress.nextAction:null;
 const href=(page:Parameters<typeof supplierConsoleHref>[1])=>supplierConsoleHref(c.scope,page);
 return <section className="card stack sc-getting-started" aria-label="供貨準備">
  <h3>從商品到合作店家</h3>
  {!progress.steady&&<Preparation c={c} progress={progress}/>}
  <div className="actions">{next&&<a className="btn btn-primary" href={supplierConsoleHref(c.scope,next.page,next.page==='products'?{state:next.state}:{})}>{next.label}</a>}<a className="btn btn-ghost btn-small" href={href('products')}>管理商品與供貨條件</a></div>
  <details open={empty}>
   <summary>供貨步驟與使用說明</summary>
   {progress.steady&&<Preparation c={c} progress={progress}/>}
   <ol className="sc-setup-steps">
    <li><strong>準備商品並公開供貨</strong><p>填寫商品、供貨單價、可用庫存與條件；確認後，在商品詳情發布供貨版本。只保存商品不會自動公開供貨。</p></li>
    <li><strong>提供可使用的素材（選用）</strong><p>有權提供的照片與文案，可另行設定使用範圍並授權合作店家。商品供貨同意不會自動授權素材。</p><div className="actions"><a className="btn btn-ghost btn-small" href={href('materials')}>管理行銷素材與授權</a></div></li>
    <li><strong>確認店家的選品申請</strong><p>查看店家與售價，再決定是否接受；供貨條件變更時，依頁面的版本提示重新確認。</p><div className="actions"><a className="btn btn-ghost btn-small" href={href('terms')}>查看供貨申請</a></div></li>
    <li><strong>追蹤合作與預留</strong><p>從合作店家查看目前的合作狀態；預留只表示暫時保留數量，不代表成交或付款。代出貨另需雙方同意與配送設定。</p><div className="actions"><a className="btn btn-ghost btn-small" href={href('partners')}>查看合作店家</a>{c.ownerAllowed&&<a className="btn btn-ghost btn-small" href={href('reservations')}>查看供貨預留</a>}</div></li>
   </ol>
  </details>
 </section>;
}
