import type { MiddlewareHandler } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { IMMUTABLE_ASSET_CACHE_CONTROL, isImmutablePublicAsset } from './static-assets.js';

/** Decide after the static adapter returns: onFound runs before c.res is finalized. */
export function serveBuildAssets(root: string): MiddlewareHandler {
  return async (c, next) => {
    let found = false;
    const response = await serveStatic({ root, onFound: () => { found = true; } })(c, next);
    if (found && response instanceof Response && ['GET', 'HEAD'].includes(c.req.method)
      && [200, 206, 304].includes(response.status)
      && isImmutablePublicAsset(c.req.path, response.headers.get('content-type'), new URL(c.req.url).pathname)) {
      response.headers.set('Cache-Control', IMMUTABLE_ASSET_CACHE_CONTROL);
    }
    return response;
  };
}
