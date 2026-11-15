import {currentLegacyHash} from '../portal-route';
import {personalPostPath} from './personal-space-model';
import { lazy, useEffect, useRef, useState } from 'react';
import { accessAwareFetch } from '../access-fetch';
import { client, describeError } from '../portal-session';
import { PageLoadBoundary } from '../LazyPage';
import './WorkSharing.css';

// Keep authoring code off the initial shell and personal-content list paths.
const ShowcaseDraftEditor = lazy(() => import('./ShowcasePanel').then(module => ({default: module.ShowcaseDraftEditor})));

export type PersonalContentItem = { kind: 'showcase' | 'skill_submission' | 'event' | 'social_post'; id: string; title: string; status: string; version: string | number | null; path: string; manage_path?: string; visibility: string; actions: string[] };
const actionLabels: Record<string, string> = { manage: '管理作品', continue: '繼續', edit: '編輯', view: '查看', withdraw: '撤下', cancel: '取消活動', cancel_review: '取消審核', publish: '檢查並發布' };
const selectedShowcase = () => /^#my-content\/showcases\/([^/?]+)$/.exec(currentLegacyHash())?.[1] ?? null;
export function personalContentActionPath(item: PersonalContentItem, action: string): string | null {
  if (item.kind === 'social_post') return action === 'view' ? personalPostPath(item) : null;
  const id = encodeURIComponent(item.id);
  if (item.kind === 'showcase') return action === 'view' ? `#showcase/${id}` : `#my-content/showcases/${id}`;
  if (item.kind === 'skill_submission' && action === 'manage') return /^#opensource\?project=[0-9a-f-]{36}$/.test(item.manage_path ?? '') ? item.manage_path! : null;
  if (item.kind === 'skill_submission') return action === 'view' && /^\/development\/submissions\/[0-9a-f-]{36}$/.test(item.path) ? item.path : `#opensource?submission=${id}&action=${encodeURIComponent(action)}`;
  if (item.kind === 'event') return `#events/${id}${action === 'edit' ? '?edit=1' : action === 'cancel' || action === 'cancel_review' ? '?action=cancel' : ''}`;
  return item.path.startsWith('#') ? item.path : null;
}

export function MyContent() {
  const [selected, setSelected] = useState<string | null>(selectedShowcase);
  useEffect(() => { const change = () => setSelected(selectedShowcase()); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  if (!selected) return null;
  return <PageLoadBoundary label="私人作品編輯" resetKey={selected}><ShowcaseDraftEditor key={selected} id={selected === 'new' ? null : selected} onChanged={id => {
    if (selected === 'new' && id) window.history.replaceState(window.history.state, '', '#me/content/showcases/' + encodeURIComponent(id));
  }} onClose={() => { window.location.hash = 'me'; }}/></PageLoadBoundary>;
}

export function ContentItemActions({item, omit, onChanged}:{item:PersonalContentItem;omit?:string;onChanged:()=>void}) {
  const actions=item.actions.filter(action=>action!==omit&&(item.kind==='social_post'&&action==='withdraw'||personalContentActionPath(item,action)&&actionLabels[action]));
  if (!actions.length) return null;
  return <details className="personal-space-more"><summary>更多</summary><div className="actions">{actions.map(action => {
    if (item.kind === 'social_post' && action === 'withdraw') return <SocialWithdrawal key={action} item={item} onChanged={onChanged}/>;
    return <a className="btn btn-secondary btn-small" key={action} href={personalContentActionPath(item,action)!}>{actionLabels[action]}</a>;
  })}</div></details>;
}

export function SocialWithdrawal({ item, onChanged }: { item: PersonalContentItem; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const key = useRef<string | null>(null), mounted = useRef(true), locked = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function withdraw() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    key.current ??= crypto.randomUUID();
    const csrf = client.csrfToken;
    const generation = client.sessionGeneration;
    const live = () => mounted.current && generation === client.sessionGeneration;
    try {
      if (!csrf) throw new Error('請重新登入後再撤下動態。');
      const response = await accessAwareFetch(`/api/v1/social-posts/${encodeURIComponent(item.id)}`, {
        method: 'DELETE', credentials: 'same-origin', body: '{}',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': key.current },
      });
      if (!live()) return;
      if (!response.ok) {
        const problem = await response.json();
        throw new Error(problem.detail ?? '動態未能撤下。');
      }
      if (live()) onChanged();
    } catch (cause) { if (live()) setError(describeError(cause).message); }
    finally { locked.current = false; if (live()) setBusy(false); }
  }
  return <div className="stack">{confirm ? <><p>確認刪除「{item.title}」？原始動態會撤下。</p><div className="actions"><button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void withdraw()}>{error ? '重試撤下' : '確認撤下'}</button><button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => setConfirm(false)}>取消</button></div></> : <button type="button" className="btn btn-secondary btn-small" onClick={() => setConfirm(true)}>撤下</button>}{error && <p role="alert">{error}</p>}</div>;
}
