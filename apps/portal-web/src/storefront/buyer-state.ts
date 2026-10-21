import {z} from 'zod';
import {CheckoutBuyerIdentitySchema, PlaceOrderInputSchema, type CheckoutBuyerIdentity} from '../../../../contracts/guild-launchpad/v1/hosted-checkout.js';
import {OpaqueId} from '../../../../contracts/guild-launchpad/v1/primitives.js';
import {isValidStoreSlug} from './cart-store.js';
import {readStorefrontSession} from './return-path.js';

export const IDENTITY_CHANGED_COPY = '登入身分已變更，請重新確認';
export const PREVIOUS_ORDER_COPY = '上次下單結果尚未確認。請用原登入帳號或原瀏覽器找回訂單。';
const slugSchema = z.string().refine(isValidStoreSlug);
const intentCoordinates = z.object({checkoutRef: OpaqueId, input: PlaceOrderInputSchema}).strict();
const intentSchema = intentCoordinates.extend({version: z.literal(2), slug: slugSchema, buyer: CheckoutBuyerIdentitySchema}).strict();
const bindingSchema = z.object({version: z.literal(1), slug: slugSchema, buyer: CheckoutBuyerIdentitySchema, seenAt: z.number().int().nonnegative()}).strict();
export type BuyerIntent = z.infer<typeof intentSchema>;
type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const buyerBindingKey = (slug: string) => `freedom.shop.buyer.v1:${slug}`;
export const buyerIntentKey = (slug: string) => `freedom.shop.order-intent.v2:${slug}`;
export const legacyIntentKey = (slug: string) => `freedom.shop.order-intent.v1:${slug}`;
export const parkedIntentKey = (slug: string, coordinates: z.infer<typeof intentCoordinates>) => `freedom.shop.order-intent.parked.v2:${slug}:${coordinates.checkoutRef}:${coordinates.input.client_order_id}`;

function json(raw: string | null): unknown {
  try { return raw && raw.length <= 4096 ? JSON.parse(raw) : null; } catch { return null; }
}

/** Only identity metadata and replay coordinates enter tab storage. No contact,
 * freeze key, cookie/CSRF secret or bank instructions. Parked commands never dispatch. */
export class CheckoutBuyerState {
  identity: CheckoutBuyerIdentity | null = null;
  generation = 0;
  intent: BuyerIntent | null;
  private previous: CheckoutBuyerIdentity | null = null;
  private untrusted: boolean;
  private legacy: z.infer<typeof intentCoordinates> | null;
  constructor(readonly slug: string, private storage: TabStorage, now = Date.now()) {
    const rawBinding = storage.getItem(buyerBindingKey(slug));
    const binding = bindingSchema.safeParse(json(rawBinding));
    if (binding.success && binding.data.slug === slug && now >= binding.data.seenAt && now - binding.data.seenAt <= 30 * 60_000) this.previous = binding.data.buyer;
    const rawIntent = storage.getItem(buyerIntentKey(slug));
    const parsed = intentSchema.safeParse(json(rawIntent));
    this.intent = parsed.success && parsed.data.slug === slug ? parsed.data : null;
    const rawLegacy = storage.getItem(legacyIntentKey(slug));
    const legacy = intentCoordinates.safeParse(json(rawLegacy));
    this.legacy = legacy.success ? legacy.data : null;
    this.untrusted = Boolean(rawLegacy || rawBinding && !this.previous || rawIntent && !this.intent);
  }
  observe(identity: CheckoutBuyerIdentity, now = Date.now()) {
    const changed = this.untrusted || (this.identity ?? this.previous) !== null && (this.identity ?? this.previous) !== identity || this.intent !== null && this.intent.buyer !== identity;
    const previousOrder = changed && Boolean(this.intent || this.legacy);
    if (changed) {
      const pending = this.intent ?? this.legacy;
      if (pending) this.storage.setItem(parkedIntentKey(this.slug, pending), JSON.stringify(pending));
      this.storage.removeItem(buyerIntentKey(this.slug));
      this.storage.removeItem(legacyIntentKey(this.slug));
      this.intent = null;
      this.generation++;
    }
    this.storage.setItem(buyerBindingKey(this.slug), JSON.stringify({version: 1, slug: this.slug, buyer: identity, seenAt: now}));
    this.identity = identity;
    this.previous = identity;
    this.untrusted = false;
    this.legacy = null;
    return {changed, previousOrder};
  }
  saveIntent(coordinates: z.infer<typeof intentCoordinates>): BuyerIntent {
    if (this.identity === null) throw Error('Unknown checkout identity.');
    const intent = intentSchema.parse({...coordinates, version: 2, slug: this.slug, buyer: this.identity});
    this.storage.setItem(buyerIntentKey(this.slug), JSON.stringify(intent));
    this.intent = intent;
    return intent;
  }
  clearIntent() { this.storage.removeItem(buyerIntentKey(this.slug)); this.intent = null; }
  invalidate() { this.identity = null; this.untrusted = true; this.generation++; }
  matches(identity: CheckoutBuyerIdentity, generation: number) { return this.identity === identity && this.generation === generation; }
}

export async function readCheckoutIdentity(fetcher: typeof fetch = fetch): Promise<CheckoutBuyerIdentity> {
  const session = await readStorefrontSession(fetcher);
  return session ? `member:${session.user.user_id}` : 'guest';
}
