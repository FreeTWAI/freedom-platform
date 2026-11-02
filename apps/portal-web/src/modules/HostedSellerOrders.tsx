import {sellerConsoleHref} from '../../../../modules/agent-commerce/seller-console/route';
import {useEffect, useRef, useState} from 'react';
import {type ReservationOrder as HostedOrder} from '../../../../contracts/guild-launchpad/v1/hosted-shared-order';
import {ApiError, type PortalClient} from '../api';
import {formatIsoLocal, formatMinor} from '../format';
import {readSellerPage, readSellerCancel, type SellerCancelAttempt, type SellerRoute} from './hosted-seller-order-state';
import './HostedStore.css';

type RegisterLeave = (guard: (() => boolean) | null) => void;
const unavailable = () => new ApiError({message: '回應未完整收到，尚未確認原取消結果。', network: true});
const word = (order: HostedOrder) => order.state === 'reserved' ? '預留中' : order.state === 'cancelled' ? '已取消' : '已到期';
const rootPath = (route: SellerRoute) => `/tenants/${route.tenantId}/storefronts/${route.instanceId}/reservations`;

/** This successful owner-only read, not a role template or guild title, enables the link. */
export function SellerOrdersLink({client, tenantId, instanceId,readinessHref}: SellerRoute & {client: PortalClient;readinessHref?:string}) {
  const generation = client.sessionGeneration;
  const scope = useRef({client, tenantId, instanceId, generation});
  scope.current = {client, tenantId, instanceId, generation};
  type Read = typeof scope.current & {controller: AbortController; pending: boolean};
  const active = useRef<Read | null>(null);
  const [result, setResult] = useState<{read: Read; status: 'allowed' | 'failed'} | null>(null);
  const [attempt, setAttempt] = useState(0);
  const sameScope = (read: Read) => read.client === scope.current.client && read.tenantId === scope.current.tenantId &&
    read.instanceId === scope.current.instanceId && read.generation === scope.current.generation && read.generation === read.client.sessionGeneration;
  const live = (read: Read) => active.current === read && !read.controller.signal.aborted && sameScope(read);
  useEffect(() => {
    const read: Read = {...scope.current, controller: new AbortController(), pending: true};
    active.current = read; setResult(null);
    void client.get(rootPath({tenantId, instanceId}) + '?limit=1', {signal: read.controller.signal}).then(raw => {
      if (!live(read)) return;
      if (!readSellerPage(raw)) throw new Error('Invalid owner reservation page');
      read.pending = false; setResult({read, status: 'allowed'});
    }).catch(error => {
      if (!live(read)) return;
      read.pending = false;
      if (!(error instanceof ApiError && (error.status === 403 || error.status === 404))) setResult({read, status: 'failed'});
    });
    return () => read.controller.abort();
  }, [client, tenantId, instanceId, generation, attempt]);
  const current = result && live(result.read) ? result : null;
  const retry = () => {
    if (!current || current.status !== 'failed' || !live(current.read) || current.read.pending) return;
    current.read.pending = true; setResult(null); setAttempt(value => value + 1);
  };
  // Only a validated owner read enables order links. Readiness was authorized by
  // the parent; retry never repeats a cancellation or any other write.
  return <div className="actions hosted-seller-order-links">{readinessHref&&<a className="btn btn-ghost" href={readinessHref}>開店準備</a>}{current?.status === 'allowed' && <><a className="btn btn-ghost" href={`#stores/${tenantId}/${instanceId}/orders`}>預留訂單</a><a className="btn btn-ghost" href={`#stores/${tenantId}/${instanceId}/supply-orders`}>供貨訂單</a></>}{current?.status === 'failed' && <><span role="status">暫時無法讀取訂單入口。</span><button type="button" className="btn btn-ghost btn-small" onClick={retry}>重試讀取訂單入口</button></>}</div>;
}

