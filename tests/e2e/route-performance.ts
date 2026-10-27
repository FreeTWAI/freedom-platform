import type {Locator, Page, TestInfo} from '@playwright/test';

const scenarios = ['cold_anonymous', 'warm_home_social', 'warm_social_home', 'warm_home_social_repeat'] as const;
export type RouteScenario = typeof scenarios[number];
type Outcome = 'ready' | 'failed' | 'timeout';
const fields = ['heading_ms', 'ready_frame_ms', 'request_start_ms', 'response_start_ms', 'response_end_ms', 'fcp_ms'] as const;
type Timings = Record<typeof fields[number], number | null>;

// Copy primitives only: never serialize browser entries, errors, URLs, headers,
// payloads, credentials, DOM text, fixture IDs, or caller-supplied extra fields.
export function routePerformanceSample(scenario: RouteScenario, outcome: Outcome, input: unknown) {
  if (!scenarios.includes(scenario) || !['ready', 'failed', 'timeout'].includes(outcome)) throw Error('invalid performance sample');
  const timings = Object.fromEntries(fields.map(field => {
    const property = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, field) : undefined;
    const value = property && 'value' in property ? property.value : null;
    return [field, typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null];
  })) as Timings;
  if (outcome === 'ready' && (timings.heading_ms === null || timings.ready_frame_ms === null || timings.ready_frame_ms < timings.heading_ms)) {
    throw Error('missing performance readiness marks');
  }
  return {format: 'fixture-route-performance/v1', scope: 'local_synthetic_browser', scenario, outcome,
    test_result: 'not_reported', attempted: 1, ready: outcome === 'ready' ? 1 : 0, failed: outcome === 'ready' ? 0 : 1, ...timings};
}

/** One bounded sample per fixture action; runner timeouts remain authoritative.
 * Heading is accepted-route evidence, not essential-data readiness. The two
 * animation frames give the ready DOM a rendering opportunity, not proof of
 * actual display presentation. Includes Playwright assertion polling/round trips.
 * No latency SLO, test-result verdict or production claim is made.
 */
export async function measureRouteReadiness(options: {
  page: Page; info: Pick<TestInfo, 'attach'>; scenario: RouteScenario;
  clickTarget?: Locator; action: () => Promise<unknown>;
  heading: () => Promise<void>; ready: () => Promise<void>;
}) {
  const {page, info, scenario, clickTarget, action, heading, ready} = options;
  let sample = routePerformanceSample(scenario, 'failed', null);
  let failure: unknown;
  let failed = false;
  let controller: Awaited<ReturnType<Locator['evaluateHandle']>> | undefined;
  try {
    if (scenario !== 'cold_anonymous') {
      if (!clickTarget) throw Error('missing performance click target');
      await page.evaluate(() => {
        for (const name of ['fp-test-route:start', 'fp-test-route:heading', 'fp-test-route:ready']) performance.clearMarks(name);
        for (const name of ['fp-test-route:heading-duration', 'fp-test-route:ready-duration']) performance.clearMeasures(name);
      });
      controller = await clickTarget.evaluateHandle(element => {
        const controller = new AbortController();
        element.addEventListener('click', () => { performance.mark('fp-test-route:start'); }, {capture: true, once: true, signal: controller.signal});
        return controller;
      });
    }
    await action();
    if (scenario === 'cold_anonymous') await page.evaluate(() => {
      // A fresh fixture context's navigation start includes transfer and startup,
      // rather than starting the clock only after page.goto has returned.
      const navigation = performance.getEntriesByType('navigation')[0];
      if (!navigation) throw Error('missing navigation timing');
      performance.mark('fp-test-route:start', {startTime: navigation.startTime});
    });
    await heading();
    await page.evaluate(() => { performance.mark('fp-test-route:heading'); });
    await ready();
    const timings = await page.evaluate(async cold => {
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      performance.mark('fp-test-route:ready');
      const heading = performance.measure('fp-test-route:heading-duration', 'fp-test-route:start', 'fp-test-route:heading').duration;
      const ready = performance.measure('fp-test-route:ready-duration', 'fp-test-route:start', 'fp-test-route:ready').duration;
      const navigation = cold ? performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined : undefined;
      const fcp = cold ? performance.getEntriesByName('first-contentful-paint', 'paint')[0] : undefined;
      return {heading_ms: heading, ready_frame_ms: ready, request_start_ms: navigation?.requestStart ?? null,
        response_start_ms: navigation?.responseStart ?? null, response_end_ms: navigation?.responseEnd ?? null, fcp_ms: fcp?.startTime ?? null};
    }, scenario === 'cold_anonymous');
    sample = routePerformanceSample(scenario, 'ready', timings);
  } catch (cause) {
    failed = true; failure = cause;
    sample = routePerformanceSample(scenario, cause instanceof Error && cause.name === 'TimeoutError' ? 'timeout' : 'failed', null);
  } finally {
    // Cleanup/attachment failure must not replace the original readiness error.
    try {
      await diagnosticDeadline(async () => {
        if (controller) await controller.evaluate(value => (value as AbortController).abort());
        await page.evaluate(() => {
          for (const name of ['fp-test-route:start', 'fp-test-route:heading', 'fp-test-route:ready']) performance.clearMarks(name);
          for (const name of ['fp-test-route:heading-duration', 'fp-test-route:ready-duration']) performance.clearMeasures(name);
        });
        await controller?.dispose();
      });
    } catch (cause) { if (!failed) { failed = true; failure = cause; sample = routePerformanceSample(scenario, 'failed', null); } }
    try { await diagnosticDeadline(() => info.attach(`route-performance-${scenario}`, {body: JSON.stringify(sample), contentType: 'application/json'})); }
    catch (cause) { if (!failed) { failed = true; failure = cause; } }
  }
  if (failed) throw failure;
  return sample;
}

// Bounds only best-effort diagnostic teardown/delivery, never route readiness
// or the runner's test timeout. A timed-out operation is not retried.
async function diagnosticDeadline<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Error('performance diagnostic deadline')), 500);
    })]);
  } finally { clearTimeout(timer); }
}
