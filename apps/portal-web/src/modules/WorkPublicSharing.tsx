import React, { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import { client, describeError } from '../portal-session';
import { ShareButton, type ShareLink } from '../share/ShareButton';

type WorkSharingState = {
  showcase_id: string;
  status: string;
  visibility: string;
  enabled: boolean;
  available: boolean;
  needs_reconfirmation: boolean;
  work_version: string;
  approved_work_version: string | null;
  version: string;
  public_path: string;
  updated_at: string | null;
};

/** Owner control for opting one exact published work version into public reading and sharing its link. */
export function WorkPublicSharing({
  showcaseId,
  title = '我的作品',
  workVersion,
  status = 'published',
  onReload,
}: {
  showcaseId: string;
  title?: string;
  workVersion?: string | number;
  status?: string;
  onReload: () => Promise<void>;
}) {
  const [state, setState] = useState<WorkSharingState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestSeq = useRef(0);
  const mounted = useRef(true);
  const generation = client.sessionGeneration;
  const current = () => mounted.current && generation === client.sessionGeneration;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestSeq.current++; };
  }, []);
  const versionKey = workVersion === undefined ? '' : String(workVersion);

  useEffect(() => {
    if (status !== 'published') return;
    let alive = true;
    const seq = ++requestSeq.current;
    setLoaded(false);
    setBusy(false);
    setError('');
    void client
      .get<WorkSharingState>(`/me/showcases/${showcaseId}/sharing`)
      .then(
        next => {
          if (!alive || !current() || requestSeq.current !== seq) return;
          setState(next);
          setLoaded(true);
        },
        err => {
          if (!alive || !current() || requestSeq.current !== seq) return;
          setError(describeError(err).message);
          setLoaded(true);
        },
      );
    return () => {
      alive = false;
    };
  }, [showcaseId, status, versionKey]);

  if (status !== 'published') return null;

  const publicPath = state?.public_path ?? `/works/${showcaseId}`;
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const publicUrl = `${origin}${publicPath}`;
  const reviewed = Boolean(versionKey && state?.work_version === versionKey);
  const explain = !reviewed && state
    ? '作品已更新，請重新檢視後再開放'
    :
    state?.needs_reconfirmation && !state.enabled
      ? '作品更新後已自動關閉公開閱讀，請重新確認開啟。'
      : '開啟後任何人都能透過專屬網址閱讀這件作品，更新或撤下時會自動關閉。';

  async function toggle(nextEnabled: boolean) {
    if (!state || busy || !loaded || !reviewed || !current()) return;
    const seq = requestSeq.current;
    const live = () => current() && requestSeq.current === seq;
    setBusy(true);
    setError('');
    try {
      const updated = await client.put<WorkSharingState>(
        `/me/showcases/${showcaseId}/sharing`,
        { enabled: nextEnabled, work_version: versionKey },
        { idempotencyKey: crypto.randomUUID(), ifMatch: state.version },
      );
      if (!live()) return;
      setState(updated);
    } catch (err) {
      if (!live()) return;
      setError(describeError(err).message);
      const conflict = err instanceof ApiError && err.status === 412;
      if (conflict) setLoaded(false);
      try {
        const refreshed = await client.get<WorkSharingState>(`/me/showcases/${showcaseId}/sharing`);
        if (!live()) return;
        setState(refreshed);
        if (conflict) {
          await onReload();
          if (!live()) return;
          setLoaded(true);
        }
      } catch {
        // Keep the old displayed version fenced if either refresh fails.
        if (!live()) return;
      }
    } finally {
      if (live()) setBusy(false);
    }
  }

  async function makeWorkLink(): Promise<ShareLink> {
    const share = await client.post<{ share_id: string }>(
      '/shares',
      { kind: 'work', ref_id: showcaseId },
      { idempotencyKey: crypto.randomUUID() },
    );
    if (!current()) throw new Error('session_changed');
    return client.post<ShareLink>(
      `/shares/${share.share_id}/links`,
      {},
      { idempotencyKey: crypto.randomUUID() },
    );
  }

  return (
    <section className="work-public-sharing stack" aria-label="公開閱讀設定">
      <label className="choice work-public-switch">
        <input
          type="checkbox"
          role="switch"
          aria-checked={Boolean(state?.enabled)}
          checked={Boolean(state?.enabled)}
          disabled={busy || !loaded || !state || !reviewed}
          onChange={event => void toggle(event.target.checked)}
        />
        <span>
          <strong>開放公開閱讀</strong>
          <span className="hint work-public-explain">{explain}</span>
        </span>
      </label>
      {reviewed && state?.enabled && state.available && (
        <div className="work-public-link-row">
          <a className="work-public-link" href={publicPath} target="_blank" rel="noopener noreferrer" title={publicUrl}>
            開啟公開頁 ↗
          </a>
          <ShareButton
            key={generation}
            title={title}
            fallbackUrl={publicPath}
            makeLink={makeWorkLink}
            label="分享"
            buttonClassName="btn btn-secondary btn-small"
            disabled={busy}
          />
        </div>
      )}
      {error && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