/** Mounted by exact account/session/store key. No private order data is persisted. */
export function HostedSellerOrders({client, route, registerLeave, commerceConsoleEnabled=false}: {commerceConsoleEnabled?:boolean;client: PortalClient; route: SellerRoute; registerLeave: RegisterLeave}) {
  const root = rootPath(route);
  const [page, setPage] = useState<ReturnType<typeof readSellerPage>>(null);
  const [selected, setSelected] = useState<HostedOrder | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [unknown, setUnknown] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const held = useRef<SellerCancelAttempt | null>(null), busyRef = useRef(false);
  const controller = useRef(new AbortController()), reads = useRef(0), generation = useRef(client.sessionGeneration);
  const status = useRef<HTMLParagraphElement>(null);
  const live = () => !controller.current.signal.aborted && generation.current === client.sessionGeneration;
  function announce(message: string) {setNotice(message); requestAnimationFrame(() => status.current?.focus());}
  function canLeave() {
    if (busyRef.current || held.current) {announce('請先確認原取消結果，再離開這頁。'); return false;}
    return true;
  }
  useEffect(() => {registerLeave(canLeave); return () => registerLeave(null);}, [registerLeave]);
  useEffect(() => {
    controller.current = new AbortController(); generation.current = client.sessionGeneration;
    const unload = (event: BeforeUnloadEvent) => {if (busyRef.current || held.current) {event.preventDefault(); event.returnValue = '';}};
    window.addEventListener('beforeunload', unload); void loadPage();
    return () => {controller.current.abort(); reads.current++; window.removeEventListener('beforeunload', unload);};
  }, [client, root]);
  function failure(cause: unknown) {
    if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) return '目前無法讀取這間商店的預留。只有目前業務空間擁有者可以查看與取消。';
    return cause instanceof ApiError ? cause.message : '暫時無法確認回應，請重新查詢。';
  }
  async function loadPage(cursor?: string) {
    if (held.current || busyRef.current) return;
    const ticket = ++reads.current; setLoading(true); setError(''); setSelected(null); setPage(null);
    try {
      const next = readSellerPage(await client.get(root + '?limit=20' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''), {signal: controller.current.signal}));
      if (!next) throw unavailable();
      if (live() && reads.current === ticket) setPage(next);
    } catch (cause) {if (live() && reads.current === ticket) setError(failure(cause));}
    finally {if (live() && reads.current === ticket) setLoading(false);}
  }
  function adopt(order: HostedOrder) {
    setSelected(order); setPage(old => old && {...old, items: old.items.map(o => o.order_id === order.order_id ? order : o)});
  }
  function clearAttempt() {held.current = null; setUnknown(false);}
  async function readCurrent(order: HostedOrder) {
    if (busyRef.current) return;
    const ticket = ++reads.current; setLoading(true); setError('');
    try {
      const raw = await client.get(root + '/' + order.order_id, {signal: controller.current.signal});
      const observation = readSellerCancel(raw, held.current?.order ?? order);
      if (!observation) throw unavailable();
      if (live() && reads.current === ticket) {
        adopt(observation.order);
        if (held.current && observation.confirmed) {clearAttempt(); announce('已確認這筆預留已結束。');}
      }
    } catch (cause) {
      if (live() && reads.current === ticket) {setError(failure(cause)); if (!held.current) {setSelected(null); setPage(null);}}
    } finally {if (live() && reads.current === ticket) setLoading(false);}
  }
  async function send(attempt: SellerCancelAttempt) {
    if (busyRef.current || !live()) return;
    held.current = attempt; busyRef.current = true; reads.current++; setLoading(false); setBusy(true); setError('');
    try {
      const raw = await client.post(root + '/' + attempt.order.order_id + '/cancel', attempt.body,
        {idempotencyKey: attempt.key, ifMatch: attempt.order.version, signal: controller.current.signal});
      const observation = readSellerCancel(raw, attempt.order);
      if (!observation?.confirmed) throw unavailable();
      if (!live()) return;
      clearAttempt(); adopt(observation.order); announce('已確認預留結束，商品不再為這筆預留保留。');
    } catch (cause) {
      if (!live()) return;
      if (attempt.unknown || !(cause instanceof ApiError) || cause.network || cause.status >= 500) {
        attempt.unknown = true; setUnknown(true); setError('尚未確認原取消結果。請查詢原預留或重試原取消；重試保留相同內容。');
      } else {
        clearAttempt(); setError(failure(cause));
        // A known stale version is not a new cancellation. Remove the old actionable
        // projection until a fresh authorized read succeeds and the owner confirms again.
        if (cause.status === 412) {
          setSelected(null); setPage(null); busyRef.current = false;
          await readCurrent(attempt.order);
          if (live()) announce('預留版本已更新，已重新查詢。請核對新版內容，再決定是否取消。');
        } else if (cause.status === 403 || cause.status === 404) {setSelected(null); setPage(null);}
      }
    } finally {if (live()) {busyRef.current = false; setBusy(false);}}
  }
  function cancel(order: HostedOrder) {
    if (held.current || busyRef.current || loading || order.state !== 'reserved') return;
    if (window.confirm('取消這筆預留並釋放商品？這不是退款或取消出貨。')) void send({order, key: crypto.randomUUID(), body: {}, unknown: false});
  }
  const locked = busy || unknown || loading;
  const bookmark = `${window.location.origin}/#stores/${route.tenantId}/${route.instanceId}/orders`;
  return <div className="hosted-store stack">
    <div className="actions"><a className="btn btn-ghost" href={`#stores/${route.tenantId}/${route.instanceId}`}>返回商店後台</a></div>
    <h2>商店預留訂單</h2>{commerceConsoleEnabled&&<div className="actions"><a className="btn btn-ghost btn-small" href={sellerConsoleHref(route,'orders')}>結帳訂單</a></div>}<p className="banner" role="note">本頁只顯示 30 分鐘預留，不包含結帳訂單。預留尚未付款／未履約；本頁不提供付款、退款或出貨操作。</p>
    <p ref={status} role="status" tabIndex={-1}>{loading ? '正在確認目前預留…' : notice}</p>
    {error && <p className="banner banner-error" role="alert">{error}</p>}
    {unknown && <div className="actions"><button className="btn btn-ghost" disabled={busy || loading} onClick={() => held.current && void send(held.current)}>重試原取消</button><button className="btn btn-ghost" disabled={busy || loading} onClick={() => held.current && void readCurrent(held.current.order)}>查詢原預留</button></div>}
    <div className="actions"><button className="btn btn-ghost" disabled={locked} onClick={() => void loadPage()}>更新清單／回到最新</button></div>
    {page && <>
      {!page.items.length && <p>這一頁沒有預留訂單。</p>}
      <ul className="stack">{page.items.map(order => <li className="hosted-store-product stack" key={order.order_id}>
        <strong>{word(order)} · {formatMinor(order.merchandise_total_minor, order.currency)}（商品金額，非應付金額）</strong>
        <p>{formatIsoLocal(order.created_at)} · {order.items.map(i => `${i.title} × ${i.quantity}`).join('、')}</p>
        <p>預留編號：{order.order_id}</p><div className="actions"><button className="btn btn-ghost" disabled={locked} onClick={() => void readCurrent(order)}>查看這筆預留</button></div>
      </li>)}</ul>
      {page.next_cursor && <div className="actions"><button className="btn btn-ghost" disabled={locked} onClick={() => void loadPage(page.next_cursor!)}>較早的預留</button></div>}
    </>}
    {selected && <section className="stack" aria-label="預留明細"><h3>{selected.store.name} · {word(selected)}</h3>
      <p>預留編號：{selected.order_id}</p><p>預留截止：{formatIsoLocal(selected.reservation_expires_at)}</p>
      <ul>{selected.items.map(i => <li key={i.sku}>{i.title} × {i.quantity} · 單價 {formatMinor(i.unit_price_minor, selected.currency)} · 小計 {formatMinor(i.line_total_minor, selected.currency)}</li>)}</ul>
      <p><strong>商品金額：{formatMinor(selected.merchandise_total_minor, selected.currency)}</strong>（非應付金額）</p>
      {selected.state === 'reserved' && <div className="actions"><button className="btn btn-ghost" disabled={locked} onClick={() => cancel(selected)}>取消這筆預留</button></div>}
    </section>}
    {(page || selected) && <label className="field"><span>保存店主管理連結（需要目前擁有者登入）</span><input readOnly value={bookmark} onFocus={event => event.target.select()}/></label>}
  </div>;
}
