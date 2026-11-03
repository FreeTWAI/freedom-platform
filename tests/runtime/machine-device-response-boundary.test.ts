import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Dependency-free machine SDK is exported as native JavaScript.
import { createMachineDeviceClient, MachineDeviceError } from '../../packages/sdk/machine-device-client.mjs';

const origin = 'https://platform.example.invalid';
function beginValue() {
  const issuedAt = new Date();
  return {
    authorizationId: '11111111-1111-4111-8111-111111111111',
    deviceCode: 'A'.repeat(43), userCode: 'ABCDE-FGHJK',
    nonce: 'B'.repeat(42) + 'A', requestDigest: 'C'.repeat(42) + 'A',
    verificationUri: origin + '/device', issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 300000).toISOString(),
    expiresIn: 300, interval: 5, operational_authority: false,
  };
}

// These tests exercise the actual native SDK, not the HTTP/SQL authorization
// fixture. The valid DTO control prevents malformed JSON from masking a lost
// Content-Encoding guard. No network, database or operational grant is used.
for (const encoding of ['identity', 'unsupported']) {
  test(`native SDK checks ${encoding} content coding before decoding`, async () => {
    const value = beginValue();
    let calls = 0, bodyReads = 0;
    const client = await createMachineDeviceClient({ origin, environment: 'local',
      clientId: 'header-boundary', requestTimeoutMs: 250,
      fetch: async () => {
        calls++;
        const response = new Response(JSON.stringify(value), { status: 201,
          headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding } });
        const body = response.body;
        Object.defineProperty(response, 'body', { get() { bodyReads++; return body; } });
        return response;
      },
    });
    try {
      if (encoding === 'identity') {
        const result = await client.begin();
        assert.equal(result.userCode, value.userCode);
        assert.ok(bodyReads > 0, 'Valid control must reach the DTO decoder');
      } else {
        await assert.rejects(client.begin(), (error: unknown) => {
          assert.ok(error instanceof MachineDeviceError);
          assert.equal((error as Error & { code: string }).code, 'response_invalid');
          const rendered = String(error) + JSON.stringify(error);
          for (const secret of [value.deviceCode, value.userCode, value.nonce, value.requestDigest])
            assert.equal(rendered.includes(secret), false, 'Error must not retain synthetic secrets');
          return true;
        });
        assert.equal(bodyReads, 0, 'Unsupported coding must be rejected before reading the valid DTO');
        await assert.rejects(client.begin(), (error: unknown) => {
          assert.ok(error instanceof MachineDeviceError);
          assert.equal((error as Error & { code: string }).code, 'client_unavailable');
          return true;
        });
      }
      assert.equal(calls, 1, 'No automatic or subsequent transport retry');
    } finally { client.close(); }
  });
}
