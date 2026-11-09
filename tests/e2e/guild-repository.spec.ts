import {test, expect} from './fixtures.js';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import type {Page, Frame} from '@playwright/test';
import {openPageTools} from './navigation.js';

const guild = 'guild_music_mv';
const origin = 'https://freetwai.github.io';
const path = '/guild-music-mv/';
let scratch: string;
let site: string;
test.beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'fp-guild-site-')); site = join(scratch, 'site');
  execFileSync(process.execPath, ['scripts/guild-repositories/scaffold.mjs', guild, '--out', site], {stdio: 'pipe'});
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  execFileSync(process.execPath, ['scripts/build.mjs'], {cwd: site, env: {...process.env, GUILD_SOURCE_SHA: sha}, stdio: 'pipe'});
});
test.afterAll(async () => {if (scratch) await rm(scratch, {recursive: true, force: true});});

async function open(page: Page, theme = 'light'): Promise<Frame> {
  await page.addInitScript(() => {
    const scope = window as Window & {guildMessages?: unknown[]};
    scope.guildMessages = [];
    window.addEventListener('message', event => {if (event.data?.protocol === 'freedom.guild-launchpad/v1') scope.guildMessages?.push(event.data);});
  });
  await page.route(`${origin}${path}**`, async route => {
    const request = route.request();
    expect(request.method()).toBe('GET');
    expect(request.headers()['cookie']).toBeUndefined();
    const name = new URL(request.url()).pathname.slice(path.length) || 'index.html';
    const types: Record<string, string> = {'index.html': 'text/html', 'site.js': 'text/javascript', 'style.css': 'text/css', 'brand.png': 'image/png'};
    if (!types[name]) {await route.abort(); return;}
    await route.fulfill({status: 200, contentType: types[name], body: await readFile(join(site, 'dist', name)), headers: {'access-control-allow-origin': '*'}});
  });
  await page.goto(`/#guilds/${guild}/start`);
  await page.evaluate(theme => {document.documentElement.dataset.theme = theme === 'night' ? 'dark' : theme;}, theme);
  const locator = page.locator('iframe[title="音樂創作與MV公會獨立啟動台"]');
  await expect(locator).toBeVisible();
  const frame = await (await locator.elementHandle())!.contentFrame();
  await expect(frame!.getByRole('heading', {name: '讓歌曲構想有清楚的製作路徑'})).toBeVisible();
  await expect(page.getByText('正在開啟公會啟動台…', {exact: true})).toHaveCount(0);
  return frame!;
}

for (const theme of ['light', 'night', 'versefolk']) for (const width of [390, 1440]) {
  test(`independent launchpad ${theme}/${width} returns to the real guild skill shelf`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({width, height: 1000});
    const frame = await open(page, theme);
    await expect(frame.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await frame.getByRole('link', {name: '閱讀技能書', exact: true}).click();
    await expect(page.locator('[data-launchpad-kind="skill_books"]')).toBeVisible();
    await expect(page.getByRole('heading', {name: '音樂與 MV 製作入門手冊', exact: true})).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('sandbox isolates cookies and DOM; forged requests cannot read, write or navigate outside the guild', async ({page}) => {
  const writes: string[] = [];
  page.on('request', request => {if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/')) writes.push(request.url());});
  const frame = await open(page);
  const isolation = await frame.evaluate(() => {
    const blocked = (read: () => unknown) => {try {read(); return false;} catch {return true;}};
    return {parent: blocked(() => window.parent.document.body), cookies: blocked(() => document.cookie), storage: blocked(() => window.localStorage)};
  });
  expect(isolation).toEqual({parent: true, cookies: true, storage: true});
  const init = await frame.evaluate(() => (window as unknown as Window & {guildMessages: Record<string, unknown>[]}).guildMessages.find(message => message.type === 'init'));
  expect(Object.keys(init!).sort()).toEqual(['actions', 'channel', 'guildKey', 'protocol', 'theme', 'type']);
  const message = {protocol: init!.protocol, channel: init!.channel, guildKey: guild, type: 'navigate', action: 'skills'};
  // A sibling/host cannot impersonate this frame, even with the channel value.
  await page.evaluate(message => window.postMessage(message, location.origin), message);
  await frame.evaluate(({message, parentOrigin}) => {
    for (const override of [{type: 'join'}, {action: 'https://example.com'}, {url: 'https://example.com'}, {channel: 'stale'}, {guildKey: 'guild_security'}]) window.parent.postMessage({...message, ...override}, parentOrigin);
  }, {message, parentOrigin: new URL(page.url()).origin});
  await expect(page.locator('iframe[title="音樂創作與MV公會獨立啟動台"]')).toBeVisible();
  await frame.getByRole('link', {name: '進入工作區'}).click();
  await expect(page.getByRole('heading', {name: '登入', exact: true})).toBeVisible();
  expect(writes).toEqual([]);
});

test('a failed independent deployment keeps native resources usable', async ({page}) => {
  await page.route(`${origin}${path}**`, route => route.abort());
  await page.goto(`/#guilds/${guild}/start`);
  await expect(page.getByText('啟動台暫時無法開啟，你仍可直接使用下方工作與資源。')).toBeVisible({timeout: 15000});
  await page.getByRole('navigation', {name: '直接進入工作與資源'}).getByRole('button', {name: '閱讀技能書'}).click();
  await expect(page.getByRole('heading', {name: '音樂與 MV 製作入門手冊', exact: true})).toBeVisible();
});

test('the existing edit tool points contributors to this guild repository and publication workflow', async ({page}) => {
  await open(page);
  await openPageTools(page);
  await page.getByRole('button', {name: '參與編修', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('link', {name: '開啟公會 Repo ↗'})).toHaveAttribute('href', 'https://github.com/FreeTWAI/guild-music-mv');
  await expect(dialog.getByRole('link', {name: '發布與回復版本 ↗'})).toHaveAttribute('href', 'https://github.com/FreeTWAI/guild-music-mv/actions/workflows/publish.yml');
  await expect(dialog.locator('pre')).toContainText('https://github.com/FreeTWAI/guild-music-mv');
  await expect(dialog.getByRole('link', {name: 'Fork 平台 Repo ↗'})).toHaveCount(0);
});
