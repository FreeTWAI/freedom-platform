import { z } from 'zod';
import { parseBoundedJson } from '../../../packages/execution-state/decode.js';
import type { ToolSigner } from '../../../modules/guild-tools/tokens.js';

export interface GuildToolSigningBindings { FREEDOM_GUILD_TOOL_SIGNING_KEY?: string }
const component = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const signingJwk = z.object({
  kty: z.literal('EC'), crv: z.literal('P-256'), x: component, y: component, d: component,
  kid: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  alg: z.literal('ES256').optional(), use: z.literal('sig').optional(),
  ext: z.boolean().optional(), key_ops: z.tuple([z.literal('sign')]).optional(),
}).strict();

/** Returns only a constant error; parser and WebCrypto diagnostics may contain secret input. */
export async function importGuildToolSigner(raw: string): Promise<ToolSigner> {
  try {
    if (raw.length > 4096) throw new Error();
    const jwk = signingJwk.parse(parseBoundedJson(raw));
    const algorithm = { name: 'ECDSA', namedCurve: 'P-256' };
    const privateKey = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['sign']);
    const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
    const publicKey = await crypto.subtle.importKey('jwk', publicJwk, algorithm, false, ['verify']);
    // workerd can import inconsistent public/private coordinates; prove the pair once at startup.
    const probe = crypto.getRandomValues(new Uint8Array(32));
    const operation = { name: 'ECDSA', hash: 'SHA-256' };
    const signature = await crypto.subtle.sign(operation, privateKey, probe);
    if (!await crypto.subtle.verify(operation, publicKey, signature, probe)) throw new Error();
    return { privateKey, publicJwk, kid: jwk.kid };
  } catch { throw new Error('guild_tool_signing_key_invalid'); }
}

// Only local WebCrypto initialization is cached per bindings object, never request/network I/O.
const installed = new WeakMap<GuildToolSigningBindings, Promise<ToolSigner | undefined>>();
export function installWorkerGuildToolSigner(env: GuildToolSigningBindings): Promise<ToolSigner | undefined> {
  let result = installed.get(env);
  if (!result) {
    // One key only: replacing it invalidates outstanding platform tokens (maximum lifetime 10 minutes).
    result = env.FREEDOM_GUILD_TOOL_SIGNING_KEY === undefined ? Promise.resolve(undefined)
      : importGuildToolSigner(env.FREEDOM_GUILD_TOOL_SIGNING_KEY).catch(() => {
        console.error('guild_tool_signing_key_invalid');
        return undefined;
      });
    installed.set(env, result);
  }
  return result;
}
