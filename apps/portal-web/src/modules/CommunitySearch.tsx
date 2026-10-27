import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { communitySearchKinds, communitySearchTopics, communitySearchKindLabels, communitySearchTopicLabels, communitySearchPageSchema, guildSearchPageSchema, type CommunitySearchPage, type GuildSearchPage } from '../../../../packages/shared/community-search';
import { ApiError, type PortalClient } from '../api';
import { CommunityRelationsProvider, CommunityRelations, CommunityBookmarkButton, CommunityAuthorFollowButton } from './CommunityRelations';
import {createCommunitySearch, communityListHistoryForSession, type CommunityListHistory} from './community-search-controller';

type Kind = typeof communitySearchKinds[number];
type Topic = typeof communitySearchTopics[number];
type Mine = { kind: Kind; id: string; title: string; topics: Topic[]; aggregate_version: number | null };
const readQuery = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').toString();
const onSearchPage = () => /^#community-search(?:\?|$)/.test(window.location.hash);
const message = (error: unknown) => error instanceof Error ? error.message : '無法載入，請重試。';
type GuildRequest = {q: string; query: string; signal: AbortSignal; revision: number; generation: number};
const guildNotice = '只搜尋公會名稱與簡介，不套用私人書籤或追蹤清單，也不計入社群內容筆數。';
function guildQuery(query: string, enabled: boolean): string | null {
  const params = new URLSearchParams(query), q = (params.get('q') ?? '').trim();
  if (!enabled || !q || q.length > 80 || /[\u0000-\u001f\u007f]/.test(q)
    || params.get('kinds') || params.get('topics')) return null;
  return q;
}
async function readGuilds(client: PortalClient, q: string, signal: AbortSignal, cursor?: string): Promise<GuildSearchPage> {
  const params = new URLSearchParams({view: 'search', q, limit: '5'});
  if (cursor) params.set('cursor', cursor);
  return guildSearchPageSchema.parse(await client.get<unknown>(`/guilds/directory?${params}`, {signal, suppressConsole: true}));
}

export function CommunitySearch({ client, authKey, relationsEnabled = false, guildSearchEnabled = false }: { client: PortalClient; authKey: string | null; relationsEnabled?: boolean; guildSearchEnabled?: boolean }) {
  const lifetime = `${authKey ?? 'anonymous'}:${client.sessionGeneration}`;
  const navigation = authKey && relationsEnabled ? communityListHistoryForSession(client, authKey) : undefined;
  return authKey && relationsEnabled
    ? <CommunityRelationsProvider key={lifetime} client={client}><SearchContent client={client} authKey={authKey} relationsEnabled navigation={navigation} guildSearchEnabled={guildSearchEnabled} /></CommunityRelationsProvider>
    : <SearchContent key={lifetime} client={client} authKey={authKey} relationsEnabled={false} guildSearchEnabled={guildSearchEnabled}/>;
}

