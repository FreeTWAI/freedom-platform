import {test, expect, type Page, type Route, type Locator} from './fixtures.js';

// Authoring-only: native browser execution is not_run in this change. Listing
// is discovery, not a browser pass. Use the official fixture/server harness.
// These route-controlled native-page cases test UI failure/ownership handling;
// real persistence, permissions and atomicity belong to the companion DB test.
const eventA = '71000000-0000-4000-8000-000000000001', eventB = '71000000-0000-4000-8000-000000000002';
const host = '20000000-0000-4000-8000-000000000001', member = '20000000-0000-4000-8000-000000000002';
const peer = '20000000-0000-4000-8000-000000000003', stamp = '2026-11-01T10:00:00.000Z';
type Item = ReturnType<typeof attendanceItem>;
type Tuple = {method: string; path: string; key: string; match: string; body: string | null};
function event(id = eventA, organizer = host) {return {event_id: id, organizer_ref: organizer, organizer_name: '合成主辦', title: id === eventA ? '合成到場活動甲' : '合成到場活動乙', description: '主辦人工核對，不是發獎或完成認定', starts_at: '2020-01-01T10:00:00.000Z', ends_at: '2099-01-01T12:00:00.000Z', mode: 'online', location: '合成教室', event_kind: 'other', topic: null, online_url: null, visibility: 'open', banner_url: null, video_url: null, banner_orientation: null, video_mime: null, capacity: 20, state: 'published', aggregate_version: 17, attending_count: 2, my_rsvp: null, guild_key: null, review_guild_key: null, can_review: false, review_reason: null, prize_details: []};}
function attendanceItem(state: 'unconfirmed' | 'confirmed' | 'retracted' = 'unconfirmed', version = 1, id = member) {
  return {member_ref: id, nickname: id === member ? '合成會員小明' : '合成會員小花', avatar_url: null,
    registration_state: 'going' as 'going' | 'cancelled', registered_at: stamp, state, version,
    recorded_by: state === 'unconfirmed' ? null : host, recorded_at: state === 'unconfirmed' ? null : stamp,
    updated_by: state === 'unconfirmed' ? null : host, updated_at: state === 'unconfirmed' ? null : stamp,
    retraction_reason: state === 'retracted' ? 'not_confirmed' : null,
    can_confirm: state !== 'confirmed', can_retract: state === 'confirmed', confirm_unavailable: null as string | null};
}
function payload(items: Item[], id = eventA, organizer = host) {return {event_id: id, organizer_ref: organizer, items, total: items.length, next_offset: null};}
function tuple(route: Route): Tuple {const req = route.request(); return {method: req.method(), path: new URL(req.url()).pathname, key: req.headers()['idempotency-key'], match: req.headers()['if-match'], body: req.postData()};}
function ack(command: Tuple, overrides: Record<string, unknown> = {}) {
  const body = JSON.parse(command.body!), parts = command.path.split('/');
  return {acknowledged: true, event_id: parts[4], member_ref: parts[6], action: body.action,
    retraction_reason: body.action === 'retract' ? body.reason : null, command_key: command.key,
    attendance_version: Number(command.match.replaceAll('"', '')) + 1, changed: true, ...overrides};
}
function deferred() {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve};}
async function routes(page: Page, events = [event()]) {
  await page.route('**/api/v1/events', route => route.request().method() === 'GET' ? route.fulfill({json: {items: events}}) : route.continue());
  for (const value of events) await page.route(`**/api/v1/events/${value.event_id}`, route => route.fulfill({json: value}));
}
async function login(page: Page, email = 'maker@local.test') {
  await page.goto('/'); await page.getByLabel('電子郵件', {exact: true}).fill(email);
  await page.getByLabel('密碼', {exact: true}).fill('freedom-local-demo'); await page.getByRole('button', {name: '登入', exact: true}).click();
  await expect(page.getByRole('button', {name: '設定', exact: true})).toBeVisible();
}
async function open(page: Page, id = eventA) {await login(page); await page.evaluate(id => {location.hash = `events/${id}`;}, id); await expect(panel(page)).toBeVisible();}
const panel = (page: Page) => page.getByRole('region', {name: '會員到場紀錄', exact: true});
const memberRow = (page: Page) => panel(page).getByRole('listitem').filter({has: page.getByText('合成會員小明', {exact: true})});
async function confirm(page: Page) {
  await panel(page).getByRole('button', {name: '確認 合成會員小明 到場', exact: true}).click();
  await panel(page).getByRole('button', {name: '確定記錄到場', exact: true}).click();
}
async function keyboardReach(page: Page, target: Locator) {
  await page.getByRole('link', {name: '跳到主要內容', exact: true}).focus();
  for (let n = 0; n < 80; n++) {await page.keyboard.press('Tab'); if (await target.evaluate(node => node === document.activeElement)) break;}
  await expect(target).toBeFocused(); expect(await target.evaluate(node => node.matches(':focus-visible'))).toBe(true);
}

