import {useCallback, useEffect, useRef, useState} from 'react';
import {ApiError, type PortalClient} from '../api';
import {formatIsoLocal} from '../format';
import {attendanceAck, attendancePage, type AttendanceAction, type AttendanceItem, type AttendancePage} from './event-attendance-client';
import './EventAttendance.css';

type Props = {client: PortalClient; eventId: string; userId: string; canView?: boolean; onBlockedChange: (blocked: boolean) => void};
type Pending = {eventId: string; memberId: string; nickname: string; path: string; body: AttendanceAction; key: string; version: number};
type Intent = {memberId: string; nickname: string; version: number; action: AttendanceAction['action']};
const states = {unconfirmed: '尚未確認到場', confirmed: '主辦已確認到場', retracted: '已撤回確認，目前尚未確認'};
const unavailableText = {
  self_confirmation: '不能由自己確認自己的到場。', event_unavailable: '活動未開放或已取消，不能新增確認；原有紀錄仍可更正。',
  event_not_started: '活動開始後才能記錄到場。', registration_cancelled: '報名已取消，不能新增到場確認。',
  member_unavailable: '這位會員目前不符合參與資格，不能新增確認；原有紀錄仍可更正。',
  organizer_unavailable: '你目前沒有記錄或更正權限，原有紀錄保留。', version_exhausted: '紀錄暫時無法變更，請聯絡平台管理員。',
};

export function EventAttendance(props: Props) {
  const identity = useRef({client: props.client, event: props.eventId, user: props.userId, generation: props.client.sessionGeneration, revision: 0});
  const value = identity.current;
  if (value.client !== props.client || value.event !== props.eventId || value.user !== props.userId || value.generation !== props.client.sessionGeneration) {
    identity.current = {client: props.client, event: props.eventId, user: props.userId, generation: props.client.sessionGeneration, revision: value.revision + 1};
  }
  const binding = identity.current;
  const isOwner = useCallback(() => identity.current === binding && binding.client.sessionGeneration === binding.generation, [binding]);
  return <Content key={binding.revision} {...props} isOwner={isOwner}/>;
}

