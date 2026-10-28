import React, {useEffect, useRef, useState} from 'react';
import {PROVIDER_READINESS, RehearsalWorkbench, type Product, type ActiveCue} from '../../../../modules/virtual-commerce/service';
import './VirtualCommerce.css';

const modeLabels = {paused: '已暫停', running: '文字彩排中', takeover: '人工接管', stopped: '已停止'};
const providerLabels: Record<keyof typeof PROVIDER_READINESS, string> = {
  googleTts: 'Google TTS', voiceLicense: '聲線授權', avatarLicense: '人物授權', lipSync: '嘴型與字幕對齊',
  streamingAccount: '直播平台帳號', streamingPush: '推流設定', liveCatalog: '真實商品資料', costApproval: '費用核准',
};
const viewerLabels = {'queued-for-review': '已建立待確認短答，尚未進入預覽。', duplicate: '重複事件已忽略。', ignored: '沒有建立短答；非商品提問、資料已失效或內容超出限制。', full: '彩排事件或佇列已滿，請重新開始彩排。'};

/** Session-keyed by the portal renderer. State never leaves this mounted page. */
export function VirtualCommerce() {
  const [engine] = useState(() => new RehearsalWorkbench());
  const [state, setState] = useState(() => engine.snapshot());
  const [selected, setSelected] = useState('');
  const [title, setTitle] = useState('');
  const [facts, setFacts] = useState('');
  const [source, setSource] = useState('');
  const [script, setScript] = useState('');
  const [viewerText, setViewerText] = useState('');
  const [voice, setVoice] = useState(state.settings.voice);
  const [rate, setRate] = useState(state.settings.rate);
  const [avatar, setAvatar] = useState(state.settings.avatarVersion);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const epoch = useRef(0), viewerSerial = useRef(0);
  const refresh = () => setState(engine.snapshot());
  useEffect(() => {
    ++epoch.current;
    // React effect replay must not keep the cleanup's stopped state.
    engine.restart();
    setState(engine.snapshot());
    const timer = window.setInterval(() => setState(engine.snapshot()), 1000);
    const hide = () => { if (document.hidden && engine.snapshot().mode === 'running') {engine.pause(); setState(engine.snapshot());} };
    document.addEventListener('visibilitychange', hide);
    return () => { ++epoch.current; window.clearInterval(timer); document.removeEventListener('visibilitychange', hide); engine.stop(); };
  }, [engine]);
  const act = (action: () => void) => {
    setError(''); setNotice('');
    try {action();} catch (cause) {setError(cause instanceof Error ? cause.message : '彩排操作失敗。');}
    refresh();
  };
  const next = async (start = false, finished?: ActiveCue) => {
    const current = epoch.current;
    setError(''); setNotice('');
    try {
      if (finished && !engine.finish(finished.id, finished.activation)) {refresh(); return;}
      if (start) engine.start();
      const pending = engine.next(); refresh();
      const cue = await pending;
      if (epoch.current !== current) return;
      if (!cue && !engine.snapshot().active) setNotice('目前沒有可預覽的已核准段落。');
      refresh();
    } catch (cause) {
      if (epoch.current !== current) return;
      setError(cause instanceof Error ? cause.message : '文字預覽失敗。'); refresh();
    }
  };
  const choose = (product: Product | undefined) => {
    setScript('');
    setNotice('已切換商品，未送出的講稿已清除；請依目前商品重新撰寫。');
    setSelected(product?.id ?? ''); setTitle(product?.title ?? ''); setFacts(product?.facts ?? ''); setSource(product?.source ?? '');
  };
  const loadExamples = () => act(() => {
    for (const [index, name] of ['杯子', '提袋', '筆記本'].entries()) {
      engine.upsertProduct({id: `rehearsal-${index + 1}`, title: `測試商品 ${index + 1}：${name}`,
        facts: `這是用來測試講稿流程的虛構${name}，不對應任何在售商品。價格與庫存未設定。`,
        source: '內建合成彩排資料（非供應商事實）', validUntil: Date.now() + 10 * 60_000});
    }
    choose(engine.snapshot().products[0]); setNotice('已載入3項合成測試商品；未讀取或修改真實商品。');
  });
  const product = state.products.find(item => item.id === selected);
  const factsDirty = !!product && (title !== product.title || facts !== product.facts || source !== product.source);
  const eligible = state.queue.some(cue => cue.approved);
  return <section className="virtual-commerce stack" aria-label="虛擬導購文字彩排">
    <div className="vc-intro">
      <div><strong>文字彩排 · 不會開播</strong><p>先確認商品資料，再核准講稿，最後由同一條佇列預覽主講與短答。</p></div>
      <span className="vc-status" role="status">{modeLabels[state.mode]}</span>
    </div>
    <p className="vc-boundary">僅限本頁記憶體：離頁、重新整理或換帳號會清除。沒有聲音、人物動畫、推流、付款或訂單。所有資料都是本機測試輸入，人工確認不等於供應商核准。操作員按鈕只控制這份彩排，不授予商務權限。</p>
    <div className="vc-controls" role="group" aria-label="操作員控制">
      {state.mode === 'stopped' ? <button className="btn btn-secondary btn-small" onClick={() => act(() => engine.restart())}>重新開始彩排</button>
        : <button className="btn btn-primary btn-small" disabled={!eligible || state.preparing || !!state.active} onClick={() => void next(true)}>{state.mode === 'takeover' ? '結束接管並繼續文字彩排' : '開始／繼續文字彩排'}</button>}
      <button className="btn btn-secondary btn-small" disabled={state.mode !== 'running'} onClick={() => act(() => engine.pause())}>暫停</button>
      <button className="btn btn-secondary btn-small" disabled={state.mode === 'takeover' || state.mode === 'stopped'} onClick={() => act(() => engine.takeover())}>人工接管</button>
      <button className="btn btn-secondary btn-small vc-stop" disabled={state.mode === 'stopped'} onClick={() => act(() => engine.stop())}>停止並清空佇列</button>
    </div>
    {error && <p role="alert" className="banner banner-error">{error}</p>}
    <p role="status" className="vc-notice">{notice}</p>
    <div className="vc-grid">
      <section className="card vc-panel" aria-labelledby="vc-products-heading">
        <div className="vc-section-heading"><span aria-hidden="true">01</span><h2 id="vc-products-heading">商品事實</h2></div>
        <p className="vc-muted">同一測試供應來源，最多5項。資料更新會中止預覽，相關講稿必須重新核准。</p>
        {state.products.length === 0 && <button className="btn btn-secondary btn-small" onClick={loadExamples}>載入3項測試商品</button>}
        <label className="field">彩排商品<select value={selected} onChange={event => choose(state.products.find(item => item.id === event.target.value))} disabled={!state.products.length}>
          <option value="">選擇商品</option>{state.products.map(item => <option key={item.id} value={item.id}>{item.title} · v{item.version}</option>)}
        </select></label>
        {product ? <>
          <p className="vc-version">目前 v{product.version} · {product.validUntil > Date.now() ? '資料有效' : '資料已過期'}<br/><time dateTime={new Date(product.validUntil).toISOString()}>有效至 {new Date(product.validUntil).toLocaleTimeString()}</time></p>
          {factsDirty && <p role="status" className="vc-boundary">左側是尚未儲存的資料草稿；排程仍綁已儲存版本。請儲存或放棄修改後再建立／核准講稿。</p>}
          <form className="stack" onSubmit={event => {event.preventDefault(); act(() => {engine.upsertProduct({id: selected, title, facts, source, validUntil: Date.now() + 10 * 60_000}); setNotice('已建立新版本，有效10分鐘；請重新建立並確認講稿。');});}}>
            <label className="field">商品名稱<input required maxLength={100} value={title} onChange={event => setTitle(event.target.value)}/></label>
            <label className="field">已確認的彩排資料<textarea required rows={5} maxLength={1000} value={facts} onChange={event => setFacts(event.target.value)}/></label>
            <label className="field">資料來源標記<input required maxLength={200} value={source} onChange={event => setSource(event.target.value)}/></label>
            <button className="btn btn-secondary btn-small" type="submit">儲存新版並使舊稿失效</button>
            {factsDirty && <button className="btn btn-ghost btn-small" type="button" onClick={() => choose(product)}>放棄未儲存修改</button>}
          </form>
        </> : <p className="vc-empty">尚未加入商品。測試商品不會建立真實商品、庫存或價格。</p>}
      </section>
      <section className="card vc-panel" aria-labelledby="vc-queue-heading">
        <div className="vc-section-heading"><span aria-hidden="true">02</span><h2 id="vc-queue-heading">講稿與確認</h2></div>
        <form className="stack" onSubmit={event => {event.preventDefault(); act(() => {if (factsDirty) throw new Error('請先儲存或放棄商品資料修改。'); engine.draft(selected, script); setScript(''); setNotice('主講已加入待確認區，尚未核准。');});}}>
          <label className="field">一段一重點的主講<textarea required rows={4} maxLength={1200} value={script} onChange={event => setScript(event.target.value)} placeholder="依左側商品資料撰寫；不加入未確認功效或促銷承諾。"/></label>
          <button className="btn btn-secondary btn-small" type="submit" disabled={factsDirty || !product || !script.trim() || state.queue.length >= 50}>加入待確認講稿</button>
        </form>
        <p className="vc-muted">{state.queue.length}/50 段 · 短答優先，最多連續2段後回到主講。每段都需人工確認；短答60秒後失效。</p>
        <ol className="vc-queue">{state.queue.map(cue => <li key={cue.id} className={state.active?.id === cue.id ? 'vc-cue vc-cue-active' : 'vc-cue'}>
          <div className="vc-cue-heading"><strong>{cue.kind === 'answer' ? '觀眾短答' : '主講'} · v{cue.productVersion}</strong><span>{state.active?.id === cue.id ? '預覽中' : cue.approved ? '已核准' : '待人工確認'}</span></div>
          <p className="vc-muted">{state.products.find(item => item.id === cue.productId)?.title}</p><p className="vc-script">{cue.text}</p><details><summary>核對此版資料來源</summary><p>{state.products.find(item => item.id === cue.productId)?.source}</p><p>{state.products.find(item => item.id === cue.productId)?.facts}</p></details>
          <div className="actions">{!cue.approved && <button className="btn btn-secondary btn-small" disabled={factsDirty} onClick={() => act(() => {if (factsDirty) throw new Error('請先儲存或放棄商品資料修改。'); engine.approve(cue.id);})}>確認本版資料與講稿</button>}
            <button className="btn btn-ghost btn-small" onClick={() => act(() => engine.remove(cue.id))}>移除{state.active?.id === cue.id ? '並中止' : ''}</button></div>
        </li>)}</ol>
        {!state.queue.length && <p className="vc-empty">還沒有講稿。先選商品，寫一段主講，再確認內容。</p>}
      </section>
      <section className="card vc-panel" aria-labelledby="vc-preview-heading">
        <div className="vc-section-heading"><span aria-hidden="true">03</span><h2 id="vc-preview-heading">單一通道預覽</h2></div>
        <div className="vc-preview" aria-live="polite" aria-atomic="true">
          <span className="vc-muted">文字預覽 · 無音訊／嘴型</span>
          {state.active ? <><strong>{state.active.kind === 'answer' ? '短答' : '主講'} · 商品 v{state.active.productVersion}</strong><p className="vc-script">{state.active.text}</p></> : <p>{state.preparing ? '正在準備文字…' : '等待已核准段落'}</p>}
        </div>
        <button className="btn btn-secondary btn-small" disabled={state.mode !== 'running' || state.preparing || (!state.active && !eligible)} onClick={() => void next(false, state.active ?? undefined)}>{state.active ? '本段結束，預覽下一段' : '預覽下一段'}</button>
        <p className="vc-muted">主講與短答共用一條通道；新提問不打斷目前段落。文字快取 {state.cacheEntries} 筆，不代表已產生語音。</p>
        <form className="stack vc-viewer" onSubmit={event => {event.preventDefault(); act(() => {const result = engine.receiveViewer({eventId: `manual-viewer-${++viewerSerial.current}`, productId: selected, text: viewerText}); setNotice(viewerLabels[result]); setViewerText('');});}}>
          <h3>模擬觀眾提問</h3><p className="vc-muted">僅一個測試留言通道。留言不是控制指令，短答只取商品資料，不直接照讀留言。</p>
          <label className="field">對目前商品提問<textarea required rows={3} maxLength={300} value={viewerText} onChange={event => setViewerText(event.target.value)} placeholder="例如：這項商品的規格是什麼？"/></label>
          <button className="btn btn-secondary btn-small" type="submit" disabled={!product || !viewerText.trim()}>送入模擬留言</button>
        </form>
      </section>
    </div>
    <div className="vc-bottom-grid">
      <details className="card vc-panel"><summary>聲線／人物版本綁定（僅測試標記）</summary>
        <p className="vc-muted">這些欄位只測試快取失效，不會啟用聲音或人物。變更會中止預覽並清空所有講稿與快取。</p>
        <form className="vc-settings" onSubmit={event => {event.preventDefault(); act(() => engine.setSettings({voice, rate, avatarVersion: avatar}));}}>
          <label className="field">聲線版本標記<input required maxLength={80} value={voice} onChange={event => setVoice(event.target.value)}/></label>
          <label className="field">語速標記<input required type="number" min={0.5} max={2} step={0.1} value={rate} onChange={event => setRate(Number(event.target.value))}/></label>
          <label className="field">人物版本標記<input required maxLength={80} value={avatar} onChange={event => setAvatar(event.target.value)}/></label>
          <button className="btn btn-secondary btn-small" type="submit">更新版本並清空舊稿</button>
        </form>
      </details>
      <details className="card vc-panel"><summary>正式服務準備狀態 · 未配置</summary>
        <dl className="vc-readiness">{Object.entries(PROVIDER_READINESS).map(([id, status]) => <div key={id}><dt>{providerLabels[id as keyof typeof PROVIDER_READINESS]}</dt><dd>{status}</dd></div>)}</dl>
        <p className="vc-muted">須另行確認帳號、授權素材與費用，才可接入真實服務。本頁不收取金鑰，也沒有開播按鈕。</p>
      </details>
    </div>
    <details className="card vc-panel"><summary>本頁彩排紀錄（最多30筆）</summary><ol className="vc-log">{state.log.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ol></details>
  </section>;
}
