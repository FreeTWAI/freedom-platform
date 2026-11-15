import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPair, exportJWK, SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { importGuildToolSigner, installWorkerGuildToolSigner } from '../../apps/platform-api/src/worker-guild-tool-signer.js';

async function key() {
  const pair = await generateKeyPair('ES256', { extractable: true });
  return { ...await exportJWK(pair.privateKey), kid: randomUUID() };
}

test('signing key generator emits only one usable private P-256 JWK with a kid', async () => {
  const output = execFileSync(process.execPath, ['scripts/generate-guild-tool-signing-key.mjs'], { encoding: 'utf8' });
  const signer = await importGuildToolSigner(output);
  assert.equal(signer.privateKey.extractable, false);
  assert.deepEqual(Object.keys(signer.publicJwk).sort(), ['crv', 'kty', 'x', 'y']);
  const publicKey = await crypto.subtle.importKey('jwk', signer.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const signed = await new SignJWT({ purpose: 'test' }).setProtectedHeader({ alg: 'ES256', kid: signer.kid }).sign(signer.privateKey);
  assert.equal((await jwtVerify(signed, publicKey)).protectedHeader.kid, signer.kid);
});

test('malformed, public-only, mismatched, wrong-curve and wrong-purpose signing keys fail with a constant error', async () => {
  const valid = await key(), other = await key();
  const { d, ...publicOnly } = valid;
  for (const raw of [
    '', '{', JSON.stringify('private input'), ' '.repeat(4097),
    JSON.stringify(publicOnly), JSON.stringify({ ...valid, kid: undefined }),
    JSON.stringify({ ...valid, kid: '\nprivate' }), JSON.stringify({ ...valid, crv: 'P-384' }),
    JSON.stringify({ ...valid, kty: 'RSA' }), JSON.stringify({ ...valid, alg: 'HS256' }),
    JSON.stringify({ ...valid, use: 'enc' }), JSON.stringify({ ...valid, key_ops: ['verify'] }),
    JSON.stringify({ ...valid, d: 'invalid' }), JSON.stringify({ ...valid, x: other.x, y: other.y }),
    JSON.stringify({ ...valid, unexpected: 'private input' }),
  ]) await assert.rejects(importGuildToolSigner(raw), error => {
    assert.ok(error instanceof Error); assert.equal(error.message, 'guild_tool_signing_key_invalid');
    assert.equal(error.cause, undefined); assert.ok(!error.stack?.includes(valid.d!)); return true;
  });
});

test('startup imports once per environment and a replacement key ends verification with the installed public key', async () => {
  const first = { FREEDOM_GUILD_TOOL_SIGNING_KEY: JSON.stringify(await key()) };
  const a = installWorkerGuildToolSigner(first), b = installWorkerGuildToolSigner(first);
  assert.equal(a, b); const signer = (await a)!;
  const next = (await installWorkerGuildToolSigner({ FREEDOM_GUILD_TOOL_SIGNING_KEY: JSON.stringify(await key()) }))!;
  assert.notEqual(signer.kid, next.kid);
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: signer.kid }).sign(signer.privateKey);
  const publicKey = await crypto.subtle.importKey('jwk', next.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  await assert.rejects(jwtVerify(token, publicKey));
});
