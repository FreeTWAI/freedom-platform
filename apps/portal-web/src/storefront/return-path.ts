import {storefrontReturnPath} from '../../../../modules/agent-commerce/storefront-return.js';

export {storefrontReturnPath, storefrontReturnFromSearch, readStorefrontSession, validateStorefrontReturn, successfulStorefrontReturn} from '../../../../modules/agent-commerce/storefront-return.js';
export type {ReturnSession} from '../../../../modules/agent-commerce/storefront-return.js';

export function storefrontLoginHref(path: string): string {
  const valid = storefrontReturnPath(path);
  return valid ? `/?return_to=${encodeURIComponent(valid)}` : '/';
}
