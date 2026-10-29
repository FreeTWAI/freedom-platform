import {useCallback, useEffect, useRef, useState} from 'react';
import {ApiError, type PortalClient} from '../api';
import {missionAck, missionView, type MissionAction, type MissionView} from './event-missions-client';
import './EventMissions.css';

type Props = {
  client: PortalClient;
  eventId: string;
  userId: string;
  onBlockedChange: (blocked: boolean) => void;
};
type Pending = {body: MissionAction; key: string; version: number};

export function EventMissions(props: Props) {
  const identity = useRef({client: props.client, revision: 0});
  if (identity.current.client !== props.client) {
    identity.current = {client: props.client, revision: identity.current.revision + 1};
  }
  return <Content
    key={`${identity.current.revision}:${props.client.sessionGeneration}:${props.userId}:${props.eventId}`}
    {...props}
  />;
}

function Content({client, eventId, onBlockedChange}: Props) {
  const [view, setView] = useState<MissionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [notice, setNotice] = useState('');
  const live = useRef(false);
  const epoch = useRef(0);
  const sequence = useRef(0);
  const owner = useRef(client.sessionGeneration);
  const pending = useRef<Pending | null>(null);
  const inFlight = useRef(false);
  const uncertain = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const path = `/events/${eventId}/my-missions`;
  const current = useCallback((run: number) => (
    live.current && run === epoch.current && owner.current === client.sessionGeneration
  ), [client]);

  const load = useCallback(async () => {
    if (!current(epoch.current) || document.visibilityState !== 'visible') return;
    const run = epoch.current;
    const seq = ++sequence.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    setLoading(true);
    setView(null);
    setError('');
    setUnavailable(false);
    try {
      const value = await client.get<unknown>(path, {signal: controller.signal, suppressConsole: true});
      if (!current(run) || seq !== sequence.current) return;
      if (!missionView(value)) throw new Error('小任務資料不完整，請重新讀取。');
      setView(value);
    } catch (cause) {
      if (current(run) && seq === sequence.current) {
        const expectedUnavailable = cause instanceof ApiError && cause.definitiveResponse
          && ((cause.status === 409 && cause.code === 'event_closed')
            || (cause.status === 404 && cause.code === 'not_found'));
        if (expectedUnavailable && !pending.current && !uncertain.current) {
          // This is an unavailable optional feature, not a failed event edit.
          // Never turn an uncertain command into an empty or successful state.
          setUnavailable(true);
        } else {
          setError(cause instanceof Error ? cause.message : '無法讀取小任務。');
        }
      }
    } finally {
      controllers.current.delete(controller);
      if (current(run) && seq === sequence.current) setLoading(false);
    }
  }, [client, current, path]);

  useEffect(() => {
    live.current = true;
    owner.current = client.sessionGeneration;
    epoch.current++;
    void load();
    const refresh = () => {
      if (!inFlight.current && document.visibilityState === 'visible') void load();
    };
    const hide = () => {
      sequence.current++;
      setView(null);
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
      else hide();
    };
    const end = () => {
      live.current = false;
      epoch.current++;
      hide();
      for (const controller of controllers.current) controller.abort();
      onBlockedChange(false);
      setError('登入狀態已變更，請重新開啟活動。');
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('freedom-game-console-session-end', end);
    return () => {
      live.current = false;
      epoch.current++;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      onBlockedChange(false);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('freedom-game-console-session-end', end);
    };
  }, [client, load, onBlockedChange]);

  async function send(command: Pending) {
    if (inFlight.current || !current(epoch.current)) return;
    const run = epoch.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    inFlight.current = true;
    pending.current = command;
    sequence.current++;
    setLoading(false);
    setBusy(true);
    setError('');
    setNotice('');
    onBlockedChange(true);
    try {
      const value = await client.post<unknown>(path, command.body, {
        idempotencyKey: command.key,
        ifMatch: command.version,
        signal: controller.signal,
        suppressConsole: true,
      });
      if (!current(run)) return;
      if (!missionAck(value, eventId, command.body, command.key)) throw new Error('回覆尚未確認。');
      pending.current = null;
      uncertain.current = false;
      setUnknown(false);
      setView(null);
      setNotice(command.body.action === 'clear'
        ? '清除操作已確認；下方重讀目前狀態。保留最小操作版本，避免舊操作復活。'
        : '操作已確認，正在重讀私人進度。');
      // An ACK can be historical. Never render its old result as current progress.
      await load();
    } catch (cause) {
      if (!current(run)) return;
      const lost = uncertain.current || !(cause instanceof ApiError)
        || !cause.definitiveResponse || cause.network || cause.status >= 500;
      uncertain.current = lost;
      setUnknown(lost);
      setView(null);
      if (!lost) pending.current = null;
      setError(lost
        ? '結果尚未確認，請重試原操作。重新讀取不代表原操作已取消。'
        : cause instanceof Error ? cause.message : '操作未完成，請重新讀取。');
    } finally {
      controllers.current.delete(controller);
      if (current(run)) {
        inFlight.current = false;
        setBusy(false);
        onBlockedChange(pending.current !== null);
      }
    }
  }

  function act(body: MissionAction) {
    if (!view || loading || inFlight.current || pending.current || error || !current(epoch.current)) return;
    void send({body, key: crypto.randomUUID(), version: view.version});
  }

  const blocked = busy || loading || unknown || Boolean(error);
  return <section className="event-missions" aria-label="我的活動小任務">
    <h3>我的活動小任務</h3>
    <p>自願的個人練習，不是主辦交辦。進度只有你看得到；可換題、略過，不影響報名。</p>
    <p className="field-hint">「我已完成」是自己記錄，不是到場、交換名片或貢獻證明，沒有積分或勳章。</p>
    {notice && <p role="status">{notice}</p>}
    {unavailable && <p role="status">目前無法使用小任務。活動開放後可重新讀取；不影響其他活動操作。</p>}
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">正在讀取私人進度…</p>}
    {unknown && pending.current && <button
      className="btn btn-ghost" disabled={busy}
      onClick={() => pending.current && void send(pending.current)}
    >重試原操作</button>}
    {(error || unknown || unavailable) && <button
      className="btn btn-ghost" disabled={busy || loading} onClick={() => void load()}
    >重新讀取</button>}
    {view && !view.enabled && view.editable && <button
      className="btn btn-primary" disabled={blocked} onClick={() => act({action: 'start'})}
    >自願開始 3 個小任務</button>}
    {view && !view.editable && <p>活動目前無法存取。舊任務內容不顯示，仍可清除自己的紀錄。</p>}
    {view?.slots.length === 3 && <ol className="event-missions-list">
      {view.slots.map(slot => <li key={slot.slot}>
        <h4>{slot.title}</h4>
        <p>{slot.description}</p>
        <p>{slot.state === 'self_reported' ? '已自行記錄完成' : slot.state === 'skipped' ? '已略過' : '依自己的步調進行'}</p>
        <div className="experience-actions">
          <button className="btn btn-ghost" disabled={blocked || slot.state === 'self_reported'}
            onClick={() => act({action: 'mark_done', slot: slot.slot})}>我已完成</button>
          <button className="btn btn-ghost" disabled={blocked}
            onClick={() => act({action: 'replace', slot: slot.slot})}>換一個</button>
          <button className="btn btn-ghost" disabled={blocked || slot.state === 'skipped'}
            onClick={() => act({action: 'skip', slot: slot.slot})}>略過</button>
        </div>
      </li>)}
    </ol>}
    {view?.enabled && <button className="btn btn-ghost" disabled={blocked} onClick={() => {
      if (window.confirm('清除這場活動的私人小任務內容？報名不會改變。')) act({action: 'clear'});
    }}>關閉並清除小任務</button>}
  </section>;
}
