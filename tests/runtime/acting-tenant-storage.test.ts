import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readActing, readActingTenant, rememberActing } from '../../apps/portal-web/src/modules/acting-tenant-storage.js';

type StorageMode = 'normal' | 'absent' | 'getter-throws' | 'get-throws' | 'set-throws';
function withStorage(run: (values: Map<string, string>, calls: string[][]) => void, mode: StorageMode = 'normal') {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map<string, string>(), calls: string[][] = [];
  try {
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (mode !== 'absent') Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        if (mode === 'getter-throws') throw new Error('synthetic storage unavailable');
        return {
          getItem(key: string) { calls.push(['get', key]); if (mode === 'get-throws') throw new Error('synthetic read denied'); return values.get(key) ?? null; },
          setItem(key: string, value: string) { calls.push(['set', key, value]); if (mode === 'set-throws') throw new Error('synthetic quota'); values.set(key, value); },
        };
      },
    });
    run(values, calls);
  } finally {
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
  }
}

const fixtures: [string | null, string | null, string | null][] = [
  [null, null, null], ['', null, null], ['{', null, null], ['null', null, null],
  ['false', null, null], ['3', null, null], ['"text"', null, null], ['[]', null, null], ['{}', null, null],
  ['{"tenant_id":null,"workspace_id":null}', null, null],
  ['{"tenant_id":5,"workspace_id":true}', null, null],
  ['{"tenant_id":"","workspace_id":""}', '', ''],
  ['{"tenant_id":"tenant-a","workspace_id":"workspace-a"}', 'tenant-a', 'workspace-a'],
  ['{"tenant_id":"tenant-a"}', 'tenant-a', null], ['{"workspace_id":"workspace-a"}', null, 'workspace-a'],
  ['{"tenant_id":[],"workspace_id":{}}', null, null],
];
for (const [index, [raw, tenant, workspace]] of fixtures.entries()) {
  test(`acting selection retains legacy read projections for fixture ${index}`, () => withStorage((values, calls) => {
    if (raw !== null) values.set('freedom-acting-tenant:member-a', raw);
    assert.equal(readActingTenant('member-a'), tenant);
    assert.deepEqual(readActing('member-a'), { tenant_id: tenant, workspace_id: workspace });
    assert.deepEqual(calls, [['get', 'freedom-acting-tenant:member-a'], ['get', 'freedom-acting-tenant:member-a']]);
    assert.equal(values.get('freedom-acting-tenant:member-a') ?? null, raw);
  }));
}
for (const mode of ['absent', 'getter-throws', 'get-throws', 'set-throws'] as const) {
  test(`acting selection tolerates ${mode} without additional effects`, () => withStorage((values, calls) => {
    assert.equal(readActingTenant('member-a'), null);
    assert.deepEqual(readActing('member-a'), { tenant_id: null, workspace_id: null });
    assert.doesNotThrow(() => rememberActing('member-a', 'tenant-a', 'workspace-a'));
    assert.equal(calls.filter(([kind]) => kind === 'set').length, mode === 'get-throws' || mode === 'set-throws' ? 1 : 0);
    assert.equal(values.size, mode === 'get-throws' ? 1 : 0);
  }, mode));
}

test('acting preference preserves user keys, exact writes, empty strings and fresh reads', () => withStorage((values, calls) => {
  rememberActing('member-a', 'tenant-a', 'workspace-a');
  rememberActing('member-b', 'tenant-b', 'workspace-b');
  assert.equal(values.size, 2);
  assert.equal(values.get('freedom-acting-tenant:member-a'), '{"tenant_id":"tenant-a","workspace_id":"workspace-a"}');
  assert.equal(readActingTenant('member-b'), 'tenant-b');
  rememberActing('member-a', '', '');
  assert.deepEqual(readActing('member-a'), { tenant_id: '', workspace_id: '' });
  assert.deepEqual(readActing('member-b'), { tenant_id: 'tenant-b', workspace_id: 'workspace-b' });
  values.delete('freedom-acting-tenant:member-a');
  assert.deepEqual(readActing('member-a'), { tenant_id: null, workspace_id: null });
  assert.equal(calls.filter(([kind]) => kind === 'set').length, 3);
}));

test('tenant-only projection does not read workspace properties', () => withStorage((values) => {
  values.set('freedom-acting-tenant:member-a', '{"tenant_id":"tenant-a"}');
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'workspace_id');
  try {
    Object.defineProperty(Object.prototype, 'workspace_id', { configurable: true, get() { throw new Error('synthetic workspace access'); } });
    assert.equal(readActingTenant('member-a'), 'tenant-a');
    assert.deepEqual(readActing('member-a'), { tenant_id: null, workspace_id: null });
  } finally {
    delete (Object.prototype as { workspace_id?: unknown }).workspace_id;
    if (previous) Object.defineProperty(Object.prototype, 'workspace_id', previous);
  }
}));

test('all four consumers preserve their bindings while Applications no longer imports the MyWork UI for storage', () => {
  const source = (file: string) => readFileSync(new URL(`../../apps/portal-web/src/modules/${file}.tsx`, import.meta.url), 'utf8');
  const settings = source('TenantSettings'), work = source('GuildLaunchpadMyWork'), applications = source('GuildLaunchpadApplications'), launchpad = source('GuildLaunchpad');
  assert.match(settings, /import \{ readActingTenant as readStored, rememberActing as remember \} from '\.\/acting-tenant-storage';/);
  assert.match(work, /import \{ readActing, rememberActing \} from '\.\/acting-tenant-storage';/);
  assert.match(work, /export \{ readActing, rememberActing \} from '\.\/acting-tenant-storage';/);
  assert.match(applications, /import \{readActing, rememberActing\} from '\.\/acting-tenant-storage';/);
  assert.doesNotMatch(applications, /from ['"]\.\/GuildLaunchpadMyWork['"]/);
  assert.match(launchpad, /import \{MyWorkPanel, rememberActing\} from '\.\/GuildLaunchpadMyWork';/);
  for (const content of [settings, work, applications]) assert.doesNotMatch(content, /freedom-acting-tenant:/);
  for (const content of [settings, work]) assert.doesNotMatch(content, /sessionStorage\.(getItem|setItem)/);
});