function SearchContent({ client, authKey, relationsEnabled, navigation, guildSearchEnabled }: { client: PortalClient; authKey: string | null; relationsEnabled: boolean; navigation?: CommunityListHistory; guildSearchEnabled: boolean }) {
  const generation = client.sessionGeneration;
  const guildEnabled = Boolean(authKey) && guildSearchEnabled;
  const revision = useRef(0);
  const [guildRequest, setGuildRequest] = useState<GuildRequest | null>(null);
  const currentGuildRequest = useRef<GuildRequest | null>(null);
  const search = useMemo(() => createCommunitySearch<CommunitySearchPage>({
    query: readQuery(),
    generation: () => client.sessionGeneration,
    read: async (query, signal) => {
      // Issue a separate result channel at the existing committed-query read,
      // not on input/IME edits. Neither response waits for the other channel.
      const q = guildQuery(query, guildEnabled);
      const request = q === null ? null : {q, query, signal, revision: ++revision.current, generation: client.sessionGeneration};
      currentGuildRequest.current = request;
      setGuildRequest(request);
      return communitySearchPageSchema.parse(await client.get<unknown>(`/community-search?${query}`, {signal, suppressConsole: true}));
    },
    writeQuery: (query, mode) => {
      if (!onSearchPage()) return;
      const hash = `#community-search${query ? `?${query}` : ''}`;
      if (mode === 'push') window.history.pushState(window.history.state, '', hash);
      else window.history.replaceState(window.history.state, '', hash);
    },
  }), [client, authKey, generation, guildEnabled]);
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot, search.getSnapshot);
  const query = useMemo(() => new URLSearchParams(state.query), [state.query]);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLElement>(null);
  useEffect(() => {
    search.start();
    const changed = () => {if (onSearchPage()) search.restore(readQuery());};
    const refreshResults = () => {
      if (onSearchPage() && document.visibilityState === 'visible' && navigator.onLine !== false) search.refresh();
    };
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    window.addEventListener('focus', refreshResults);
    window.addEventListener('online', refreshResults);
    window.addEventListener('pageshow', refreshResults);
    document.addEventListener('visibilitychange', refreshResults);
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('popstate', changed);
      window.removeEventListener('focus', refreshResults);
      window.removeEventListener('online', refreshResults);
      window.removeEventListener('pageshow', refreshResults);
      document.removeEventListener('visibilitychange', refreshResults);
      currentGuildRequest.current = null;
      search.stop();
    };
  }, [search]);
  const page = state.page;
  const guildQ = guildQuery(state.query, guildEnabled);
  const failed = state.status === 'error';
  const busy = !state.composing && ['idle', 'waiting', 'loading'].includes(state.status);
  return <div className="stack community-content-search">
    {relationsEnabled && navigation && <CommunityRelations client={client} navigation={navigation}/>}
    <section className="card stack" aria-label="社群內容搜尋條件">
      <p className="muted">搜尋貼文、作品、技能書與活動；只顯示目前可閱讀的內容。這不是導覽的「搜尋功能」。</p>
      {guildEnabled && <p className="field-hint">輸入關鍵字且未選內容類型或主題時，也會另外搜尋公會名稱與簡介。</p>}
      <form className="stack" onSubmit={event => {event.preventDefault(); search.submit();}}>
        <label className="field">關鍵字<input ref={input} type="search" maxLength={80} value={state.draft}
          onChange={event => search.edit(event.target.value)}
          onCompositionStart={() => search.beginComposition()}
          onCompositionEnd={event => search.endComposition(event.currentTarget.value)}
          onKeyDown={event => {if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || search.getSnapshot().composing)) event.preventDefault();}}
          placeholder="例如：入門教學、設計" /></label>
        <fieldset disabled={state.composing}><legend>內容類型（可複選）</legend><div className="actions">{communitySearchKinds.map(kind => <label key={kind}><input type="checkbox" checked={(query.get('kinds') ?? '').split(',').includes(kind)} onChange={() => search.toggle('kinds', kind)} /> {communitySearchKindLabels[kind]}</label>)}</div></fieldset>
        <fieldset disabled={state.composing}><legend>主題（可複選）</legend><div className="actions">{communitySearchTopics.map(topic => <label key={topic}><input type="checkbox" checked={(query.get('topics') ?? '').split(',').includes(topic)} onChange={() => search.toggle('topics', topic)} /> {communitySearchTopicLabels[topic]}</label>)}</div></fieldset>
        <div className="actions">
          <button type="submit" className="btn btn-secondary btn-small" disabled={state.composing}>搜尋</button>
          {state.query && <button type="button" className="btn btn-ghost btn-small" disabled={state.composing} onClick={() => {search.clear(); input.current?.focus();}}>清除搜尋條件</button>}
          {query.has('cursor') && <button type="button" className="btn btn-secondary btn-small" disabled={state.composing} onClick={() => {search.first(); results.current?.focus();}}>回第一頁</button>}
        </div>
      </form>
    </section>
    <section ref={results} tabIndex={-1} className="stack" aria-label="社群內容搜尋結果" aria-busy={busy}>
      {state.composing && <p role="status">選字完成後會自動搜尋。</p>}
      {busy && <p role="status">正在搜尋社群內容…</p>}
      {failed && <div className="card stack"><p role="alert">{message(state.error)}</p><button type="button" className="btn btn-secondary btn-small" onClick={() => search.submit()}>重試搜尋</button></div>}
      {page && page.items.length > 0 && <p role="status" className="field-hint">本頁顯示 {page.items.length} 筆內容。</p>}
      {page && !page.items.length && <p role="status">沒有符合條件的內容。可更換關鍵字或取消篩選；未標主題的內容仍可用文字搜尋。</p>}
      {page?.items.map(item => <article className="card stack" key={`${item.kind}:${item.id}`}>
        <p className="field-hint">{communitySearchKindLabels[item.kind]}{item.label ? ` · ${item.label}` : ''}</p>
        <h2><a href={item.path} rel="noopener noreferrer" onClick={() => { if (page.operation_id) void client.post(`/community-search/operations/${encodeURIComponent(page.operation_id)}/open`, { kind: item.kind }, { suppressConsole: true, background: true, keepalive: true }).catch(() => undefined); }}>{item.title}</a></h2>
        <p>{item.summary}</p>
        {item.topics.length > 0 && <p className="field-hint">{item.topics.map(topic => communitySearchTopicLabels[topic]).join(' · ')}</p>}
        {relationsEnabled && <div className="actions"><CommunityBookmarkButton client={client} kind={item.kind} id={item.id}/>{item.author_id && <CommunityAuthorFollowButton client={client} authorId={item.author_id}/>}</div>}
      </article>)}
      {page?.next_cursor && <button type="button" className="btn btn-secondary btn-small" onClick={() => {search.next(page.next_cursor!); results.current?.focus();}}>下一頁</button>}
    </section>
    {guildQ !== null && !state.composing && guildRequest?.query === state.query && !guildRequest.signal.aborted
      && guildRequest.generation === client.sessionGeneration
      && <GuildSearchResults key={guildRequest.revision} client={client} request={guildRequest} isCurrent={() => currentGuildRequest.current === guildRequest}/>}
    {authKey && <MyContentTopics key={`${authKey}:${generation}`} client={client} onSaved={() => search.refresh(true)} />}
  </div>;
}

