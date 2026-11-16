import {StoreAppearanceSchema} from '../../../../contracts/guild-launchpad/v1/storefront-presentation';
import {HostedStoreAppearance} from './HostedStoreAppearance';
import type {PortalClient} from '../api';
import type {StoreAreaData, StoreArea} from './hosted-store-area-shared';

export interface HostedStorePublishAreaProps {
  area: StoreArea;
  preview: StoreAreaData['preview'];
  appearanceEnabled: boolean;
  appearance: StoreAreaData['appearance'];
  areaLocked: boolean;
  can: (key: string) => boolean;
  templateChoice: StoreAreaData['templateChoice'];
  setTemplateChoice: StoreAreaData['setTemplateChoice'];
  markDirty: (id: string, value: boolean) => void;
  command: StoreAreaData['command'];
  root: string;
  appearanceError: StoreAreaData['appearanceError'];
  loading: StoreAreaData['loading'];
  locked: boolean;
  appearanceDraft: StoreAreaData['appearanceDraft'];
  client: PortalClient;
  userId: string;
  tenantId: string;
  instanceId: string;
  busy: StoreAreaData['busy'];
  retry: StoreAreaData['retry'];
  otherDraft: [string, boolean] | undefined;
  photoBlocks: StoreAreaData['photoBlocks'];
  photoState: (id: string, dirty: boolean, blocking: boolean) => void;
  load: StoreAreaData['load'];
  dirtyForms: Record<string, boolean>;
}

export function HostedStorePublishArea({
  area, preview, appearanceEnabled, appearance, areaLocked, can,
  templateChoice, setTemplateChoice, markDirty, command, root, appearanceError, loading,
  locked, appearanceDraft, client, userId, tenantId, instanceId, busy,
  retry, otherDraft, photoBlocks, photoState, load, dirtyForms,
}: HostedStorePublishAreaProps) {
  return <section id="store-publish-panel" tabIndex={-1} hidden={area!=='publish'} className="hosted-supply-panel stack" aria-labelledby="store-publish-title"><h3 id="store-publish-title">店面</h3>
          {!appearanceEnabled && appearance && <fieldset disabled={areaLocked || !can('store:manage')} className="hosted-store-templates">
            <legend>商店版型</legend>
            {([['catalog-grid-v1', '格狀目錄', '商品並排展示，手機改為單欄。'], ['catalog-list-v1', '直列目錄', '商品逐項排列，方便閱讀較長說明。']] as const).map(([id, label, hint]) => <label key={id}>
              <input type="radio" name="store-template" value={id} checked={(templateChoice ?? appearance.template_id) === id} onChange={() => {setTemplateChoice(id); markDirty('appearance', id !== appearance.template_id);}}/>
              <span>{label}<small>{hint}</small></span>
            </label>)}
          </fieldset>}
          {!appearanceEnabled && appearance && can('store:manage') && <div className="actions"><button type="button" className="btn btn-ghost" disabled={areaLocked || !templateChoice || templateChoice === appearance.template_id} onClick={() => void command({method: 'patch', path: root + '/appearance', body: {template_id: templateChoice}, version: appearance.version, schema: StoreAppearanceSchema, notice: '已儲存版型。', success: () => {setTemplateChoice(null); markDirty('appearance', false);}})}>儲存版型</button></div>}
          {appearanceEnabled&&<>
            {appearanceError&&<div><p role="alert">店面外觀暫時無法讀取。請重試。</p><div className="actions"><button type="button" className="btn btn-ghost btn-sm" disabled={loading||locked} onClick={()=>void load()}>重新讀取店面外觀</button></div></div>}
            {appearanceDraft?<HostedStoreAppearance client={client} userId={userId} tenantId={tenantId} instanceId={instanceId} draft={appearanceDraft} writable={can('store:manage')}
              locked={loading||busy||retry!==null||!!otherDraft||appearanceError||Object.entries(photoBlocks).some(([id,blocking])=>id!=='appearance'&&blocking)}
              onState={(dirty,blocking)=>photoState('appearance',dirty,blocking)} onSaved={load}/>:!appearanceError&&<p role="status">正在讀取店面外觀…</p>}
          </>}
          {preview && <div className="actions"><a href={`/api/v1${root}/preview-page`} target="_blank" rel="noopener">預覽已儲存的展示頁</a></div>}
          {dirtyForms.appearance && <p className="field-hint">{appearanceEnabled?'請先儲存店面外觀，再開啟預覽。':'請先儲存版型，再開啟預覽。'}</p>}
        </section>;
}
