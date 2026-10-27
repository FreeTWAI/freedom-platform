import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';

const scenarios = ['cold_anonymous', 'warm_home_social', 'warm_social_home', 'warm_home_social_repeat'];
const fields = ['heading_ms', 'ready_frame_ms', 'request_start_ms', 'response_start_ms', 'response_end_ms', 'fcp_ms'];
const usage = 'node modules/portal-shell/tools/measure-route-readiness.mjs --base-url ORIGIN --output NEW_FILE --authorized [--warm-interactive]';

export function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--base-url', '--output', '--authorized', '--warm-interactive'].includes(flag) || Object.hasOwn(options, flag)) throw Error('invalid_options');
    options[flag] = ['--authorized', '--warm-interactive'].includes(flag) ? true : args[++i];
    if (!options[flag] || (typeof options[flag] === 'string' && options[flag].startsWith('--'))) throw Error('invalid_options');
  }
  if (!options['--authorized'] || !options['--base-url'] || !options['--output']) throw Error('explicit_target_output_authorization_required');
  let url;
  try { url = new URL(options['--base-url']); } catch { throw Error('invalid_target'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || url.username || url.password || /[?#]/.test(options['--base-url']) || options['--base-url'].split('/')[2]?.includes('@') || url.pathname !== '/') throw Error('invalid_target');
  return {baseUrl: url.origin, output: resolve(options['--output']), warm: Boolean(options['--warm-interactive'])};
}

// Explicit primitive allowlist. Never serialize URLs, credentials, DOM text,
// storage state, requests, errors, entry names, or caller-supplied extra fields.
export function scalarSample(scenario, outcome, input) {
  if (!scenarios.includes(scenario) || !['ready', 'failed', 'timeout'].includes(outcome)) throw Error('invalid_sample');
  const timings = Object.fromEntries(fields.map(field => {
    const property = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, field) : undefined;
    const value = property && 'value' in property ? property.value : null;
    return [field, typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null];
  }));
  if (outcome === 'ready' && (timings.heading_ms === null || timings.ready_frame_ms === null || timings.ready_frame_ms < timings.heading_ms)) throw Error('missing_readiness');
  return {scenario, outcome, ...timings};
}

async function deadline(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(Error('measurement_timeout'), {name: 'TimeoutError'})), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function collectSample(scenario, operation) {
  try { return scalarSample(scenario, 'ready', await deadline(operation, 30000)); }
  catch (error) { return scalarSample(scenario, error?.name === 'TimeoutError' ? 'timeout' : 'failed', null); }
}

export function makeReport(samples, setup = 'not_requested') {
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 4 || !['not_requested', 'ready', 'failed', 'timeout'].includes(setup)) throw Error('invalid_report');
  const safe = samples.map(sample => scalarSample(sample.scenario, sample.outcome, sample));
  const failed = safe.filter(sample => sample.outcome !== 'ready').length;
  return {format: 'manual-route-readiness/v1', scope: 'operator_selected_environment',
    outcome: failed || ['failed', 'timeout'].includes(setup) ? 'failed' : 'ready',
    warm_setup: setup, attempted: safe.length, ready: safe.length - failed, failed, samples: safe};
}

async function clearMarks(page) {
  await deadline(() => page.evaluate(() => {
    for (const name of ['fp-manual:start', 'fp-manual:heading', 'fp-manual:ready']) performance.clearMarks(name);
    for (const name of ['fp-manual:heading-duration', 'fp-manual:ready-duration']) performance.clearMeasures(name);
  }), 5000).catch(() => {}); // Best effort only; never changes the measured outcome.
}

async function timings(page, cold) {
  return page.evaluate(async cold => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    performance.mark('fp-manual:ready');
    const navigation = cold ? performance.getEntriesByType('navigation')[0] : undefined;
    const fcp = cold ? performance.getEntriesByName('first-contentful-paint', 'paint')[0] : undefined;
    return {
      heading_ms: performance.measure('fp-manual:heading-duration', 'fp-manual:start', 'fp-manual:heading').duration,
      ready_frame_ms: performance.measure('fp-manual:ready-duration', 'fp-manual:start', 'fp-manual:ready').duration,
      request_start_ms: navigation?.requestStart ?? null, response_start_ms: navigation?.responseStart ?? null,
      response_end_ms: navigation?.responseEnd ?? null, fcp_ms: fcp?.startTime ?? null,
    };
  }, cold);
}

