import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkshopIcon } from '../WorkshopIcon';
import type { TabId } from '../types';
import type { ModulePanelProps } from './shared';

const entries: { tab: TabId; title: string; description: string }[] = [
  { tab: 'skills', title: '技能與工具', description: '找一本技能書，開始練習' },
  { tab: 'events', title: '社群活動', description: '看看聚會，一起交流' },
  { tab: 'members', title: '合作夥伴', description: '認識不同專長的人' },
  { tab: 'showcase', title: '作品交流', description: '分享作品、提出需求' },
];
type Progress =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; hasEngagements: boolean; needsResponse: boolean };

/** Navigation never waits for private progress. Each mounted session owns one small read. */
export function HomeParticipation({ client, onNavigate, personalContentEnabled = false }: ModulePanelProps & { personalContentEnabled?: boolean }) {
  const [progress, setProgress] = useState<Progress>({ state: 'loading' });
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const generation = client.sessionGeneration;
  const load = useCallback(() => {
    if (inFlight.current) return;
    const current = ++sequence.current;
    const abort = new AbortController();
    controller.current = abort;
    inFlight.current = true;
    setProgress({ state: 'loading' });
    const live = () => current === sequence.current && generation === client.sessionGeneration && !abort.signal.aborted;
    void client.get<unknown>('/engagements/summary', { signal: abort.signal }).then(payload => {
      if (!live()) return;
      if (!payload || typeof payload !== 'object'
        || !('has_engagements' in payload) || typeof payload.has_engagements !== 'boolean'
        || !('needs_response' in payload) || typeof payload.needs_response !== 'boolean'
        || (payload.needs_response && !payload.has_engagements)) throw new Error('Invalid cooperation summary');
      setProgress({ state: 'ready', hasEngagements: payload.has_engagements, needsResponse: payload.needs_response });
    }).catch(() => {
      if (live()) setProgress({ state: 'error' });
    }).finally(() => {
      if (current === sequence.current) inFlight.current = false;
    });
  }, [client, generation]);
  useEffect(() => {
    load();
    return () => { sequence.current++; controller.current?.abort(); inFlight.current = false; };
  }, [load]);

  const message = progress.state === 'loading' ? '正在讀取合作進度…'
    : progress.state === 'error' ? '合作進度暫時無法載入，可以重試或直接查看合作紀錄。'
    : progress.needsResponse ? '有合作等你接續處理，前往查看條件或交付進度。'
    : progress.hasEngagements ? '合作紀錄已更新，隨時查看目前狀態。'
    : '還沒有合作紀錄，先從作品交流或認識夥伴開始。';

  return <section className="home-participation" aria-labelledby="home-participation-title">
    <header>
      <h2 id="home-participation-title">一起學、一起做</h2>
      <p>從一個練習、一次交流，找到一起把事情做出來的夥伴。</p>
    </header>
    <nav className="home-participation-entries" aria-label="參與自由工坊">
      {entries.map(entry => <button type="button" key={entry.tab} aria-label={entry.title}
        aria-describedby={`home-entry-${entry.tab}`} onClick={() => onNavigate?.(entry.tab)}>
        <WorkshopIcon name={entry.tab}/>
        <strong>{entry.title}</strong><span id={`home-entry-${entry.tab}`}>{entry.description}</span>
      </button>)}
    </nav>
    <section className="home-return" aria-label="我的合作與內容">
      <div className="home-return-heading">
        <h3>接著做我的事</h3>
        <button type="button" className="btn btn-ghost" aria-disabled={progress.state === 'loading'} onClick={load}>
          {progress.state === 'loading' ? '正在更新…' : progress.state === 'error' ? '重試合作進度' : '更新合作進度'}
        </button>
      </div>
      <p role="status">{message}</p>
      <nav className="home-return-actions" aria-label="我的參與紀錄">
        <button type="button" className="btn btn-ghost" onClick={() => onNavigate?.('engagement')}>查看合作紀錄</button>
        {personalContentEnabled && <button type="button" className="btn btn-ghost" onClick={() => onNavigate?.('my-content')}>接續我的內容</button>}
        <button type="button" className="btn btn-ghost" onClick={() => onNavigate?.('squads')}>我的小隊</button>
      </nav>
    </section>
  </section>;
}