function Content({client, eventId, userId, canView = true, onBlockedChange, isOwner}: Props & {isOwner: () => boolean}) {
  const [page, setPage] = useState<AttendancePage | null>(null), [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [intent, setIntent] = useState<Intent | null>(null), [reason, setReason] = useState<'marked_wrong_member' | 'not_confirmed'>('marked_wrong_member');
  const mounted = useRef(false), epoch = useRef(0), sequence = useRef(0), inFlight = useRef(false), uncertain = useRef(false);
  const pending = useRef<Pending | null>(null), view = useRef<AttendancePage | null>(null), choice = useRef<Intent | null>(null);
  const controllers = useRef(new Set<AbortController>()), versions = useRef(new Map<string, number>());
  const currentOffset = useRef(0), focusMember = useRef<string | null>(null), rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const visible = useRef(canView), previousVisibility = useRef(canView); visible.current = canView;
  const current = useCallback((run: number) => mounted.current && run === epoch.current && isOwner(), [isOwner]);
  const clearChoice = useCallback(() => {choice.current = null; setIntent(null);}, []);
  const load = useCallback(async (nextOffset = currentOffset.current) => {
    if (!current(epoch.current) || !visible.current || document.visibilityState !== 'visible') return;
    const run = epoch.current, seq = ++sequence.current, controller = new AbortController(); controllers.current.add(controller);
    setLoading(true); setPage(null); view.current = null; setError(''); clearChoice();
    try {
      const value = await client.get<unknown>(`/events/${eventId}/attendance?limit=20&offset=${nextOffset}`, {signal: controller.signal, suppressConsole: true});
      if (!current(run) || !visible.current || seq !== sequence.current) return;
      if (!attendancePage(value, eventId, userId, nextOffset)) throw new Error('到場紀錄不完整，請重新讀取。');
      if (value.items.some(row => row.version < (versions.current.get(row.member_ref) ?? 1))) throw new Error('讀到較舊的到場紀錄，請重新讀取。');
      for (const row of value.items) versions.current.set(row.member_ref, row.version);
      view.current = value; setPage(value); currentOffset.current = nextOffset; setOffset(nextOffset);
    } catch (cause) {
      if (current(run) && seq === sequence.current) setError(cause instanceof Error ? cause.message : '到場紀錄無法讀取。');
    } finally {
      controllers.current.delete(controller);
      if (current(run) && seq === sequence.current) setLoading(false);
    }
  }, [clearChoice, client, current, eventId, userId]);

  useEffect(() => {
    mounted.current = true; epoch.current++; void load();
    const hide = () => {sequence.current++; view.current = null; setPage(null); clearChoice();};
    const refresh = () => {if (!inFlight.current && document.visibilityState === 'visible') void load();};
    const visibility = () => {if (document.visibilityState === 'visible') refresh(); else hide();};
    const end = () => {
      mounted.current = false; epoch.current++; hide();
      for (const controller of controllers.current) controller.abort();
      pending.current = null; uncertain.current = false; setUnknown(false); setBusy(false); setNotice('');
      onBlockedChange(false); setError('登入狀態已變更，請重新開啟活動。');
    };
    window.addEventListener('focus', refresh); window.addEventListener('pageshow', refresh); window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('freedom-game-console-session-end', end);
    return () => {
      mounted.current = false; epoch.current++; sequence.current++;
      for (const controller of controllers.current) controller.abort(); controllers.current.clear();
      onBlockedChange(false);
      window.removeEventListener('focus', refresh); window.removeEventListener('pageshow', refresh); window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('freedom-game-console-session-end', end);
    };
  }, [clearChoice, load, onBlockedChange]);

  useEffect(() => {
    if (previousVisibility.current === canView) return;
    previousVisibility.current = canView;
    sequence.current++; view.current = null; setPage(null); clearChoice(); setLoading(false);
    // A parent read losing the event/organizer is not an ACK. Hide private
    // details immediately but keep an unresolved original command and guard.
    if (canView) void load();
  }, [canView, clearChoice, load]);

  useEffect(() => {
    if (!loading && page && focusMember.current) {
      rowButtons.current.get(focusMember.current)?.focus(); focusMember.current = null;
    }
  }, [loading, page]);

  async function send(command: Pending) {
    if (inFlight.current || !current(epoch.current)) return;
    const run = epoch.current, controller = new AbortController(); controllers.current.add(controller);
    inFlight.current = true; pending.current = command; sequence.current++; setLoading(false); setBusy(true);
    setError(''); setNotice(''); clearChoice(); onBlockedChange(true);
    let acknowledged = false;
    try {
      const value = await client.post<unknown>(command.path, command.body, {idempotencyKey: command.key, ifMatch: command.version, signal: controller.signal, suppressConsole: true});
      if (!current(run)) return;
      if (!attendanceAck(value, command)) throw new Error('操作回覆尚未確認。');
      acknowledged = true; pending.current = null; uncertain.current = false; setUnknown(false);
      versions.current.set(command.memberId, Math.max(versions.current.get(command.memberId) ?? 1, value.attendance_version));
      view.current = null; setPage(null); focusMember.current = command.memberId;
      setNotice('原操作已確認。正在重新讀取現在的紀錄；報名、完成認定和發獎都沒有改變。');
      // Release BEFORE GET. A refresh failure is not a second unknown mutation.
      onBlockedChange(false);
    } catch (cause) {
      if (!current(run)) return;
      const lost = uncertain.current || !(cause instanceof ApiError) || !cause.definitiveResponse || cause.network || cause.status >= 500;
      uncertain.current = lost; setUnknown(lost); view.current = null; setPage(null);
      if (!lost) pending.current = null;
      setError(lost ? '結果還沒確認，請重試原操作。重新讀取不代表原操作已取消。' : cause instanceof Error ? cause.message : '操作未完成，請重新讀取。');
    } finally {
      controllers.current.delete(controller);
      if (current(run)) {inFlight.current = false; setBusy(false); onBlockedChange(pending.current !== null);}
    }
    if (acknowledged && current(run)) await load();
  }

  function choose(row: AttendanceItem, action: Intent['action']) {
    if (!visible.current || loading || error || pending.current || inFlight.current || !current(epoch.current)) return;
    if (!(action === 'confirm' ? row.can_confirm : row.can_retract)) return;
    const value = {memberId: row.member_ref, nickname: row.nickname, version: row.version, action};
    choice.current = value; setIntent(value); setReason('marked_wrong_member');
  }
  function confirm() {
    const value = choice.current;
    if (!visible.current || !value || loading || error || pending.current || inFlight.current || !current(epoch.current)) return;
    const row = view.current?.items.find(item => item.member_ref === value.memberId);
    if (!row || row.version !== value.version || !(value.action === 'confirm' ? row.can_confirm : row.can_retract)) return;
    const body: AttendanceAction = value.action === 'confirm' ? {action: 'confirm'} : {action: 'retract', reason};
    void send({eventId, memberId: value.memberId, nickname: value.nickname, path: `/events/${eventId}/attendance/${value.memberId}`, body: {...body}, key: crypto.randomUUID(), version: value.version});
  }
  const blocked = loading || busy || unknown || Boolean(error);
  return <section className="event-attendance" aria-label="會員到場紀錄">
    <h3>會員到場紀錄</h3>
    <p>只有目前的主辦者可查看及逐人記錄。報名不等於到場；「尚未確認」也不代表缺席。</p>
    <p className="field-hint">這裡記錄主辦確認的時間，不是實際抵達時間。平台尚未提供完成認定或發獎功能，到場紀錄不代表已完成或已發獎。</p>
    <p className="field-hint">公開報名訪客仍請看「報名名單」；這裡只處理會員，不會依姓名或信箱合併身份。</p>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="banner banner-error">{error}</p>}
    {loading && <p role="status">正在讀取到場紀錄…</p>}
    {!canView && <p role="status">目前無法確認你仍有主辦權限，已隱藏名單並停止新操作。未確認的原操作仍保留，不代表已取消。</p>}
    <div className="experience-actions">
      {unknown && pending.current && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => pending.current && void send(pending.current)}>重試原到場操作</button>}
      <button type="button" className="btn btn-ghost" disabled={!canView || busy || loading} onClick={() => void load()}>重新讀取到場紀錄</button>
    </div>
    {unknown && <p className="field-hint">原會員、內容、操作編號與版本仍保留。確認前不能送出另一筆操作或離開本頁；持續無法確認時請聯絡平台管理員。</p>}
    {canView && page && <>
      {page.items.length === 0 ? <p>這一頁沒有目前報名或曾有到場紀錄的會員。</p> : <ul className="event-attendance-list">{page.items.map(row => <li key={row.member_ref}>
        <strong>{row.nickname}</strong>
        <p>報名：{row.registration_state === 'going' ? '已報名' : '已取消報名，原到場紀錄保留'}</p>
        <p>到場：{states[row.state]}</p>
        {row.recorded_at && <p className="field-hint">最近一次確認由{row.recorded_by === userId ? '你' : '先前主辦者'}記錄於 <time dateTime={row.recorded_at}>{formatIsoLocal(row.recorded_at)}</time>。</p>}
        {row.state === 'retracted' && row.updated_at && <p className="field-hint">已於 <time dateTime={row.updated_at}>{formatIsoLocal(row.updated_at)}</time> 撤回：{row.retraction_reason === 'marked_wrong_member' ? '選錯會員' : '目前無法確認到場'}。</p>}
        {row.confirm_unavailable && row.state !== 'confirmed' && <p className="field-hint">{unavailableText[row.confirm_unavailable]}</p>}
        {row.state === 'confirmed' && !row.can_retract && <p className="field-hint">目前沒有可用的更正權限，原有紀錄保留。請聯絡平台管理員確認資格。</p>}
        <div className="experience-actions">
          <button type="button" className="btn btn-ghost" ref={node => {if (node) rowButtons.current.set(row.member_ref, node); else rowButtons.current.delete(row.member_ref);}}
            disabled={blocked || (row.state === 'confirmed' ? !row.can_retract : !row.can_confirm)}
            aria-expanded={intent?.memberId === row.member_ref} onClick={() => choose(row, row.state === 'confirmed' ? 'retract' : 'confirm')}>
            {row.state === 'confirmed' ? `撤回 ${row.nickname} 的到場確認` : `確認 ${row.nickname} 到場`}
          </button>
        </div>
        {intent?.memberId === row.member_ref && <div className="event-attendance-confirm" role="group" aria-label={`${intent.nickname} 的到場確認`} onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {event.preventDefault(); clearChoice(); rowButtons.current.get(row.member_ref)?.focus();}
        }}>
          <p>{intent.action === 'confirm' ? `確定已由你核對「${intent.nickname}」到場？` : `撤回「${intent.nickname}」的到場確認？只更正到場紀錄，不會取消報名。`}</p>
          {intent.action === 'retract' && <label>更正原因<select value={reason} onChange={event => setReason(event.currentTarget.value as typeof reason)}><option value="marked_wrong_member">選錯會員</option><option value="not_confirmed">目前無法確認到場</option></select></label>}
          <div className="experience-actions"><button type="button" className="btn btn-ghost" disabled={blocked} onClick={confirm}>{intent.action === 'confirm' ? '確定記錄到場' : '確定撤回確認'}</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => {clearChoice(); rowButtons.current.get(row.member_ref)?.focus();}}>返回，不更改</button></div>
        </div>}
      </li>)}</ul>}
      <p>{page.items.length ? `目前第 ${offset + 1}–${offset + page.items.length} 筆，共 ${page.total} 位會員。` : `共 ${page.total} 位會員。`}</p>
      <div className="experience-actions">{offset > 0 && <button type="button" className="btn btn-ghost" disabled={blocked} onClick={() => void load(Math.max(0, offset - 20))}>上一頁會員</button>}{page.next_offset !== null && <button type="button" className="btn btn-ghost" disabled={blocked} onClick={() => void load(page.next_offset!)}>下一頁會員</button>}</div>
    </>}
  </section>;
}