for (const width of [320, 390]) test(`inline two-step attendance, keyboard cancellation, correction and honest text at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width, height: 844}); let current = attendanceItem(); const writes: Tuple[] = [];
  await routes(page);
  await page.route(`**/api/v1/events/${eventA}/attendance?*`, route => route.fulfill({json: payload([current])}));
  await page.route(`**/api/v1/events/${eventA}/attendance/${member}`, async route => {
    const command = tuple(route); writes.push(command); const body = JSON.parse(command.body!);
    current = attendanceItem(body.action === 'confirm' ? 'confirmed' : 'retracted', current.version + 1);
    await route.fulfill({json: ack(command)});
  });
  await open(page); const section = panel(page), trigger = section.getByRole('button', {name: '確認 合成會員小明 到場', exact: true});
  await expect(section).toContainText('報名不等於到場'); await expect(section).toContainText('不是實際抵達時間'); await expect(section).toContainText('不代表已完成或已發獎');
  await keyboardReach(page, trigger); await page.keyboard.press('Enter');
  const choice = section.getByRole('group', {name: '合成會員小明 的到場確認'}); await expect(choice).toBeVisible(); expect(writes).toHaveLength(0);
  await choice.getByRole('button', {name: '返回，不更改'}).focus(); await page.keyboard.press('Escape'); await expect(choice).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.press('Enter'); await choice.getByRole('button', {name: '確定記錄到場'}).click();
  await expect(memberRow(page)).toContainText('主辦已確認到場'); expect(writes).toHaveLength(1); expect(writes[0].match).toBe('"1"'); expect(JSON.parse(writes[0].body!)).toEqual({action: 'confirm'});
  const retract = section.getByRole('button', {name: '撤回 合成會員小明 的到場確認'}); await expect(retract).toBeFocused(); await retract.press('Enter');
  await expect(choice).toContainText('不會取消報名'); await choice.getByLabel('更正原因').selectOption('not_confirmed');
  for (const scale of [1, 2]) {
    await page.evaluate(value => {document.documentElement.style.fontSize = `${value * 16}px`;}, scale);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const target of await choice.locator('button,select').all()) {const box = await target.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);}
    expect(await choice.getByLabel('更正原因').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    await page.screenshot({path: info.outputPath(`attendance-${width}-${scale}x.png`), fullPage: true});
  }
  await choice.getByRole('button', {name: '確定撤回確認'}).click(); await expect(memberRow(page)).toContainText('已撤回確認，目前尚未確認');
  expect(writes).toHaveLength(2); expect(writes[1].match).toBe('"2"'); expect(JSON.parse(writes[1].body!)).toEqual({action: 'retract', reason: 'not_confirmed'});
  await expect(section.getByRole('button', {name: '確認 合成會員小明 到場', exact: true})).toBeFocused();
});

test('same-tick double submit stays single-flight and does not optimistically confirm', async ({page}) => {
  const gate = deferred(), writes: Tuple[] = []; let current = attendanceItem(); await routes(page);
  await page.route(`**/api/v1/events/${eventA}/attendance?*`, route => route.fulfill({json: payload([current])}));
  await page.route(`**/api/v1/events/${eventA}/attendance/${member}`, async route => {const command = tuple(route); writes.push(command); await gate.promise; current = attendanceItem('confirmed', 2); await route.fulfill({json: ack(command)});});
  try {
    await open(page); await panel(page).getByRole('button', {name: '確認 合成會員小明 到場'}).click();
    await panel(page).getByRole('button', {name: '確定記錄到場'}).evaluate(node => {(node as HTMLButtonElement).click(); (node as HTMLButtonElement).click();});
    await expect.poll(() => writes.length).toBe(1); await expect(panel(page)).not.toContainText('主辦已確認到場');
    await expect(panel(page).getByRole('button', {name: '重新讀取到場紀錄'})).toBeDisabled();
    gate.resolve(); await expect(memberRow(page)).toContainText('主辦已確認到場'); expect(writes).toHaveLength(1);
  } finally {gate.resolve(); await page.unrouteAll({behavior: 'wait'});}
});

test('unknown survives GET and later definitive 403; exact retry ACK settles without resurrecting a later retraction', async ({page}) => {
  const writes: Tuple[] = []; let resolve = false; await routes(page);
  await page.route(`**/api/v1/events/${eventA}/attendance?*`, route => route.fulfill({json: payload([attendanceItem(writes.length ? 'retracted' : 'unconfirmed', writes.length ? 3 : 1)])}));
  await page.route(`**/api/v1/events/${eventA}/attendance/${member}`, async route => {
    const command = tuple(route); writes.push(command);
    if (!resolve) {await route.fulfill({status: writes.length === 1 ? 503 : 403, contentType: 'application/problem+json', json: {type: 'https://freedom.example/problems/synthetic_failure', title: 'Synthetic failure', status: writes.length === 1 ? 503 : 403, code: 'synthetic_failure', detail: '合成回覆中斷'}}); return;}
    await route.fulfill({json: ack(command)});
  });
  await open(page); await confirm(page); const retry = panel(page).getByRole('button', {name: '重試原到場操作'});
  await expect(retry).toBeVisible(); await expect(panel(page)).not.toContainText('主辦已確認到場');
  expect(await page.evaluate(() => {const event = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(event); return event.defaultPrevented;})).toBe(true);
  await panel(page).getByRole('button', {name: '重新讀取到場紀錄'}).click(); await expect(memberRow(page)).toContainText('已撤回確認');
  await expect(panel(page).getByRole('button', {name: '確認 合成會員小明 到場'})).toBeDisabled();
  await page.getByRole('button', {name: '返回活動列表與行事曆'}).click(); await expect(page).toHaveURL(new RegExp(`#events/${eventA}$`));
  await retry.click(); await expect(retry).toBeVisible(); expect(writes[1]).toEqual(writes[0]);
  resolve = true; await retry.click(); await expect(retry).toHaveCount(0); expect(writes[2]).toEqual(writes[0]);
  await expect(memberRow(page)).toContainText('已撤回確認'); await expect(memberRow(page)).not.toContainText('主辦已確認到場');
  expect(await page.evaluate(() => {const event = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(event); return event.defaultPrevented;})).toBe(false);
  await page.getByRole('button', {name: '返回活動列表與行事曆'}).click(); await expect(page).toHaveURL(/#events$/);
});

