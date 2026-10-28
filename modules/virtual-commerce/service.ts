/** Browser-memory rehearsal only. No credential, network, commerce or durable-write capability. */
export type Product = {id: string; title: string; version: number; facts: string; source: string; validUntil: number};
export type VoiceSettings = {voice: string; rate: number; avatarVersion: string};
export type Cue = {id: string; kind: 'main' | 'answer'; productId: string; productVersion: number; text: string; approved: boolean; expiresAt: number; binding: string};
export type ActiveCue = Cue & {activation: number};
export type PreviewArtifact = {kind: 'text-rehearsal'; binding: string; text: string};
export type PreviewProvider = {prepare(cue: Readonly<Cue>, signal: AbortSignal): Promise<PreviewArtifact>};
export type Mode = 'paused' | 'running' | 'takeover' | 'stopped';
export type ViewerResult = 'queued-for-review' | 'duplicate' | 'ignored' | 'full';
export const PROVIDER_READINESS = Object.freeze({
  googleTts: 'NOT_CONFIGURED', voiceLicense: 'NOT_CONFIGURED', avatarLicense: 'NOT_CONFIGURED',
  lipSync: 'NOT_CONFIGURED', streamingAccount: 'NOT_CONFIGURED', streamingPush: 'NOT_CONFIGURED',
  liveCatalog: 'NOT_CONFIGURED', costApproval: 'NOT_CONFIGURED',
});
export const TEXT_PREVIEW_PROVIDER: PreviewProvider = {
  async prepare(cue, signal) {
    if (signal.aborted) throw new Error('cancelled');
    return {kind: 'text-rehearsal', binding: cue.binding, text: cue.text};
  },
};
const MAX_QUEUE = 50;
const bounded = (value: string, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const validTime = (value: number) => Number.isFinite(value) && value >= 0;
const clone = <T>(value: T): T => structuredClone(value);

/** The two ports are a local trust boundary, not server authorization. Never expose operator methods to a viewer adapter. */
export class RehearsalWorkbench {
  #products = new Map<string, Product>();
  #queue: Cue[] = [];
  #cache = new Map<string, PreviewArtifact>();
  #seen = new Set<string>();
  #mode: Mode = 'paused';
  #active: ActiveCue | null = null;
  #settings: VoiceSettings = {voice: '文字彩排（無語音）', rate: 1, avatarVersion: '未配置人物'};
  #serial = 0;
  #activation = 0;
  #generation = 0;
  #qaBurst = 0;
  #pending: AbortController | null = null;
  #log: string[] = [];
  #clock: () => number;
  constructor(clock: () => number = Date.now) { this.#clock = clock; }
  snapshot() {
    this.#prune();
    return clone({products: [...this.#products.values()], queue: this.#queue, active: this.#active,
      mode: this.#mode, settings: this.#settings, preparing: !!this.#pending, cacheEntries: this.#cache.size, log: this.#log});
  }
  #note(text: string) { this.#log = [...this.#log.slice(-29), text]; }
  #binding(product: Product, text: string) {
    // Exact tuple, not a collision-prone text hash. Includes all source facts and rendering settings.
    return JSON.stringify(['virtual-commerce-text/v1', product, text, this.#settings]);
  }
  #valid(cue: Cue) {
    const product = this.#products.get(cue.productId);
    return !!product && product.validUntil > this.#clock() && cue.expiresAt > this.#clock()
      && cue.productVersion === product.version && cue.binding === this.#binding(product, cue.text);
  }
  #cancel() { this.#generation++; this.#pending?.abort(); this.#pending = null; this.#active = null; }
  #prune() {
    const invalid = this.#queue.filter(c => !this.#valid(c));
    if (invalid.length || (this.#active && !this.#valid(this.#active))) {
      const activeInvalid = this.#active && !this.#valid(this.#active);
      if (activeInvalid || this.#pending) this.#cancel();
      this.#queue = this.#queue.filter(c => this.#valid(c));
      for (const cue of invalid) this.#cache.delete(cue.binding);
      this.#note('已移除過期或版本失效內容；請重新確認資料。');
    }
  }
  upsertProduct(input: Omit<Product, 'version'>) {
    if (!bounded(input.id, 80) || !bounded(input.title, 100) || !bounded(input.facts, 1000)
      || !bounded(input.source, 200) || !validTime(input.validUntil) || input.validUntil <= this.#clock()
      || input.validUntil > this.#clock() + 30 * 60_000) throw new Error('商品欄位或有效期限不正確（最多30分鐘）。');
    if (!this.#products.has(input.id) && this.#products.size >= 5) throw new Error('彩排最多5項商品。');
    const version = (this.#products.get(input.id)?.version ?? 0) + 1;
    this.#products.set(input.id, clone({...input, version}));
    this.#invalidate(input.id);
    return version;
  }
  #invalidate(productId?: string) {
    this.#cancel();
    this.#queue = productId ? this.#queue.filter(c => c.productId !== productId) : [];
    // Small bounded cache: conservatively clear all, including in-flight unrelated previews.
    this.#cache.clear();
    this.#note('資料／聲線版本已變更：中止目前內容，清除相關佇列及快取。');
  }
  setSettings(settings: VoiceSettings) {
    if (!bounded(settings.voice, 80) || !bounded(settings.avatarVersion, 80)
      || !Number.isFinite(settings.rate) || settings.rate < 0.5 || settings.rate > 2) throw new Error('聲線設定不正確。');
    this.#settings = clone(settings); this.#invalidate();
  }
  draft(productId: string, text: string, kind: Cue['kind'] = 'main') {
    if (this.#mode === 'stopped') throw new Error('請先重新開始彩排，再加入講稿。');
    this.#prune();
    const product = this.#products.get(productId);
    if (!product || product.validUntil <= this.#clock()) throw new Error('請先更新有效商品資料。');
    if (!bounded(text, kind === 'answer' ? 400 : 1200)) throw new Error('講稿不可空白或超出長度。');
    if (this.#queue.length >= MAX_QUEUE) throw new Error('佇列已滿（最多50段）。');
    const cue: Cue = {id: `cue-${++this.#serial}`, productId, productVersion: product.version, text,
      kind, approved: false, expiresAt: Math.min(product.validUntil, this.#clock() + (kind === 'answer' ? 60_000 : 30 * 60_000)),
      binding: this.#binding(product, text)};
    this.#queue.push(cue); return cue.id;
  }
  approve(id: string) {
    if (this.#mode === 'stopped') throw new Error('請先重新開始彩排，再確認講稿。');
    this.#prune(); const cue = this.#queue.find(c => c.id === id);
    if (!cue || !this.#valid(cue)) throw new Error('講稿已失效，請重新建立。');
    cue.approved = true; this.#note('操作員已確認這一版商品與講稿。');
  }
  remove(id: string) {
    if (this.#active?.id === id || this.#pending) this.#cancel();
    const cue = this.#queue.find(c => c.id === id);
    if (cue) this.#cache.delete(cue.binding);
    this.#queue = this.#queue.filter(c => c.id !== id);
  }
  /** Untrusted viewer text never enters an instruction parser, script or provider prompt. */
  receiveViewer(input: {eventId: string; productId: string; text: string}): ViewerResult {
    if (this.#mode === 'stopped') return 'ignored';
    this.#prune();
    if (!bounded(input.eventId, 100) || !bounded(input.text, 300) || !bounded(input.productId, 80)) return 'ignored';
    if (this.#seen.has(input.eventId)) return 'duplicate';
    const product = this.#products.get(input.productId);
    if (!product || product.validUntil <= this.#clock()) return 'ignored';
    if (this.#queue.length >= MAX_QUEUE || this.#seen.size >= 200) return 'full';
    this.#seen.add(input.eventId);
    // Only a narrow facts question is actionable; other comments stay off-air.
    if (!/(規格|資料|介紹|價格|庫存|優惠|保固)/u.test(input.text)) return 'ignored';
    const text = `商品資料（${product.source}）：${product.facts}。價格、庫存及優惠請以原商店最新確認為準；本彩排不提供交易承諾。`;
    if (text.length > 400) { this.#note('商品資料超出短答長度，請由操作員另寫短答。'); return 'ignored'; }
    this.draft(product.id, text, 'answer');
    this.#note('收到商品提問，已建立待人工確認的短答；留言沒有控制權。');
    return 'queued-for-review';
  }
  start() { if (this.#mode === 'stopped') throw new Error('已停止；請明確重新開始彩排。'); this.#mode = 'running'; }
  pause() { if (this.#mode === 'stopped') return; this.#mode = 'paused'; this.#cancel(); this.#note('已暫停，當前段落取消；繼續時從段首重新確認。'); }
  takeover() { if (this.#mode === 'stopped') return; this.#mode = 'takeover'; this.#cancel(); this.#note('已人工接管；自動排程停止。'); }
  stop() { this.#mode = 'stopped'; this.#cancel(); this.#queue = []; this.#cache.clear(); this.#note('已停止並清空講稿與快取。'); }
  restart() { this.stop(); this.#mode = 'paused'; this.#seen.clear(); this.#qaBurst = 0; }
  /** Boundary handoff only. Current cue cannot be interrupted by a new viewer question. */
  async next(provider: PreviewProvider = TEXT_PREVIEW_PROVIDER): Promise<ActiveCue | null> {
    this.#prune();
    if (this.#mode !== 'running' || this.#active || this.#pending) return null;
    const eligible = this.#queue.filter(c => c.approved && this.#valid(c));
    const main = eligible.find(c => c.kind === 'main'), answer = eligible.find(c => c.kind === 'answer');
    const cue = (this.#qaBurst < 2 ? answer ?? main : main ?? answer);
    if (!cue) return null;
    const generation = this.#generation;
    const controller = new AbortController(); this.#pending = controller;
    try {
      const result = this.#cache.get(cue.binding) ?? await provider.prepare(clone(cue), controller.signal);
      if (controller.signal.aborted || generation !== this.#generation || this.#mode !== 'running' || !this.#valid(cue)
        || !this.#queue.some(c => c.id === cue.id && c.approved)) return null;
      if (result.kind !== 'text-rehearsal' || result.binding !== cue.binding || result.text !== cue.text) throw new Error('預覽回傳版本不符，已拒絕。');
      if (!this.#cache.has(cue.binding) && this.#cache.size >= MAX_QUEUE) this.#cache.delete(this.#cache.keys().next().value!);
      this.#cache.set(cue.binding, clone(result));
      this.#active = {...clone(cue), activation: ++this.#activation};
      this.#qaBurst = cue.kind === 'answer' ? this.#qaBurst + 1 : 0;
      this.#note(`文字彩排：${cue.kind === 'answer' ? '短答' : '主講'}（無音訊／無推流）`);
      return clone(this.#active);
    } finally { if (this.#pending === controller) this.#pending = null; }
  }
  finish(id: string, activation: number) {
    this.#prune();
    if (this.#mode !== 'running' || this.#active?.id !== id || this.#active.activation !== activation) return false;
    this.#queue = this.#queue.filter(c => c.id !== id); this.#active = null; return true;
  }
}
