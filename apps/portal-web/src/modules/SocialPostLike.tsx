import {useLayoutEffect, useId, useRef, useState} from 'react';
import {ApiError, type PortalClient} from '../api';
import {SocialIcon} from './SocialTools';

type LikeValue = {liked: boolean; like_count: number};
type Scope = {client: PortalClient; postId: string; generation: number};
type Command = Scope & {liked: boolean; key: string; inFlight: boolean; uncertain: boolean; epoch: number};
type Feedback = {command: Command; phase: 'pending' | 'unknown' | 'rejected'; message: string};
function sameScope(a: Scope, b: Scope) {
  return a.client === b.client && a.postId === b.postId && a.generation === b.generation;
}

/** A local visual preview never replaces the server's confirmed post snapshot. */
export function SocialPostLike({client, postId, liked = false, count = 0, onUpdate}: {
  client: PortalClient; postId: string; liked?: boolean; count?: number; onUpdate: (value: LikeValue) => void;
}) {
  const scope = {client, postId, generation: client.sessionGeneration};
  const latest = useRef(scope); latest.current = scope;
  const commandRef = useRef<Command | null>(null);
  const epoch = useRef(0), mounted = useRef(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pulse, setPulse] = useState(0);
  const descriptionId = useId();
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; ++epoch.current; }; }, [client, postId, scope.generation]);
  const active = feedback && feedback.command.epoch === epoch.current && sameScope(feedback.command, scope) ? feedback : null;
  const busy = active?.phase === 'pending';
  const previewLiked = busy ? active.command.liked : liked;
  const previewCount = busy ? Math.max(0, count + Number(previewLiked) - Number(liked)) : count;
  const retry = active?.phase === 'unknown';

  async function toggle() {
    if (!mounted.current || client.sessionGeneration !== scope.generation || !sameScope(latest.current, scope)) return;
    const existing = commandRef.current?.epoch === epoch.current ? commandRef.current : null;
    if (existing && sameScope(existing, scope) && existing.inFlight) return;
    const command = existing && sameScope(existing, scope) ? existing : {...scope, liked: !liked, key: crypto.randomUUID(), inFlight: false, uncertain: false, epoch: epoch.current};
    command.inFlight = true; commandRef.current = command;
    const ticket = epoch.current;
    const current = () => mounted.current && epoch.current === ticket && sameScope(latest.current, command)
      && client.sessionGeneration === command.generation && commandRef.current === command;
    setFeedback({command, phase: 'pending', message: command.liked ? '正在儲存按讚…' : '正在取消讚…'});
    if (command.liked) setPulse(value => value + 1);
    try {
      const value = await client.post<LikeValue & {post_id: string}>(`/social-posts/${postId}/like`, {liked: command.liked}, {idempotencyKey: command.key});
      if (!current()) return;
      if (!value || value.post_id !== command.postId || typeof value.liked !== 'boolean' || value.liked !== command.liked || !Number.isSafeInteger(value.like_count) || value.like_count < 0) {
        throw new ApiError({message: '按讚回應未完整收到，請重試確認結果。', network: true});
      }
      commandRef.current = null;
      setFeedback(null);
      onUpdate({liked: value.liked, like_count: value.like_count});
    } catch (cause) {
      if (!current()) return;
      const rejected = !command.uncertain && cause instanceof ApiError && !cause.network && cause.status >= 400 && cause.status < 500;
      if (rejected) commandRef.current = null;
      else command.uncertain = true;
      setFeedback({command, phase: rejected ? 'rejected' : 'unknown', message: cause instanceof Error ? cause.message : '尚未確認按讚結果，請重試。'});
    } finally {
      command.inFlight = false;
    }
  }

  const label = retry ? (active.command.liked ? '重試按讚' : '重試取消讚') : previewLiked ? '已讚' : '讚';
  return <>
    <button type="button" className="btn btn-ghost social-post-like" aria-pressed={previewLiked} aria-busy={busy || undefined}
      aria-describedby={active ? descriptionId : undefined} disabled={busy} onClick={() => void toggle()}>
      <span key={pulse} className={pulse > 0 && previewLiked ? 'social-like-icon social-like-pulse' : 'social-like-icon'}><SocialIcon name="like"/></span>
      <span>{label}</span><span className="social-like-count"> · {previewCount}</span>
    </button>
    {active && <span id={descriptionId} className={busy ? 'sr-only' : 'social-like-error'} role={busy ? 'status' : 'alert'}>{active.message}{retry && ' 顯示的是最後確認的狀態，按重試可確認原本操作。'}</span>}
  </>;
}
