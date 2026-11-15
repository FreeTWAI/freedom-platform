import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GUILD_BRIDGE, readGuildFrameMessage} from '../../modules/guild-workspace/repositories/bridge.js';
import {guildRepositories, guildRepository, guildRepositorySite} from '../../modules/guild-workspace/repositories/registry.js';
import {guildKeyFromHash, guildActionFromHash} from '../../apps/portal-web/src/modules/guild-launchpad-route.js';
import {platformContentSecurityPolicy} from '../../apps/platform-api/src/platform-app.js';

const guildKey = 'guild_music_mv';
const channel = 'b5be8af2-2e86-4208-b488-c7c9f1b84512';
const message = {protocol: GUILD_BRIDGE, channel, guildKey, type: 'navigate', action: 'work'};

test('guild bridge admits bounded navigation and refuses command/URL/private-data envelopes', () => {
  assert.deepEqual(readGuildFrameMessage(message, guildKey, channel), message);
  for (const candidate of [null, [], 'work', {...message, type: 'join'}, {...message, action: 'delete'}, {...message, action: 'https://example.com'}, {...message, url: 'https://example.com'}, {...message, token: 'not-a-secret'}, {...message, guildKey: 'guild_security'}, {...message, channel: 'expired'}, {...message, protocol: 'v2'}]) assert.equal(readGuildFrameMessage(candidate, guildKey, channel), null);
  assert.ok(readGuildFrameMessage({protocol: GUILD_BRIDGE, channel, guildKey, type: 'ready'}, guildKey, channel));
  for (const height of [0, 239, 1601, Infinity, NaN, 260.5, '500']) assert.equal(readGuildFrameMessage({protocol: GUILD_BRIDGE, channel, guildKey, type: 'resize', height}, guildKey, channel), null);
  assert.ok(readGuildFrameMessage({protocol: GUILD_BRIDGE, channel, guildKey, type: 'resize', height: 640}, guildKey, channel));
});
test('guild routes preserve legacy links and validate each workspace destination', () => {
  assert.equal(guildKeyFromHash(`#guilds/${guildKey}`), guildKey);
  assert.equal(guildActionFromHash(`#guilds/${guildKey}`), undefined);
  for (const action of ['start', 'work', 'skills', 'tools', 'information']) {
    assert.equal(guildKeyFromHash(`#guilds/${guildKey}/${action}`), guildKey);
    assert.equal(guildActionFromHash(`#guilds/${guildKey}/${action}`), action);
  }
  for (const suffix of ['/work?url=https://example.com','?token=x','/tools/native?draft=id']) assert.equal(guildKeyFromHash(`#guilds/${guildKey}${suffix}`),guildKey);
  for (const suffix of ['/delete', '/work/extra', '/%77ork']) assert.equal(guildKeyFromHash(`#guilds/${guildKey}${suffix}`), null);
});
test('every registered guild has one matching independently publishable source profile', async () => {
  assert.equal(new Set(guildRepositories.map(entry => entry.guild_key)).size, guildRepositories.length);
  assert.equal(new Set(guildRepositories.map(entry => entry.repository)).size, guildRepositories.length);
  for (const entry of guildRepositories) {
    assert.match(entry.repository, /^guild-[a-z0-9-]+$/);
    const profile = JSON.parse(await readFile(new URL(`../../modules/guild-workspace/repositories/profiles/${entry.guild_key}.json`, import.meta.url), 'utf8'));
    assert.equal(profile.guild_key, entry.guild_key); assert.equal(profile.repository, `FreeTWAI/${entry.repository}`);
    assert.equal(new URL(guildRepositorySite(entry)).origin, 'https://freetwai.github.io');
    assert.equal(profile.steps.length, 3);
  }
  assert.equal(guildRepository('guild_does_not_exist'), null);
});
test('only the portal document admits guild frames, without remote script or API access', () => {
  const directives = (path: string) => new Map(platformContentSecurityPolicy(path).split(';').map(part => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name, sources] as const;
  }));
  assert.deepEqual(directives('/').get('frame-src'), ['https://aisns.evitina.tw', 'https://freetwai.github.io']);
  for (const path of ['/admin', '/admin/github/callback', '/api/v1/auth/login']) assert.equal(directives(path).has('frame-src'), false);
  assert.deepEqual(directives('/').get('script-src'), ["'self'"]);
  assert.deepEqual(directives('/').get('connect-src'), ["'self'"]);
});
