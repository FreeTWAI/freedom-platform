import type {RefObject} from 'react';
import {StoreViewSchema} from '../../../../contracts/guild-launchpad/v1/storefront';
import {StoreAppearanceSchema} from '../../../../contracts/guild-launchpad/v1/storefront-presentation';
import {HostedStoreAppearance} from './HostedStoreAppearance';
import {PublicationReview, ManualCopy} from './hosted-store-area-shared';
import type {PortalClient} from '../api';
import type {StoreAreaData, StoreArea, StoreAreaStore} from './hosted-store-area-shared';

export interface HostedStorePublishAreaProps {
  area: StoreArea;
  publication: NonNullable<StoreAreaData['view']>['publication'] | undefined;
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
  publicationReview: StoreAreaData['publicationReview'];
  publishDisabled: boolean;
  publishSaved: () => void;
  hasDraft: boolean;
  store: StoreAreaStore;
  view: NonNullable<StoreAreaData['view']>;
  publicPath: string | null | undefined;
  storeCopyUrl: string | null;
  copyAction: {pending: string | null};
  copyLink: (url: string) => Promise<void>;
  copyFeedback: {url: string; message: string} | null;
  manualUrl: string | null;
  manualField: RefObject<HTMLInputElement | null>;
}

export function HostedStorePublishArea({
  area, publication, preview, appearanceEnabled, appearance, areaLocked, can,
  templateChoice, setTemplateChoice, markDirty, command, root, appearanceError, loading,
  locked, appearanceDraft, client, userId, tenantId, instanceId, busy,
  retry, otherDraft, photoBlocks, photoState, load, dirtyForms, publicationReview,
  publishDisabled, publishSaved, hasDraft, store, view, publicPath, storeCopyUrl,
  copyAction, copyLink, copyFeedback, manualUrl, manualField,
}: HostedStorePublishAreaProps) {
  return <section id="store-publish-panel" hidden={area!=='publish'} className="hosted-supply-panel stack" aria-labelledby="store-publish-title"><h3 id="store-publish-title">預覽與發布</h3>
          <p>{publication?.state === 'published' ? `目前公開第 ${publication.current_revision} 版。` : publication?.state === 'unpublished' ? '已停止公開。' : '尚未發布。'}</p>
          {publication?.state === 'published' && preview?.dirty && <p>有尚未發布的變更。</p>}
          {!appearanceEnabled && appearance && <fieldset disabled={areaLocked || !can('store:manage')} className="hosted-store-templates">
            <legend>商店版型</legend>
            {([['catalog-grid-v1', '格狀目錄', '商品並排展示，手機改為單欄。'], ['catalog-list-v1', '直列目錄', '商品逐項排列，方便閱讀較長說明。']] as const).map(([id, label, hint]) => <label key={id}>
              <input type="radio" name="store-template" value={id} checked={(templateChoice ?? appearance.template_id) === id} onChange={() => {setTemplateChoice(id); markDirty('appearance', id !== appearance.template_id);}}/>
              <span>{label}<small>{hint}</small></span>
            </label>)}
          </fieldset>}
          {!appearanceEnabled && appearance && can('store:manage') && <div className="actions"><button type="button" className="btn btn-ghost" disabled={areaLocked || !templateChoice || templateChoice === appearance.template_id} onClick={() => void command({method: 'patch', path: root + '/appearance', body: {template_id: templateChoice}, version: appearance.version, schema: StoreAppearanceSchema, notice: '已儲存版型。重新發布後，公開頁才會更新。', success: () => {setTemplateChoice(null); markDirty('appearance', false);}})}>儲存版型</button></div>}
          {appearanceEnabled&&<>
            {appearanceError&&<div><p role="alert">店面外觀暫時無法讀取。請重試。</p><div className="actions"><button type="button" className="btn btn-ghost btn-sm" disabled={loading||locked} onClick={()=>void load()}>重新讀取店面外觀</button></div></div>}
            {appearanceDraft?<HostedStoreAppearance client={client} userId={userId} tenantId={tenantId} instanceId={instanceId} draft={appearanceDraft} writable={can('store:manage')}
              locked={busy||retry!==null||!!otherDraft||appearanceError||Object.entries(photoBlocks).some(([id,blocking])=>id!=='appearance'&&blocking)}
              onState={(dirty,blocking)=>photoState('appearance',dirty,blocking)} onSaved={load}/>:!appearanceError&&<p role="status">正在讀取店面外觀…</p>}
          </>}
          {preview && <div className="actions"><a href={`/api/v1${root}/preview-page`} target="_blank" rel="noopener">預覽已儲存的展示頁</a></div>}
          {dirtyForms.appearance && <p className="field-hint">{appearanceEnabled?'請先儲存店面外觀，再開啟預覽；公開頁會保留目前發布的版本。':'請先儲存版型，再開啟預覽；公開頁會保留目前發布的版本。'}</p>}
          {can('store:publish') && publicationReview && <PublicationReview review={publicationReview}/>}
          {can('store:publish') && <div className="actions">
            {(publication?.state !== 'published' || preview?.dirty) && <button type="button" className={publicationReview?.preview.projection.products.length ? 'btn btn-primary' : 'btn btn-ghost'} disabled={publishDisabled} onClick={publishSaved}>{publication?.state === 'published' ? '發布更新' : '發布展示頁'}</button>}
            {publication?.state === 'published' && <button type="button" className="btn btn-ghost" disabled={areaLocked || hasDraft} onClick={() => {if (window.confirm(`停止公開後，/shops/${store.slug} 會顯示找不到這間商店。`)) void command({method: 'post', path: root + '/unpublish', body: {}, version: view.version!, schema: StoreViewSchema, notice: '已停止公開。', success: () => {}});}}>停止公開</button>}
          </div>}
          {can('store:publish') && hasDraft && <p className="field-hint">還有尚未儲存的內容。請先儲存商店資料與商品，再發布或停止公開。</p>}
          {can('store:publish') && !preview?.projection.products.length && <p className="field-hint">至少上架一件商品才能發布。</p>}
          {publicPath && storeCopyUrl && <div className="actions"><a href={publicPath} target="_blank" rel="noopener">查看公開頁：{publicPath}</a><button type="button" className="btn btn-ghost" aria-busy={copyAction.pending !== null} onClick={() => void copyLink(storeCopyUrl)}>複製商店連結</button></div>}
          {copyFeedback && storeCopyUrl && copyFeedback.url === storeCopyUrl && <p className="field-hint" role="status">{copyFeedback.message}</p>}
          {manualUrl !== null && manualUrl === storeCopyUrl && <ManualCopy url={manualUrl} fieldRef={manualField}/>}
          {store.slug_locked && <p className="field-hint">網址已固定。</p>}
        </section>;
}