function GuildSearchResults({client, request, isCurrent}: {client: PortalClient; request: GuildRequest; isCurrent: () => boolean}) {
  const [state, setState] = useState<{page: GuildSearchPage | null; error: unknown; busy: boolean; cursor: string}>({page: null, error: null, busy: true, cursor: ''});
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const region = useRef<HTMLElement>(null);
  const {q, generation} = request;
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const abort = () => {pending.current?.abort(); pending.current = null;};
    request.signal.addEventListener('abort', abort);
    // StrictMode's discarded mount must not dispatch an extra catalog read.
    void Promise.resolve().then(() => {if (active) load('');});
    return () => { active = false; mounted.current = false; abort(); request.signal.removeEventListener('abort', abort); };
  }, [client, q, generation]);
  function load(cursor: string) {
    if (pending.current || !mounted.current || !isCurrent() || request.signal.aborted || generation !== client.sessionGeneration) return;
    const controller = new AbortController(); pending.current = controller;
    const live = () => mounted.current && isCurrent() && pending.current === controller && !controller.signal.aborted && !request.signal.aborted && generation === client.sessionGeneration;
    setState({page: null, error: null, busy: true, cursor});
    void readGuilds(client, q, controller.signal, cursor).then(page => {
      if (live()) setState({page, error: null, busy: false, cursor});
    }, error => {
      if (live()) setState({page: null, error, busy: false, cursor});
    }).finally(() => {if (pending.current === controller) pending.current = null;});
  }
  return <section ref={region} tabIndex={-1} className="card stack" aria-label="會員公會搜尋結果" aria-busy={state.busy}>
    <h2>公會</h2><p className="field-hint">{guildNotice}</p>
    {state.busy && <p role="status">正在搜尋公會…</p>}
    {state.error !== null && <><p role="alert">{message(state.error)}</p><button type="button" className="btn btn-secondary btn-small" onClick={() => {load(state.cursor); region.current?.focus();}}>重試公會搜尋</button></>}
    {state.page?.items.length === 0 && <p role="status">沒有符合關鍵字的公會。</p>}
    {state.page && state.page.items.length > 0 && <p role="status" className="field-hint">本頁顯示 {state.page.items.length} 個公會。</p>}
    {state.page?.items.map(item => <article className="stack" key={item.guild_key}><h3><a href={item.path}>{item.name}</a></h3><p>{item.purpose}</p></article>)}
    <div className="actions">
      {state.cursor && <button type="button" className="btn btn-secondary btn-small" disabled={state.busy} onClick={() => {load(''); region.current?.focus();}}>公會回第一頁</button>}
      {state.page?.next_cursor && <button type="button" className="btn btn-secondary btn-small" disabled={state.busy} onClick={() => {load(state.page!.next_cursor!); region.current?.focus();}}>公會下一頁</button>}
    </div>
  </section>;
}

