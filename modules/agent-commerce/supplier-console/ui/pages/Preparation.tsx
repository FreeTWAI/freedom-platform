import type {SupplyCatalogView} from '../../../../../contracts/guild-launchpad/v1/hosted-supply-catalog';
import type {SupplierOverview,SupplierProducts} from '../../../../../contracts/guild-launchpad/v1/supplier-console';
import type {ConsoleController} from '../../state/useSupplierConsoleController';
import {supplySetupProgress,SUPPLY_STAGE_LABELS,type SupplySetupProgress} from '../setup-progress';

export const consoleSetupProgress=(c:ConsoleController)=>supplySetupProgress({profile:c.slot<SupplyCatalogView>('profile'),overview:c.slot<SupplierOverview>('overview'),products:c.slot<SupplierProducts>('products'),owner:c.owner});

/** Console reads own the evidence; legacy setup shares only the currency consequence. */
export function Preparation({c,progress=consoleSetupProgress(c),setup=false}:{c:ConsoleController;progress?:SupplySetupProgress;setup?:boolean}){
 if(!c.profile?.capabilities.includes('store:write'))return null;
 const {storage,publication,reservation}=progress;
 return <div className="supplier-readiness">
  <ol className="sc-readiness-list" aria-label="供貨設定進度">{progress.stages.map(stage=><li key={stage.key} data-stage={stage.key} data-state={stage.state} aria-current={stage.state==='current'?'step':undefined}>
   <div className="sc-readiness-heading"><strong>{stage.title}</strong><span className="badge readiness-state" data-state={stage.state}>{SUPPLY_STAGE_LABELS[stage.state]}</span></div>{stage.detail&&<p className="field-hint">{stage.detail}</p>}
  </li>)}</ol>
  {progress.contradictory&&<p className="field-hint">商品與供貨資料不一致，請更新資料後再確認。</p>}
  {!setup&&<dl className="sc-preparation-status">
   <div><dt>私人儲存</dt><dd>{storage.state==='ready'?`${storage.count} 件自有商品`:'暫時無法確認'}</dd></div>
   <div><dt>公開供貨</dt><dd>{publication.state==='ready'?publication.count?`${publication.count} 件`:'尚未公開':'暫時無法確認'}<p className="field-hint">只供同社群、相同幣別的店家選用，不是買家展示頁。</p></dd></div>
   <div><dt>接受交易</dt><dd>由合作店家的商店接單與收款
    {reservation.state==='ready'&&<p className="field-hint">{reservation.enabled?'供貨預留：已開啟（30 分鐘）':'供貨預留：未開啟'}{!reservation.admission&&'；平台暫停新預留'}</p>}
    {reservation.state==='failed'&&<p className="field-hint">供貨預留：暫時無法確認</p>}
    {progress.retailEnabled&&<p className="field-hint">零售商店的接單狀態請到商店確認。</p>}
   </dd></div>
  </dl>}
 </div>;
}
