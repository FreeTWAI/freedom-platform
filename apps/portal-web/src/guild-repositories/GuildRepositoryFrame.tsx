import {useEffect, useRef, useState} from 'react';
import {GUILD_ACTIONS, GUILD_BRIDGE, readGuildFrameMessage, type GuildAction} from '../../../../modules/guild-workspace/repositories/bridge';
import {guildRepositorySite, type GuildRepository} from '../../../../modules/guild-workspace/repositories/registry';
import './GuildRepositoryFrame.css';

const LABELS: Record<GuildAction, string> = {work: '進入工作區', skills: '閱讀技能書', tools: '選擇工具', information: '公會資訊'};

export function GuildRepositoryFrame({repository, onNavigate, actions}: {
  repository: GuildRepository; onNavigate: (action: GuildAction) => void; actions: readonly GuildAction[];
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [height, setHeight] = useState(520);
  const sendInit = useRef<() => void>(() => undefined);
  const actionKey = GUILD_ACTIONS.filter(action => actions.includes(action)).join(',');
  useEffect(() => {
    const channel = crypto.randomUUID();
    let active = true;
    setState('loading'); setHeight(520);
    const timer = window.setTimeout(() => {if (active) setState('failed');}, 9000);
    const init = () => {
      if (!active) return;
      const theme = document.documentElement.dataset.theme;
      // An opaque sandbox origin requires '*'. This payload contains public navigation only.
      frame.current?.contentWindow?.postMessage({protocol: GUILD_BRIDGE, type: 'init', channel,
        guildKey: repository.guild_key, actions: actionKey.split(',').filter(Boolean),
        theme: theme === 'dark' || theme === 'night' ? 'night' : theme === 'versefolk' ? 'versefolk' : 'light'}, '*');
    };
    const receive = (event: MessageEvent) => {
      if (!active || event.source !== frame.current?.contentWindow || event.origin !== 'null') return;
      const message = readGuildFrameMessage(event.data, repository.guild_key, channel);
      if (!message) return;
      if (message.type === 'ready') {window.clearTimeout(timer); setState('ready');}
      if (message.type === 'resize') setHeight(message.height);
      if (message.type === 'navigate' && actionKey.split(',').includes(message.action)) navigate.current(message.action);
    };
    sendInit.current = init;
    window.addEventListener('message', receive);
    const observer = new MutationObserver(init);
    observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
    init();
    return () => {active = false; window.clearTimeout(timer); observer.disconnect(); window.removeEventListener('message', receive); sendInit.current = () => undefined;};
  }, [repository.guild_key, actionKey, attempt]);

  return <section className="guild-repository" aria-label={`${repository.name}啟動台`}>
    {state !== 'ready' && <div className="guild-repository-status" role="status">
      <p>{state === 'loading' ? '正在開啟公會啟動台…' : '啟動台暫時無法開啟，你仍可直接使用下方工作與資源。'}</p>
      {state === 'failed' && <button type="button" className="btn btn-ghost btn-small" onClick={() => setAttempt(value => value + 1)}>重新開啟啟動台</button>}
    </div>}
    <iframe key={attempt} ref={frame} title={`${repository.name}獨立啟動台`} src={guildRepositorySite(repository)}
      sandbox="allow-scripts" referrerPolicy="no-referrer" loading="eager" height={height}
      hidden={state === 'failed'} onLoad={() => sendInit.current()} onError={() => setState('failed')}/>
    <nav className="guild-repository-shortcuts" aria-label="直接進入工作與資源">
      {actions.map(action => <button type="button" className="btn btn-ghost btn-small" key={action} onClick={() => onNavigate(action)}>{LABELS[action]}</button>)}
    </nav>
  </section>;
}
