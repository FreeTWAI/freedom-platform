import type {Locator} from '@playwright/test';

/** DOM attachment/src alone does not mean the initial player document committed.
 * Bind each wait to the actual iframe and caller-validated source snapshot, then
 * leave CSP/lifecycle checks to the unchanged collector. This does not certify playback or later navigations. */
export async function waitForInitialShortVideoPlayers(players: Locator, expectedSources: readonly string[]) {
  const elements = await players.elementHandles();
  if (elements.length !== expectedSources.length) throw new Error('Short player count changed before initial navigation');
  await Promise.all(elements.map(async (element, index) => {
    const src = await element.getAttribute('src');
    const frame = await element.contentFrame();
    if (!src || !frame) throw new Error('Short player is unavailable before initial navigation');
    if (src !== expectedSources[index]) throw new Error('Short player source changed before initial navigation');
    await frame.waitForURL(url => url.href === expectedSources[index], {waitUntil: 'commit'});
  }));
}
