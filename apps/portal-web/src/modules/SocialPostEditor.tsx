import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import {ApiError, type PortalClient} from '../api';
import type {SocialPost} from './SocialZone';

type EditCommand = {postId: string; kind: SocialPost['kind']; revision: number; body: {text: string} | {title: string; note: string | null}; key: string; inFlight: boolean; uncertain: boolean};
const unconfirmed = '尚未確認儲存結果，原內容已保留。請按「確認上次儲存」重試。';
// Only these route/transaction rejections prove a first attempt did not commit.
function rejectedEdit(cause: unknown) {
  return cause instanceof ApiError && !cause.network && !cause.timedOut
    && ({version_conflict: 412, version_required: 428, validation_failed: 422, author_required: 403, not_found: 404, invalid_version: 400, idempotency_required: 400} as Record<string, number>)[cause.code ?? ''] === cause.status;
}

/** Author-only text edit. A link keeps its URL and thumbnail; If-Match is the post revision. */
export function SocialPostEditor({client, post, onClose, onSaved}: {client: PortalClient; post: SocialPost | null; onClose: () => void; onSaved: (post: SocialPost) => void}) {
  const dialog = useRef<HTMLDialogElement>(null), id = useId();
  const [text, setText] = useState(''), [title, setTitle] = useState(''), [note, setNote] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const generation = client.sessionGeneration;
  const scope = useRef({client, generation, commands: new Map<string, EditCommand>()});
  if (scope.current.client !== client || scope.current.generation !== generation) scope.current = {client, generation, commands: new Map()};
  const latest = useRef({client, generation, postId: post?.post_id, post});
  latest.current = {client, generation, postId: post?.post_id, post};
  const held = post ? scope.current.commands.get(post.post_id) : undefined;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (post) {
      const command = scope.current.commands.get(post.post_id);
      setText(command && 'text' in command.body ? command.body.text : post.note ?? '');
      setTitle(command && 'title' in command.body ? command.body.title : post.title);
      setNote(command && 'note' in command.body ? command.body.note ?? '' : post.note ?? '');
      setSaving(command?.inFlight ?? false); setError(command?.uncertain ? unconfirmed : ''); setNotice('');
      if (!element.open) element.showModal();
    } else if (element.open) element.close();
  }, [post, client, generation]);
  async function save(event: FormEvent) {
    event.preventDefault();
    const owner = scope.current;
    if (!post || saving || owner.client !== client || owner.generation !== generation || client.sessionGeneration !== generation || latest.current.postId !== post.post_id) return;
    const command = owner.commands.get(post.post_id) ?? {postId: post.post_id, kind: post.kind, revision: post.revision,
      body: post.kind === 'note' ? {text: text.trim()} : {title: title.trim(), note: note.trim() || null},
      key: crypto.randomUUID(), inFlight: false, uncertain: false};
    if (command.inFlight) return;
    command.inFlight = true; owner.commands.set(post.post_id, command);
    const ownsSession = () => scope.current === owner && client.sessionGeneration === generation;
    const visible = () => ownsSession() && latest.current.postId === command.postId;
    setSaving(true); setError(''); setNotice('');
    try {
      const saved = await client.post<SocialPost>(`/social-posts/${command.postId}/edit`, command.body, {ifMatch: command.revision, idempotencyKey: command.key});
      if (!ownsSession()) return;
      if (!saved || saved.post_id !== command.postId || saved.kind !== command.kind || saved.revision !== command.revision + 1
        || ('text' in command.body ? saved.note !== command.body.text : saved.title !== command.body.title || saved.note !== command.body.note)) {
        throw new ApiError({message: unconfirmed, network: true});
      }
      owner.commands.delete(command.postId);
      if (visible()) {
        // A replay confirms the old command, not a newer edit already read.
        const currentPost = latest.current.post;
        if (currentPost && currentPost.revision > saved.revision) {
          setText(currentPost.note ?? ''); setTitle(currentPost.title); setNote(currentPost.note ?? '');
          setNotice('上次儲存已確認，目前已有較新版本。');
        } else { onSaved(saved); onClose(); }
      }
    } catch (cause) {
      if (!ownsSession()) return;
      if (!command.uncertain && rejectedEdit(cause)) owner.commands.delete(command.postId);
      else command.uncertain = true;
      if (visible()) setError(command.uncertain ? unconfirmed : cause instanceof ApiError && cause.status === 412 ? '這則貼文已在別處更新，請重新整理動態後再編輯。' : cause instanceof Error ? cause.message : '貼文未能更新。');
    } finally { command.inFlight = false; if (visible()) setSaving(false); }
  }

  const unchanged = post ? post.kind === 'note' ? text.trim() === (post.note ?? '') : title.trim() === post.title && (note.trim() || null) === post.note : true;
  return <dialog ref={dialog} className="social-publish-dialog social-edit-dialog" aria-labelledby={`${id}-title`} onCancel={event => {event.preventDefault(); if (!saving) onClose();}} onClose={() => { if (post) onClose(); }}>
    {post && <form className="stack" onSubmit={event => void save(event)} aria-busy={saving}>
      <header className="social-publish-head"><h2 id={`${id}-title`}>編輯貼文</h2><button type="button" className="btn btn-ghost" aria-label="關閉編輯" disabled={saving} onClick={onClose}>關閉</button></header>
      {post.kind === 'note' ? <>
        <label className="field"><span className="sr-only">貼文內容</span><textarea aria-label="貼文內容" autoFocus required rows={6} maxLength={2000} value={text} disabled={saving || !!held} onChange={event => setText(event.target.value)}/></label>
        <p className="muted">{text.length}/2000 · 圖片、讚與留言都會保留。</p>
      </> : <>
        <p className="muted">連結：{post.url}（網址與縮圖不變）</p>
        <label className="field">標題<input autoFocus required maxLength={120} value={title} disabled={saving || !!held} onChange={event => setTitle(event.target.value)}/></label>
        <label className="field">說明（選填）<textarea maxLength={500} rows={3} value={note} disabled={saving || !!held} onChange={event => setNote(event.target.value)}/></label>
      </>}
      {notice && <p role="status">{notice}</p>}
      {error && <p className="banner banner-error" role="alert">{error}</p>}
      <div className="social-edit-actions"><button type="button" className="btn btn-ghost" disabled={saving} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={saving || (!held && (unchanged || (post.kind === 'note' ? !text.trim() : !title.trim())))}>{saving ? '儲存中…' : held ? '確認上次儲存' : '儲存變更'}</button></div>
    </form>}
  </dialog>;
}