function MyContentTopics({ client, onSaved }: { client: PortalClient; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Mine[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const generation = client.sessionGeneration;
    const live = () => !controller.signal.aborted && generation === client.sessionGeneration;
    setItems(null); setError('');
    void client.get<{ items: Mine[] }>('/community-search/mine', { signal: controller.signal, suppressConsole: true })
      .then(value => { if (live()) setItems(value.items); })
      .catch(cause => { if (live()) setError(message(cause)); });
    return () => controller.abort();
  }, [client, open, retry]);
  return <section className="card stack"><button className="btn btn-secondary btn-small" aria-expanded={open} onClick={() => setOpen(value => !value)}>編輯我的內容主題</button>
    {open && <><p className="field-hint">選填，最多三個；不補主題也能發布及依文字查到。此處列出各類最近可編輯的內容。</p>
      {notice && <p role="status">{notice}</p>}
      {!items && !error && <p role="status">正在載入我的內容…</p>}
      {error && <><p role="alert">{error}</p><button className="btn btn-secondary btn-small" onClick={() => setRetry(value => value + 1)}>重新載入我的內容</button></>}
      {items?.length === 0 && <p>目前沒有可編輯主題的內容。</p>}
      {items?.map(item => <TopicEditor key={`${item.kind}:${item.id}:${item.aggregate_version}`} item={item} client={client} onSaved={() => { setNotice('主題已儲存。'); setRetry(value => value + 1); onSaved(); }} onConflict={() => { setNotice('主題版本已變更，已重新載入。請重新選擇後儲存。'); setRetry(value => value + 1); }} />)}
    </>}
  </section>;
}

function TopicEditor({ item, client, onSaved, onConflict }: { item: Mine; client: PortalClient; onSaved: () => void; onConflict: () => void }) {
  const [topics, setTopics] = useState(item.topics);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function save() {
    if (lock.current) return;
    const generation = client.sessionGeneration;
    const live = () => mounted.current && generation === client.sessionGeneration;
    lock.current = true; setPending(true); setError('');
    const body = { kind: item.kind, id: item.id, topics: [...topics].sort() };
    const signature = JSON.stringify(body);
    if (attempt.current?.body !== signature) attempt.current = { body: signature, key: crypto.randomUUID() };
    try {
      await client.post('/community-search/topics', body, { idempotencyKey: attempt.current.key, ...(item.aggregate_version === null ? {} : { ifMatch: item.aggregate_version }) });
      if (live()) { attempt.current = null; onSaved(); }
    } catch (cause) {
      if (live()) {
        if (cause instanceof ApiError && (cause.conflict || cause.status === 428)) { onConflict(); }
        else setError(message(cause));
      }
    } finally { lock.current = false; if (live()) setPending(false); }
  }
  return <div className="stack"><h3>{item.title} <span className="field-hint">{communitySearchKindLabels[item.kind]}</span></h3>
    <fieldset disabled={pending}><legend>選填主題（最多三個）</legend><div className="actions">{communitySearchTopics.map(topic => <label key={topic}><input type="checkbox" checked={topics.includes(topic)} disabled={!topics.includes(topic) && topics.length >= 3} onChange={() => setTopics(current => current.includes(topic) ? current.filter(value => value !== topic) : [...current, topic])} /> {communitySearchTopicLabels[topic]}</label>)}</div></fieldset>
    {error && <p role="alert">{error}</p>}
    <button className="btn btn-secondary btn-small" disabled={pending} onClick={() => void save()}>{pending ? '正在儲存…' : error ? '重試儲存主題' : '儲存主題'}</button>
  </div>;
}
