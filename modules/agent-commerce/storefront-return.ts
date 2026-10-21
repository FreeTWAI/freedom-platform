import {z} from 'zod';
import {OpaqueId} from '../../contracts/guild-launchpad/v1/primitives.js';
import {PublicStoreProjectionSchema} from '../../contracts/guild-launchpad/v1/storefront.js';

export const STORE_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export function isValidStoreSlug(value: string): boolean {
  return STORE_SLUG_PATTERN.test(value);
}

/** An absolute path, never a URL to normalize or a credential-bearing destination. */
export function storefrontReturnPath(value: string | null): string | null {
  if (!value || value.length > 160 || /[^\x21-\x7e]|[% .?#\\]|\/\//.test(value)) return null;
  const match = /^\/shops\/([^/]+)\/(checkout|order-access|orders\/([^/]+))$/.exec(value);
  if (!match || !isValidStoreSlug(match[1]) || (match[3] && !OpaqueId.safeParse(match[3]).success)) return null;
  const url = new URL(value, 'https://return.invalid');
  return url.origin === 'https://return.invalid' && url.pathname === value && !url.search && !url.hash ? value : null;
}

export function storefrontReturnFromSearch(search: string): string | null {
  const values = new URLSearchParams(search).getAll('return_to');
  return values.length === 1 ? storefrontReturnPath(values[0]) : null;
}

const sessionSchema = z.object({user: z.object({user_id: OpaqueId}), csrf_token: z.string().min(1)});
export type ReturnSession = z.infer<typeof sessionSchema>;

/** Uses the actual cookie, never a cached PortalClient session. A 401 is a guest;
 * transport/schema failures remain unknown rather than authorizing a guest write. */
export async function readStorefrontSession(fetcher: typeof fetch = fetch): Promise<ReturnSession | null> {
  const response = await fetcher('/api/v1/session', {credentials: 'same-origin', cache: 'no-store', redirect: 'error'});
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('無法確認登入狀態，請重試。');
  return sessionSchema.parse(await response.json());
}

export async function validateStorefrontReturn(path: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (storefrontReturnPath(path) !== path) return false;
  const options = {credentials: 'omit', cache: 'no-store', redirect: 'error'} as const;
  const site = await fetcher('/api/v1/site', options);
  if (!site.ok || z.object({commerce_checkout_enabled: z.boolean()}).parse(await site.json()).commerce_checkout_enabled !== true) return false;
  const slug = path.split('/')[2];
  const response = await fetcher(`/api/v1/public/stores/${slug}`, options);
  return response.ok && PublicStoreProjectionSchema.parse(await response.json()).slug === slug;
}

/** Authentication must still be current on both sides of the public liveness
 * read. A failed liveness check does not undo successful registration/login. */
export async function successfulStorefrontReturn(path: string, authenticated: ReturnSession, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (storefrontReturnPath(path) !== path) return false;
  const recheck = async () => {
    const current = await readStorefrontSession(fetcher);
    if (!current || current.user.user_id !== authenticated.user.user_id || current.csrf_token !== authenticated.csrf_token) {
      throw new Error('登入已過期，請重新登入。');
    }
  };
  await recheck();
  let allowed = false;
  try { allowed = await validateStorefrontReturn(path, fetcher); } catch { /* Stay in the portal when public liveness cannot be proved. */ }
  await recheck();
  return allowed;
}
