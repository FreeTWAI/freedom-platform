import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { createApp } from '../../apps/platform-api/src/app.js';
import { agentOperations } from '../../apps/platform-api/src/agent-allowlist.js';
import { agentDiscovery } from '../../modules/client-connections/agent-discovery.js';
import { agentGuide } from '../../modules/client-connections/agent-guide.js';
import { llmsIndex } from '../../modules/development/service.js';

function walkKeysAndValues(
  value: unknown,
  onKey: (key: string) => void,
  onString: (key: string, str: string) => void,
  currentKey = '',
): void {
  if (typeof value === 'string') {
    onString(currentKey, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkKeysAndValues(item, onKey, onString, currentKey);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      onKey(key);
      walkKeysAndValues(child, onKey, onString, key);
    }
  }
}

test('agentDiscovery returns public machine-readable discovery metadata without secrets or member data', () => {
  const origin = 'https://member-portal.example';
  const doc = agentDiscovery(origin);

  assert.deepEqual(Object.keys(doc).sort(), [
    'api_base',
    'authentication',
    'change_feed_url',
    'development_map_url',
    'format',
    'guide_url',
    'guild_tools',
    'mcp_url',
    'name',
    'openapi_url',
    'operation_count',
    'scopes',
  ]);
  assert.equal(doc.format, 'freedom.agent-discovery/v1');
  assert.equal(doc.name, '自由工坊 Freedom Workshop');
  assert.equal(doc.api_base, `${origin}/api/v1`);
  assert.equal(doc.openapi_url, `${origin}/agent/openapi.json`);
  assert.equal(doc.guide_url, `${origin}/agent.md`);
  assert.equal(doc.mcp_url, `${origin}/api/v1/mcp`);
  assert.equal(doc.change_feed_url, `${origin}/api/v1/agent/events`);
  assert.equal(doc.development_map_url, `${origin}/.well-known/freedom-development.json`);

  assert.deepEqual(doc.authentication, {
    scheme: 'bearer',
    header: 'Authorization',
    token_prefix: 'fw_agent_',
    issue_page: `${origin}/#automation/agent`,
  });
  assert.deepEqual(doc.guild_tools, {
    guide_url: `${origin}/guild-tool.md`,
    jwks_url: `${origin}/.well-known/guild-tool-jwks.json`,
    template: 'https://github.com/FreeTWAI/freedom-platform/tree/main/templates/guild-tool',
  });

  const granted = agentOperations.filter((op) => op.granted !== false);
  assert.equal(doc.operation_count, granted.length);
  assert.ok(doc.operation_count > 0);

  const scopeNames = doc.scopes.map((s) => s.scope);
  assert.deepEqual(scopeNames, [...scopeNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  for (const entry of doc.scopes) {
    assert.ok(entry.operations > 0, entry.scope);
  }
  const totalScoped = doc.scopes.reduce((sum, entry) => sum + entry.operations, 0);
  assert.equal(totalScoped, doc.operation_count);

  const seenKeys: string[] = [];
  const urls: Array<{ key: string; value: string }> = [];
  const emails: string[] = [];
  walkKeysAndValues(
    doc,
    (key) => {
      seenKeys.push(key);
    },
    (key, str) => {
      if (/^https?:\/\//.test(str)) {
        urls.push({ key, value: str });
      }
      if (str.includes('@')) {
        emails.push(str);
      }
    },
  );

  const unexpectedTokenKeys = seenKeys.filter((k) => k.toLowerCase().includes('token') && k !== 'token_prefix');
  assert.deepEqual(unexpectedTokenKeys, []);
  assert.deepEqual(emails, []);
  for (const item of urls) {
    if (item.key === 'template') continue;
    assert.equal(new URL(item.value).origin, origin, `${item.key}: ${item.value}`);
  }
});

test('GET /.well-known/freedom-agent.json returns 200 JSON discovery metadata for request origin without hitting DB', async () => {
  const reqOrigin = 'http://127.0.0.1:4310';
  const pool = {
    query: () => {
      throw new Error('discovery endpoint must not query database');
    },
  } as unknown as Pool;
  const app = createApp(pool, reqOrigin);

  const response = await app.request(`${reqOrigin}/.well-known/freedom-agent.json`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);

  const body = (await response.json()) as { format?: string; api_base?: string };
  assert.equal(body.format, 'freedom.agent-discovery/v1');
  assert.equal(body.api_base, `${reqOrigin}/api/v1`);
});

test('llmsIndex and agentGuide advertise /.well-known/freedom-agent.json', () => {
  const llms = llmsIndex();
  const machineSection = llms.split('## 可機器讀取的來源')[1]?.split('\n## ')[0] ?? '';
  assert.match(machineSection, /\/\.well-known\/freedom-agent\.json/);

  const origin = 'https://member-portal.example';
  const guide = agentGuide(origin);
  assert.ok(guide.includes(`${origin}/.well-known/freedom-agent.json`));
});