test('canonical ACK releases navigation before a failing refresh and never offers a duplicate command', async ({page}) => {
  let written = false, writes = 0; await routes(page);
  await page.route(`**/api/v1/events/${eventA}/attendance?*`, route => written
    ? route.fulfill({status: 503, json: {code: 'unavailable', detail: '合成現況讀取失敗'}})
    : route.fulfill({json: payload([attendanceItem()])}));
  await page.route(`**/api/v1/events/${eventA}/attendance/${member}`, async route => {written = true; writes++; await route.fulfill({json: ack(tuple(route))});});
  await open(page); await confirm(page); await expect(panel(page)).toContainText('原操作已確認'); await expect(panel(page).getByRole('alert')).toBeVisible();
  await expect(panel(page).getByRole('button', {name: '重試原到場操作'})).toHaveCount(0);
  await page.getByRole('button', {name: '返回活動列表與行事曆'}).click(); await expect(page).toHaveURL(/#events$/); expect(writes).toBe(1);
});

for (const bad of ['member', 'event', 'key', 'version', 'reason'] as const) test(`a mismatched ${bad} ACK cannot release the frozen attempt`, async ({page}) => {
  const writes: Tuple[] = []; let valid = false; await routes(page);
  await page.route(`**/api/v1/events/${eventA}/attendance?*`, route => route.fulfill({json: payload([attendanceItem()])}));
  await page.route(`**/api/v1/events/${eventA}/attendance/${member}`, async route => {
    const command = tuple(route); writes.push(command); const overrides = {member: {member_ref: peer}, event: {event_id: eventB}, key: {command_key: 'unrelated-key'}, version: {attendance_version: 99}, reason: {retraction_reason: 'not_confirmed'}}[bad]!;
    await route.fulfill({json: ack(command, valid ? {} : overrides)});
  });
  await open(page); await confirm(page); const retry = panel(page).getByRole('button', {name: '重試原到場操作'}); await expect(retry).toBeVisible();
  await page.getByRole('button', {name: '返回活動列表與行事曆'}).click(); await expect(page).toHaveURL(new RegExp(`#events/${eventA}$`));
  valid = true; await retry.click(); await expect(retry).toHaveCount(0); expect(writes[1]).toEqual(writes[0]);
  await expect(panel(page)).toContainText('讀到較舊的到場紀錄'); await expect(panel(page)).not.toContainText('主辦已確認到場');
});

test('a below-ACK GET is rejected instead of replacing a newer saved version', async ({page}) => {
  let current = attendanceItem(), writes = 0; await routes(page);
  await page.route(`**/api/v1/events/${eventA}/attendance?*`, route => route.fulfill({json: payload([current])}));
  await page.route(`**/api/v1/events/${eventA}/attendance/${member}`, async route => {writes++; await route.fulfill({json: ack(tuple(route))});});
  await open(page); await confirm(page); await expect(panel(page)).toContainText('讀到較舊的到場紀錄');
  await expect(panel(page).getByRole('button', {name: '確認 合成會員小明 到場'})).toHaveCount(0);
  current = attendanceItem('retracted', 3); await panel(page).getByRole('button', {name: '重新讀取到場紀錄'}).click();
  await expect(memberRow(page)).toContainText('已撤回確認'); expect(writes).toBe(1);
});

test('late event-A GET cannot replace event B or submit the previous member path', async ({page}) => {
  const gate = deferred(), requested = deferred(); const writes: Tuple[] = []; await routes(page, [event(), event(eventB)]);
  await page.route(`**/api/v1/events/${eventA}/attendance?*`, async route => {requested.resolve(); await gate.promise; await route.fulfill({json: payload([attendanceItem()])}).catch(() => {});});
  await page.route(`**/api/v1/events/${eventB}/attendance?*`, route => route.fulfill({json: payload([attendanceItem('unconfirmed', 1, peer)], eventB)}));
  await page.route('**/api/v1/events/*/attendance/*', async route => {if (route.request().method() !== 'POST') return route.continue(); const command = tuple(route); writes.push(command); await route.fulfill({json: ack(command)});});
  try {
    await open(page); await requested.promise;
    await page.evaluate(id => {location.hash = `events/${id}`;}, eventB); await expect(panel(page)).toContainText('合成會員小花');
    gate.resolve(); await expect(panel(page)).not.toContainText('合成會員小明');
    await panel(page).getByRole('button', {name: '確認 合成會員小花 到場'}).click(); await panel(page).getByRole('button', {name: '確定記錄到場'}).click();
    await expect.poll(() => writes.length).toBe(1); expect(writes[0].path).toBe(`/api/v1/events/${eventB}/attendance/${peer}`);
  } finally {gate.resolve(); await page.unrouteAll({behavior: 'wait'});}
});

test('page reload replaces the browser client and ignores a prior client late GET', async ({page}) => {
  const gate = deferred(), requested = deferred(); let reads = 0; await routes(page);
  await page.route(`**/api/v1/events/${eventA}/attendance?*`, async route => {
    if (++reads === 1) {requested.resolve(); await gate.promise; await route.fulfill({json: payload([attendanceItem()])}).catch(() => {});}
    else await route.fulfill({json: payload([attendanceItem('retracted', 3)])});
  });
  try {
    await open(page); await requested.promise; await page.reload(); await expect(memberRow(page)).toContainText('已撤回確認');
    gate.resolve(); await expect(memberRow(page)).toContainText('已撤回確認'); await expect(memberRow(page)).not.toContainText('到場：尚未確認到場');
  } finally {gate.resolve(); await page.unrouteAll({behavior: 'wait'});}
});

test('real session replacement during a held command prevents its late ACK from appearing in the new member workspace', async ({page, context}) => {
  const gate = deferred(), requested = deferred(); const writes: Tuple[] = []; await routes(page, [event(), event(eventB, peer)]);
  await page.route(`**/api/v1/events/${eventA}/attendance?*`, route => route.fulfill({json: payload([attendanceItem()])}));
  await page.route(`**/api/v1/events/${eventB}/attendance?*`, route => route.fulfill({json: payload([attendanceItem()], eventB, peer)}));
  await page.route(`**/api/v1/events/${eventA}/attendance/${member}`, async route => {const command = tuple(route); writes.push(command); requested.resolve(); await gate.promise; await route.fulfill({json: ack(command)}).catch(() => {});});
  try {
    await open(page); await confirm(page); await requested.promise;
    const origin = new URL(page.url()).origin;
    // Shared-cookie login models a real second tab changing the session. The
    // existing workspace detects that change through its real session read.
    const loginResponse = await context.request.post('/api/v1/auth/login', {headers: {Origin: origin}, data: {email: 'client@local.test', password: 'freedom-local-demo'}}); expect(loginResponse.status()).toBe(200);
    const changedSession = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/session');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    expect((await (await changedSession).json()).user.user_id).toBe(peer); await expect(panel(page)).toHaveCount(0);
    gate.resolve(); await expect(panel(page)).toHaveCount(0);
    await page.reload(); await page.evaluate(id => {location.hash = `events/${id}`;}, eventB);
    await expect(panel(page)).toBeVisible(); await expect(panel(page)).not.toContainText('原操作已確認'); await expect(panel(page).getByRole('button', {name: '重試原到場操作'})).toHaveCount(0); expect(writes).toHaveLength(1);
  } finally {gate.resolve(); await page.unrouteAll({behavior: 'wait'});}
});

test('cancelled RSVP history stays correctable; read errors never masquerade as an empty list', async ({page}) => {
  let failure = true, current = attendanceItem('confirmed', 2); current.registration_state = 'cancelled'; current.can_confirm = false; current.confirm_unavailable = 'registration_cancelled'; await routes(page);
  await page.route(`**/api/v1/events/${eventA}/attendance?*`, route => failure ? route.fulfill({status: 503, json: {code: 'unavailable', detail: '合成讀取錯誤'}}) : route.fulfill({json: payload([current])}));
  await page.route(`**/api/v1/events/${eventA}/attendance/${member}`, async route => {const command = tuple(route); expect(JSON.parse(command.body!).action).toBe('retract'); current = {...attendanceItem('retracted', 3), registration_state: 'cancelled', can_confirm: false, confirm_unavailable: 'registration_cancelled'}; await route.fulfill({json: ack(command)});});
  await open(page); await expect(panel(page).getByRole('alert')).toBeVisible(); await expect(panel(page)).not.toContainText('共 0 位會員');
  failure = false; await panel(page).getByRole('button', {name: '重新讀取到場紀錄'}).click(); await expect(memberRow(page)).toContainText('已取消報名，原到場紀錄保留');
  await panel(page).getByRole('button', {name: '撤回 合成會員小明 的到場確認'}).click(); await panel(page).getByRole('button', {name: '確定撤回確認'}).click();
  await expect(memberRow(page)).toContainText('已撤回確認'); await expect(panel(page).getByRole('button', {name: '確認 合成會員小明 到場'})).toBeDisabled();
});
