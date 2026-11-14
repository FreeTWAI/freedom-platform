import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { shareQr } from '../../apps/portal-web/src/share/share-qr.js';

const origin = 'https://freetwai.com';

test('shareQr accepts allowed same-origin paths and intro queries and returns SVG path data', () => {
  const id = randomUUID();
  const validUrls = [
    `${origin}/`,
    `${origin}/go/AbCdEf12_4`,
    `${origin}/go/AbCdEf12_4?intro=3`,
    `${origin}/s/${id}`,
    `${origin}/works/${id}`,
    `${origin}/events/${id}`,
    `${origin}/posts/${id}`,
    `${origin}/services/${id}`,
    `${origin}/development/skills/typo-studio`,
    `${origin}/development/skills/typo-studio?intro=1`,
    `${origin}/development/submissions/${id}?intro=999`,
    `${origin}/member-cards/${'a'.repeat(43)}`,
  ];
  for (const url of validUrls) {
    const qr = shareQr(url, origin);
    assert.ok(qr, `Expected valid QR for ${url}`);
    assert.equal(qr.url, url);
    assert.ok(qr.size >= 29);
    assert.match(qr.path, /^M\d+ \d+h1v1h-1z/);
  }
});

test('shareQr rejects cross-origin, unsafe schemes, credentials, hashes, bad paths and bad queries', () => {
  const id = randomUUID();
  const invalidUrls = [
    'https://evil.example/go/AbCdEf12_4',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    `https://user@freetwai.com/go/AbCdEf12_4`,
    `https://user:pass@freetwai.com/go/AbCdEf12_4`,
    `${origin}/go/AbCdEf12_4#frag`,
    `${origin}/#shares/${id}`,
    `${origin}/?social-post=${id}#social`,
    `${origin}/go/short`,
    `${origin}/go/too-long-code-123`,
    `${origin}/s/not-a-uuid`,
    `${origin}/s/${id.toUpperCase()}`,
    `${origin}/admin`,
    `${origin}/go/AbCdEf12_4?foo=bar`,
    `${origin}/go/AbCdEf12_4?intro=0`,
    `${origin}/go/AbCdEf12_4?intro=01`,
    `${origin}/go/AbCdEf12_4?intro=1000`,
    `${origin}/development/skills/typo-studio?intro=3&extra=1`,
    `${origin}/member-cards/short`,
    'not a url',
  ];
  for (const url of invalidUrls) {
    assert.equal(shareQr(url, origin), null, `Expected null for ${url}`);
  }
});
