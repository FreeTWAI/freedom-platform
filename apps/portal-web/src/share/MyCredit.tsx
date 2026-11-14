import {useEffect, useRef, useState} from 'react';
import {AgentHandoff} from '../modules/AgentHandoff';
import type {PortalClient} from '../api';
import {describeError} from '../portal-session';
import {promotionLink, ShareButton, type PromotionKind} from './ShareButton';

type ShareResultKind =
  | 'repository'
  | 'link'
  | 'work'
  | 'event'
  | 'post'
  | 'service'
  | 'skill_book'
  | 'social_post'
  | 'member_service'
  | 'member_card'
  | 'platform';

type ShareResultItem = {
  key: string;
  kind: ShareResultKind;
  title: string;
  available: boolean;
  link: {kind: PromotionKind; target: string; path: string} | null;
  open_path: string | null;
  clicks: number;
  stars: number;
  registrations: number;
  last_at: string;
};

const kindLabels: Record<ShareResultKind, string> = {
  repository: 'GitHub 專案',
  link: '連結',
  work: '作品',
  event: '活動',
  post: '貼文',
  service: '服務',
  skill_book: '技能書',
  social_post: '貼文',
  member_service: '服務',
  member_card: '名片',
  platform: '平台',
};

function formatCounts(item: ShareResultItem): string {
  const parts = [
    item.clicks > 0 ? `點閱 ${item.clicks}` : '',
    item.stars > 0 ? `加星 ${item.stars}` : '',
    item.registrations > 0 ? `報名 ${item.registrations}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '還沒有人點開';
}

export function MyCredit({client}: {client: PortalClient}) {
  const [items, setItems] = useState<ShareResultItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [next, setNext] = useState<number | null>(null);
  const [failedOffset, setFailedOffset] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);
  const mounted = useRef(true);
  const generation = client.sessionGeneration;

  async function load(offset = 0) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++requestSeq.current;
    const live = () =>
      mounted.current &&
      !controller.signal.aborted &&
      requestSeq.current === seq &&
      client.sessionGeneration === generation;
    setError('');
    setFailedOffset(null);
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    try {
      const r = await client.get<{items: ShareResultItem[]; next_offset: number | null}>(
        `/me/share-results?offset=${offset}`,
        {signal: controller.signal},
      );
      if (!live()) return;
      setItems(old => (offset ? [...old, ...r.items] : r.items));
      setNext(r.next_offset);
    } catch (e) {
      if (!live()) return;
      setError(describeError(e).message);
      setFailedOffset(offset);
    } finally {
      if (live()) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    setItems([]);
    setNext(null);
    setError('');
    setFailedOffset(null);
    void load(0);
    return () => {
      mounted.current = false;
      requestSeq.current++;
      abortRef.current?.abort();
    };
  }, [client, generation]);

  return (
    <section className="share-page stack" aria-label="我的貢獻">
      <h2>我的貢獻</h2>
      <AgentHandoff screen="credit" task="查看我的貢獻"/>
      {error && (
        <div className="share-results-error" role="alert">
          <p>{error}</p>
          {failedOffset !== null && (
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => void load(failedOffset)}
            >
              再試一次
            </button>
          )}
        </div>
      )}
      {loading ? (
        <p>載入中…</p>
      ) : !items.length && !error ? (
        <p>還沒有分享。按任何東西上的「分享」開始。</p>
      ) : (
        items.map(item => (
          <article className="card share-result-card" key={item.key}>
            <div className="share-result-row">
              <div className="share-result-meta">
                <span className="badge share-result-kind">{kindLabels[item.kind] ?? item.kind}</span>
                {item.available ? (
                  item.open_path ? (
                    <a className="share-result-title" href={item.open_path}>
                      {item.title}
                    </a>
                  ) : (
                    <strong className="share-result-title">{item.title}</strong>
                  )
                ) : (
                  <strong className="share-result-title">已停止分享</strong>
                )}
              </div>
              {item.available && item.link && (
                <ShareButton
                  title={item.title}
                  fallbackUrl={item.link.path}
                  makeLink={promotionLink(client, item.link.kind, item.link.target)}
                  label="再分享"
                  buttonClassName="btn btn-secondary btn-small"
                />
              )}
            </div>
            <p className="share-result-counts">{formatCounts(item)}</p>
          </article>
        ))
      )}
      {next !== null && !loading && (
        <button
          type="button"
          className="btn btn-secondary btn-small"
          disabled={loadingMore}
          onClick={() => void load(next)}
        >
          {loadingMore ? '載入中…' : '載入更多'}
        </button>
      )}
      <p className="hint">點閱：每位訪客每天最多算一次，自己點的不算。</p>
    </section>
  );
}
