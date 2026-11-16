import type {RefObject} from 'react';
import {formatIsoLocal} from '../format';
import {PublicationReview, ManualCopy} from './hosted-store-area-shared';
import type {StoreAreaData} from './hosted-store-area-shared';

export interface HostedStorePublishBarProps {
  publication: NonNullable<StoreAreaData['view']>['publication'] | undefined;
  preview: StoreAreaData['preview'];
  productCount: number;
  canWrite: boolean;
  canPublish: boolean;
  onAddProduct: () => void;
  publicationReview: StoreAreaData['publicationReview'];
  publishDisabled: boolean;
  publishSaved: () => void;
  hasDraft: boolean;
  photoBlocking: boolean;
  loading: boolean;
  publicPath: string | null | undefined;
  storeCopyUrl: string | null;
  copyAction: {pending: string | null};
  copyLink: (url: string) => Promise<void>;
  copyFeedback: {url: string; message: string} | null;
  manualUrl: string | null;
  manualField: RefObject<HTMLInputElement | null>;
}

/** Single-location store publication status, next step, and actions bar. */
export function HostedStorePublishBar({
  publication,
  preview,
  productCount,
  canWrite,
  canPublish,
  onAddProduct,
  publicationReview,
  publishDisabled,
  publishSaved,
  hasDraft,
  photoBlocking,
  loading,
  publicPath,
  storeCopyUrl,
  copyAction,
  copyLink,
  copyFeedback,
  manualUrl,
  manualField,
}: HostedStorePublishBarProps) {
  const published = publication?.state === 'published';
  const savedProducts = preview?.projection.products.length ?? productCount;
  const dirty = Boolean(preview?.dirty);
  const canShare = Boolean(publicPath && storeCopyUrl);

  let statusText: string;
  if (!published) {
    if (savedProducts === 0) {
      statusText = '還沒公開。下一步：新增第一件商品。';
    } else if (canPublish) {
      statusText = publication?.state === 'unpublished'
        ? '已停止公開。下一步：發布商店。'
        : '還沒公開。下一步：發布商店。';
    } else {
      statusText = '還沒公開。請有發布權限的成員發布。';
    }
  } else if (!dirty) {
    statusText = `已公開第 ${publication.current_revision} 版。`;
  } else {
    statusText = `已公開第 ${publication.current_revision} 版。有變更還沒公開。`;
  }

  const showPublishButton = canPublish && ((!published && savedProducts > 0) || (published && dirty));
  const showReview = showPublishButton && Boolean(publicationReview);
  const showAddButton = !published && savedProducts === 0 && canWrite;
  const showShareActions = published && canShare;
  const showActionRow = showAddButton || showPublishButton || showShareActions;

  const disabledReason = showPublishButton && publishDisabled
    ? (hasDraft
        ? '先儲存或取消還沒儲存的修改。'
        : photoBlocking
          ? '照片還在儲存，完成後就能發布。'
          : loading
            ? '正在確認可上架內容…'
            : null)
    : null;

  return (
    <section className="hosted-store-publish-bar" aria-label="公開狀態">
      <p>{statusText}{published && <> <small className="hosted-store-publish-bar-time">上次發布 {formatIsoLocal(publication.published_at)}</small></>}</p>
      {showReview && publicationReview && <PublicationReview review={publicationReview}/>}
      {showActionRow && (
        <div className="actions">
          {showAddButton && (
            <button type="button" className="btn btn-primary" onClick={onAddProduct}>新增商品</button>
          )}
          {showPublishButton && (
            <button type="button" className="btn btn-primary" disabled={publishDisabled} onClick={publishSaved}>
              {published ? '發布更新' : '發布'}
            </button>
          )}
          {showShareActions && publicPath && storeCopyUrl && (
            <>
              <a href={publicPath} target="_blank" rel="noopener">查看公開頁</a>
              <button
                type="button"
                className="btn btn-ghost"
                aria-busy={copyAction.pending !== null}
                onClick={() => void copyLink(storeCopyUrl)}
              >
                複製連結
              </button>
            </>
          )}
        </div>
      )}
      {disabledReason && <p className="field-hint">{disabledReason}</p>}
      {copyFeedback && storeCopyUrl && copyFeedback.url === storeCopyUrl && (
        <p className="field-hint" role="status">{copyFeedback.message}</p>
      )}
      {manualUrl !== null && manualUrl === storeCopyUrl && (
        <ManualCopy url={manualUrl} fieldRef={manualField}/>
      )}
    </section>
  );
}
