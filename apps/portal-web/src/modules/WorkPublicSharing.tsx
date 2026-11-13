import React, { useEffect, useRef, useState } from 'react';
import { client, describeError } from '../portal-session';

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
  workVersion,
  status = 'published',
}: {
  showcaseId: string;
  workVersion?: string | number;
  status?: string;
}) {
  const [state, setState] = useState<WorkSharingState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [error, setError] = useState('');
  const [trackedLink, setTrackedLink] = useState('');
  const [shareNotice, setShareNotice] = useState('');
  const requestSeq = useRef(0);
  const versionKey = workVersion === undefined ? '' : String(workVersion);

  useEffect(() => {
    if (status !== 'published') return;
    let alive = true;
    const seq = ++requestSeq.current;
    setLoaded(false);
    setError('');
    void client
      .get<WorkSharingState>(`/me/showcases/${showcaseId}/sharing`)
      .then(
        next => {
          if (!alive || requestSeq.current !== seq) return;
          setState(next);
          setLoaded(true);
        },
        err => {
          if (!alive || requestSeq.current !== seq) return;
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
  const explain =
    state?.needs_reconfirmation && !state.enabled
      ? '作品更新後已自動關閉公開閱讀，請重新確認開啟。'
      : '開啟後任何人都能透過專屬網址閱讀這件作品，更新或撤下時會自動關閉。';

  async function toggle(nextEnabled: boolean) {
    if (!state || busy) return;
    setBusy(true);
    setError('');
    setShareNotice('');
    setTrackedLink('');
    try {
      const updated = await client.put<WorkSharingState>(
        `/me/showcases/${showcaseId}/sharing`,
        { enabled: nextEnabled, work_version: state.work_version },
        { idempotencyKey: crypto.randomUUID(), ifMatch: state.version },
      );
      setState(updated);
    } catch (err) {
      setError(describeError(err).message);
      try {
        setState(await client.get<WorkSharingState>(`/me/showcases/${showcaseId}/sharing`));
      } catch {
        // Keep visible error if refresh also fails.
      }
    } finally {
      setBusy(false);
    }
  }

  async function shareWork() {
    if (!state?.enabled || !state.available || shareBusy) return;
    setShareBusy(true);
    setError('');
    try {
      const share = await client.post<{ share_id: string }>(
        '/shares',
        { kind: 'work', ref_id: showcaseId },
        { idempotencyKey: crypto.randomUUID() },
      );
      const link = await client.post<{ path: string }>(
        `/shares/${share.share_id}/links`,
        {},
        { idempotencyKey: crypto.randomUUID() },
      );
      const url = `${origin}${link.path}`;
      let copied = false;
      try {
        await navigator.clipboard?.writeText(url);
        copied = true;
      } catch {
        copied = false;
      }
      setTrackedLink(url);
      setShareNotice(copied ? '已複製你的分享連結，有人點擊就會記到你名下：' : '你的分享連結已備妥：');
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <section className="work-public-sharing stack" aria-label="公開閱讀設定">
      <label className="choice work-public-switch">
        <input
          type="checkbox"
          role="switch"
          aria-checked={Boolean(state?.enabled)}
          checked={Boolean(state?.enabled)}
          disabled={busy || !loaded || !state}
          onChange={event => void toggle(event.target.checked)}
        />
        <span>
          <strong>開放公開閱讀</strong>
          <span className="hint work-public-explain">{explain}</span>
        </span>
      </label>
      {state?.enabled && state.available && (
        <div className="work-public-link-row">
          <a className="work-public-link" href={publicPath} target="_blank" rel="noopener noreferrer">
            {publicUrl}
          </a>
          <button type="button" className="btn btn-secondary btn-small" disabled={shareBusy} onClick={() => void shareWork()}>
            {shareBusy ? '產生中…' : '分享'}
          </button>
        </div>
      )}
      {trackedLink && (
        <p className="hint" role="status">
          {shareNotice}
          <a className="work-public-link" href={trackedLink}>
            {trackedLink}
          </a>
        </p>
      )}
      {error && (
        <p className="hint" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