async function feedReady(page, expect) {
  const feed = page.locator('.social-zone');
  await expect(feed).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Both states require a completed feed read, not busy=false by itself.
  await expect(feed.locator('.social-card, p.empty').first()).toBeVisible();
}

async function measureWarm(page, expect, name) {
  const menu = page.getByRole('button', {name: '開啟選單', exact: true});
  if (await menu.isVisible()) await menu.click();
  const navigation = page.getByRole('navigation', {name: '主要工作區'});
  const more = navigation.locator('.nav-more');
  if (!await more.evaluate(element => element.open)) await more.locator(':scope > summary').click();
  await navigation.getByLabel('搜尋功能', {exact: true}).fill(name);
  const target = navigation.getByRole('region', {name: '功能搜尋結果'}).getByRole('button', {name, exact: true});
  await expect(target).toBeVisible();
  await target.evaluate(element => element.addEventListener('click', () => performance.mark('fp-manual:start'), {capture: true, once: true}));
  await target.click();
  await expect(page.getByRole('heading', {name, level: 1, exact: true})).toBeVisible();
  await page.evaluate(() => performance.mark('fp-manual:heading'));
  await feedReady(page, expect);
  return timings(page, false);
}

export async function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return 0; }
  const options = parseOptions(args); // No browser import/launch or network before validation.
  if (options.warm && (!process.stdin.isTTY || !process.stdout.isTTY)) throw Error('interactive_terminal_required');
  // Reserve a new local report before contacting the target; never overwrite a file.
  const output = await open(options.output, 'wx', 0o600);
  const samples = [];
  let browser, page, setup = 'not_requested';
  try {
    let expect;
    try {
      const playwright = await import('@playwright/test');
      expect = playwright.expect.configure({timeout: 15000});
      browser = await playwright.chromium.launch({headless: !options.warm, timeout: 30000});
      const context = await browser.newContext({locale: 'zh-TW', viewport: {width: 1280, height: 800}});
      page = await context.newPage();
      page.setDefaultTimeout(15000);
    } catch (error) {
      samples.push(scalarSample('cold_anonymous', error?.name === 'TimeoutError' ? 'timeout' : 'failed', null));
    }
    if (samples.length === 0) samples.push(await collectSample('cold_anonymous', async () => {
      await page.goto(options.baseUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
      await page.evaluate(() => performance.mark('fp-manual:start', {startTime: performance.getEntriesByType('navigation')[0].startTime}));
      await expect(page.getByRole('heading', {name: '登入', level: 2, exact: true})).toBeVisible();
      await page.evaluate(() => performance.mark('fp-manual:heading'));
      for (const label of ['電子郵件', '密碼']) await expect(page.getByLabel(label, {exact: true})).toBeEnabled();
      await expect(page.getByRole('button', {name: '登入', exact: true})).toBeEnabled();
      await expect(page.getByRole('alert')).toHaveCount(0);
      return timings(page, true);
    }));
    if (page) await clearMarks(page);
    if (options.warm && samples[0].outcome === 'ready') {
      const terminal = createInterface({input: process.stdin, output: process.stdout});
      try {
        await terminal.question('In the browser, sign in with an authorized test account, select Traditional Chinese and open member home. Close any chat. Press Enter when ready (5 minutes): ', {signal: AbortSignal.timeout(300000)});
        await expect(page.getByRole('heading', {name: '會員首頁', level: 1, exact: true})).toBeVisible();
        await feedReady(page, expect);
        setup = 'ready';
      } catch (error) { setup = ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'failed'; }
      finally { terminal.close(); }
      if (setup === 'ready') for (const [scenario, name] of [
        ['warm_home_social', '社群分享'], ['warm_social_home', '會員首頁'], ['warm_home_social_repeat', '社群分享'],
      ]) {
        const sample = await collectSample(scenario, () => measureWarm(page, expect, name));
        samples.push(sample);
        await clearMarks(page);
        if (sample.outcome !== 'ready') break;
      }
    }
    const report = makeReport(samples, setup);
    await output.writeFile(JSON.stringify(report, null, 2) + '\n');
    return report.outcome === 'ready' ? 0 : 1;
  } finally {
    try { await output.close(); }
    finally { if (browser) await deadline(() => browser.close(), 5000).catch(() => {}); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch { console.error('measurement_unavailable: check explicit options, authorization, terminal and new output path; see --help'); process.exitCode = 2; }
}
