import {useCallback, useEffect, useRef, useState} from 'react';
import {ApiError, type PortalClient} from '../api';
import {LaunchFlow, REASONS, savedStoreLaunch, startable} from './GuildLaunchpadApplications';
import {GuildJoinReceiptSchema, readStoreSetup, setupGuild, setupListPath, type StoreSetupPurpose} from './store-setup';

type RegisterLeave = (guard: ((nextHash: string | null) => boolean) | null) => void;
type Props = {client: PortalClient; userId: string; registerLeave: RegisterLeave; purpose?: StoreSetupPurpose};
type JoinAttempt = {path: string; key: string; body: Record<string, never>; version?: number};

// Keep even same-member re-logins from adopting an old read or command response.
export function StoreSetup({purpose = 'retail', ...props}: Props) {
  return <StoreSetupJourney key={`${props.userId}:${props.client.sessionGeneration}:${purpose}`} {...props} purpose={purpose}/>;
}

function StoreSetupJourney({client, userId, registerLeave, purpose}: Required<Props>) {
  const guildKey = setupGuild(purpose), listPath = setupListPath(purpose), supply = purpose === 'supply';
  const [data, setData] = useState<Awaited<ReturnType<typeof readStoreSetup>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinUnknown, setJoinUnknown] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const owner = useRef(client.sessionGeneration);
  const mounted = useRef(true);
  const controller = useRef(new AbortController());
  const joiningRef = useRef(false);
  const attempt = useRef<JoinAttempt | null>(null);
  const flowGuard = useRef<(() => boolean) | null>(null);
  const leavingForStore = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(savedStoreLaunch(userId, guildKey));
  const live = () => mounted.current && !controller.current.signal.aborted && owner.current === client.sessionGeneration;

  async function load() {
    if (!live()) return;
    setLoading(true); setReadFailed(false); setProblem('');
    try {
      const next = await readStoreSetup(client, purpose, controller.current.signal);
      if (live()) setData(next);
    } catch (error) {
      if (live()) {setReadFailed(true); setProblem(error instanceof ApiError ? error.message : '暫時無法確認開店資格，請重試。');}
    } finally {if (live()) setLoading(false);}
  }
  useEffect(() => {
    mounted.current = true; controller.current = new AbortController();
    heading.current?.focus(); void load();
    return () => {mounted.current = false; controller.current.abort();};
  }, []);

  const canLeave = useCallback(() => {
    if (attempt.current) {
      setProblem(joiningRef.current ? '正在確認加入公會，請等候完成。' : '加入結果尚未確認，請先重試原操作。');
      return false;
    }
    return flowGuard.current?.() ?? true;
  }, []);
  const registerFlow = useCallback((guard: (() => boolean) | null) => {flowGuard.current = guard;}, []);
  useEffect(() => {
    registerLeave(canLeave);
    const unload = (event: BeforeUnloadEvent) => {if (attempt.current) {event.preventDefault(); event.returnValue = '';}};
    window.addEventListener('beforeunload', unload);
    return () => {registerLeave(null); window.removeEventListener('beforeunload', unload);};
  }, [registerLeave, canLeave]);

  async function join() {
    if (!live() || joiningRef.current || !data || loading || readFailed) return;
    if (!attempt.current) attempt.current = {path: `/guilds/${guildKey}/join`, body: {}, key: crypto.randomUUID(), version: data.guild.membership?.aggregate_version};
    const held = attempt.current;
    joiningRef.current = true; setJoining(true); setProblem('');
    try {
      const response = await client.post(held.path, held.body, {idempotencyKey: held.key, ifMatch: held.version, signal: controller.current.signal});
      if (!live()) return;
      if (!GuildJoinReceiptSchema.safeParse(response).success) throw new ApiError({message: '加入的回應未完整收到，請重試原操作。', network: true});
      attempt.current = null; setJoinUnknown(false); setNotice(`已加入${data.guild.name}，繼續設定${supply ? '供貨資料' : '商店'}。`);
      window.dispatchEvent(new Event('freedom-profile-updated'));
      await load();
    } catch (error) {
      if (!live()) return;
      const unknown = !(error instanceof ApiError) || error.network || error.status >= 500;
      setJoinUnknown(unknown);
      if (unknown) setProblem('加入結果尚未確認。請重試原操作，不會重複加入。');
      else {
        attempt.current = null;
        if (error.status === 412 || error.status === 428) {
          await load();
          if (live()) setProblem('公會資格已更新，請確認目前狀態後再繼續。');
        } else setProblem(error.message);
      }
    } finally {if (live()) {joiningRef.current = false; setJoining(false);}}
  }

  function back() {if (!leavingForStore.current && canLeave()) window.location.hash = listPath;}
  const app = previous.current?.application ?? data?.app ?? null;
  const eligible = Boolean(data?.app && startable(data.app));
  const allowNewLaunch = eligible && app?.release_ref === data?.app?.release_ref;
  const canJoin = data && data.guild.membership?.state !== 'active';
  const canResume = Boolean(previous.current && app);
  return <section className="hosted-store stack" aria-label={supply ? '開始供貨設定' : '開始開店'}>
    <div className="actions"><a className="btn btn-ghost" href={listPath} onClick={event => {if (!canLeave()) event.preventDefault();}}>{supply ? '返回供貨商品庫' : '返回我的商店'}</a></div>
    <h2 ref={heading} tabIndex={-1}>{supply ? '建立供貨商品庫' : '建立我的商店'}</h2>
    <ol aria-label={supply ? '供貨設定步驟' : '開店步驟'}>
      <li>{eligible ? '公會資格已確認' : '確認公會資格'}</li>
      <li>建立或選擇自己的業務空間</li>
      <li>{supply ? '填寫商品庫資料與幣別' : '填寫商店資料、網址與幣別'}</li>
      <li>{supply ? '新增商品，再決定是否公開供貨' : '新增商品，確認後上架展示頁'}</li>
    </ol>
    <p className="field-hint">{supply ? '商品庫建立後仍須新增商品、設定供貨條件並確認公開。' : '商店建立後仍須新增商品與發布；能否接單另依付款、交付與准入設定確認。'}幣別建立後不可變更。</p>
    {notice && <p role="status">{notice}</p>}
    {problem && <p role="alert">{problem}</p>}
    {loading && <p role="status">正在確認{ supply ? '供貨' : '開店'}資格與工具…</p>}
    {readFailed && <div className="actions"><button type="button" className="btn btn-ghost" disabled={joining} onClick={() => void load()}>重新確認資格</button></div>}
    {!loading && !readFailed && data && <>
      {!eligible && <section className="card stack" aria-label="開店資格">
        {canJoin ? <>
          <h3>加入{data.guild.name}並繼續</h3>
          <p>使用{ supply ? '供貨' : '開店'}工具需要這個公會的有效成員身分，實習成員也可以使用。按下方按鈕後會加入公會並領取技能書，接著在這裡繼續設定。</p>
          <div className="actions"><button type="button" className="btn btn-primary" disabled={joining} onClick={() => void join()}>{joining ? '正在確認加入…' : joinUnknown ? '重試加入' : `加入${data.guild.name}並繼續`}</button></div>
        </> : <p>公會成員身分已確認，目前還無法啟動{ supply ? '供貨' : '商店'}工具。</p>}
        {data.app?.eligibility?.reason_codes.filter(code => code !== 'commerce_guild_member_required' && code !== 'guild_member_required').map(code => <p className="field-hint" key={code}>{REASONS[code] ?? '目前還無法啟動，請重新確認資格。'}</p>)}
        {!data.app && <p>目前沒有可用的開店工具版本，請稍後重新確認。</p>}
        {!joining && !joinUnknown && <div className="actions"><button type="button" className="btn btn-ghost" onClick={() => void load()}>重新確認資格</button></div>}
      </section>}
      {app && (eligible || canResume) && <>
        {!eligible && <p className="field-hint">可以查看上次的啟動結果；目前資格不足時不能建立新的商店或商品庫。</p>}
        <LaunchFlow key={`${app.application_key}:${app.release_ref}`} client={client} guildKey={guildKey} userId={userId} app={app} onClose={back} canLeave={canLeave} registerPendingLeave={registerFlow} restoredRow={previous.current} allowNewLaunch={allowNewLaunch} setupJourney
          onStore={(tenantId, instanceId) => {if (!canLeave()) return false; leavingForStore.current = true; window.location.hash = `#stores/${tenantId}/${instanceId}${supply ? '/supply' : ''}`; return true;}}/>
      </>}
    </>}
  </section>;
}
