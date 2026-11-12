import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from '@typescript/typescript6';
import { readFileSync } from 'node:fs';
import { developmentPages } from '../../modules/development/pages.js';
import { PORTAL_PLACES, resolvePortalRoute } from '../../apps/portal-web/src/portal-route.js';
import { GUILD_TOOLS } from '../../apps/portal-web/src/guild-tools/catalog.js';
import { guildRepository } from '../../modules/guild-workspace/repositories/registry.js';
import { interfaceMessages } from '../../apps/portal-web/src/interface-messages.js';
import {
  COVERAGE_STATUSES, TESTER_AREAS, TESTER_COVERAGE, TESTER_FLAGS, TESTER_GROUP_IDS, TESTER_GUILD, TESTER_NON_FEATURE_SITE_FIELDS,
  areasForGroup, coverageSummary, isDefaultOff, validateTesterMap, type TesterArea,
  QUEST_PATHS, QUEST_STAGES, QUEST_STEP_IDS, TESTER_PROGRESS_KEY, normalizeProgress, readTesterProgress, resetTesterProgress,
  stageProgress, testerMedals, toggleStep, writeTesterProgress, type TesterProgress,
} from '../../modules/tester-map/index.js';

const features = TESTER_AREAS.flatMap(area => area.features);
const tabs = [...readFileSync('apps/portal-web/src/types.ts', 'utf8').match(/export type TabId = ([^\n]+)/)![1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const pageIds = developmentPages.map(page => page.id);

test('tester-map: every area has at least one known owner group and every group owns an area', () => {
  for (const area of TESTER_AREAS) {
    assert.ok(area.owners.length > 0, area.id);
    for (const owner of area.owners) assert.ok((TESTER_GROUP_IDS as readonly string[]).includes(owner), `${area.id}:${owner}`);
    for (const text of [...area.name, ...area.summary]) assert.ok(text.trim(), area.id);
  }
  for (const group of TESTER_GROUP_IDS) assert.ok(areasForGroup(group).length > 0, group);
  assert.deepEqual(areasForGroup('E').map(area => area.id).filter(id => id === 'commerce' || id === 'contribution'), ['contribution', 'commerce']);
});

test('tester-map: every feature has exactly one valid coverage status', () => {
  assert.deepEqual(validateTesterMap(), []);
  assert.deepEqual(Object.keys(TESTER_COVERAGE).sort(), features.map(feature => feature.id).sort());
  for (const entry of Object.values(TESTER_COVERAGE)) assert.ok((COVERAGE_STATUSES as readonly string[]).includes(entry.status));
  const summary = coverageSummary();
  assert.equal(Object.values(summary).reduce((sum, count) => sum + count, 0), features.length);
  // Coverage is public. It carries statuses and Issue numbers only.
  assert.doesNotMatch(readFileSync('modules/tester-map/coverage.ts', 'utf8'), /@|https?:\/\//);
});

test('tester-map: validation reports owners, statuses, Issue links and stray coverage instead of accepting them', () => {
  const name = ['名', 'n', 'n', 'n', 'n'] as const;
  const area = (patch: Partial<TesterArea> = {}): TesterArea => ({ id: 'x', name, summary: name, owners: ['A'], features: [{ id: 'x.one', name }], ...patch });
  assert.deepEqual(validateTesterMap([area()], { 'x.one': { status: '已測' } }), []);
  assert.deepEqual(validateTesterMap([area({ owners: [] })], { 'x.one': { status: '未測' } }), ['area_without_owner:x']);
  assert.deepEqual(validateTesterMap([area({ owners: ['F' as 'A'] })], { 'x.one': { status: '未測' } }), ['unknown_owner:x:F']);
  assert.deepEqual(validateTesterMap([area()], { 'x.one': { status: 'done' } }), ['invalid_status:x.one']);
  assert.deepEqual(validateTesterMap([area()], { 'x.one': null }), ['invalid_status:x.one']);
  assert.deepEqual(validateTesterMap([area()], {}), ['missing_coverage:x.one']);
  assert.deepEqual(validateTesterMap([area()], { 'x.one': { status: '有問題' } }), ['problem_without_issue:x.one']);
  assert.deepEqual(validateTesterMap([area()], { 'x.one': { status: '有問題', issues: [1018] } }), []);
  assert.deepEqual(validateTesterMap([area()], { 'x.one': { status: '有問題', issues: [0, 1.5] } }), ['invalid_issues:x.one']);
  assert.deepEqual(validateTesterMap([area()], { 'x.one': { status: '未測' }, 'x.two': { status: '未測' } }), ['unknown_coverage:x.two']);
  assert.deepEqual(validateTesterMap([area(), area()], { 'x.one': { status: '未測' } }), ['duplicate_area:x', 'duplicate_feature:x.one']);
  assert.deepEqual(validateTesterMap([area({ features: [{ id: 'x.one', name: ['名', '', 'n', 'n', 'n'] }] })], { 'x.one': { status: '未測' } }), ['untranslated_feature:x.one']);
});

test('tester-map: features cover every real page, development page id and the redesign batch', () => {
  const covered = new Set(features.flatMap(feature => feature.pages ?? []));
  for (const id of [...tabs, ...pageIds].filter(id => id !== 'tester-map')) assert.ok(covered.has(id), `page not in tester map: ${id}`);
  for (const id of covered) assert.ok(pageIds.includes(id), `unknown page: ${id}`);
  const redesign = new Set(features.flatMap(feature => feature.redesign ?? []));
  assert.deepEqual([...redesign].sort((a, b) => a - b), [993, 994, 995, 997, 998, 999, 1000, 1004, 1005, 1006, 1010, 1011, 1012, 1013]);
  for (const feature of features) if (feature.href?.startsWith('#')) {
    const target = feature.href.slice(1).split(/[/?]/)[0];
    assert.ok(tabs.includes(target), `${feature.id}:${feature.href}`);
  }
  assert.match(readFileSync('migrations/002_positioning_guilds.sql', 'utf8'), new RegExp(`'${TESTER_GUILD.key}','talent_direction','人才與方向公會'`));
});

test('tester-map: features cover every flag in /api/v1/site and mark observed-off flags as off by default', () => {
  const source = readFileSync('apps/platform-api/src/platform-app.ts', 'utf8');
  const site = source.split('\n').find(line => line.includes("app.get('/api/v1/site'"));
  assert.ok(site);
  const fields = [...new Set([...site.matchAll(/\b([a-z]+(?:_[a-z]+)+):/g)].map(match => match[1]))];
  assert.ok(fields.length > 30);
  const flags = Object.keys(TESTER_FLAGS);
  for (const field of fields) assert.ok(flags.includes(field) || (TESTER_NON_FEATURE_SITE_FIELDS as readonly string[]).includes(field), `site flag not in tester map: ${field}`);
  for (const flag of flags.filter(flag => flag !== 'FREEDOM_PRIVATE_AI_ENABLED')) assert.ok(fields.includes(flag), `not a site flag: ${flag}`);
  assert.match(readFileSync('wrangler.jsonc', 'utf8'), /"FREEDOM_PRIVATE_AI_ENABLED": "false"/);
  const used = new Set(features.map(feature => feature.flag).filter(Boolean));
  for (const flag of flags) assert.ok(used.has(flag as never), `flag without feature: ${flag}`);
  for (const feature of features) assert.equal(isDefaultOff(feature), feature.flag !== undefined && TESTER_FLAGS[feature.flag] === 'off', feature.id);
  // Reporting is off, so the map cannot send testers to in-site reporting.
  assert.equal(isDefaultOff(features.find(feature => feature.id === 'people.reporting')!), true);
  assert.equal(TESTER_FLAGS.community_certification_enabled, 'off');
  assert.equal(isDefaultOff(features.find(feature => feature.id === 'profile.community-certification')!), true);
  assert.equal(TESTER_COVERAGE['profile.community-certification'].status, '未測');
  assert.ok(features.some(feature => feature.access === 'admin') && features.some(feature => feature.access === 'guild-manager'));
});

const steps = QUEST_STAGES.flatMap(stage => stage.steps);
const featureIds = new Set(features.map(feature => feature.id));
function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const earned = (progress: TesterProgress) => testerMedals(progress).filter(medal => medal.earned).map(medal => medal.id);

test('tester-map quest: every stage has steps and every step maps to inventory features', () => {
  assert.ok(QUEST_STAGES.length >= 5);
  assert.equal(new Set(QUEST_STAGES.map(stage => stage.id)).size, QUEST_STAGES.length);
  assert.equal(new Set(QUEST_STEP_IDS).size, QUEST_STEP_IDS.length);
  assert.deepEqual(QUEST_STEP_IDS, steps.map(step => step.id));
  for (const stage of QUEST_STAGES) {
    assert.ok(stage.steps.length > 0, stage.id);
    for (const text of [...stage.name, ...stage.medal]) assert.ok(text.trim(), stage.id);
  }
  for (const step of steps) {
    assert.ok(step.features.length > 0, step.id);
    for (const id of step.features) assert.ok(featureIds.has(id), `${step.id}: unknown feature ${id}`);
    for (const text of [...step.title, ...step.task, ...step.check]) assert.ok(text.trim(), step.id);
    // Off features cannot be tried on the public site; they stay in the inventory only.
    for (const id of step.features) assert.equal(isDefaultOff(features.find(feature => feature.id === id)!), false, `${step.id}: ${id} is off`);
    if (step.href?.startsWith('#')) assert.ok(tabs.includes(step.href.slice(1).split(/[/?]/)[0]), `${step.id}:${step.href}`);
  }
  const covered = new Set(steps.flatMap(step => step.features));
  for (const feature of features) if (!isDefaultOff(feature)) assert.ok(covered.has(feature.id), `testable feature without a quest step: ${feature.id}`);
});

test('tester-map quest: every group has a suggested path of real stages and every stage is suggested to someone', () => {
  const stageIds = QUEST_STAGES.map(stage => stage.id);
  for (const group of TESTER_GROUP_IDS) {
    assert.ok(QUEST_PATHS[group].length > 0, group);
    assert.equal(new Set(QUEST_PATHS[group]).size, QUEST_PATHS[group].length, group);
    for (const id of QUEST_PATHS[group]) assert.ok(stageIds.includes(id), `${group}:${id}`);
  }
  for (const id of stageIds) assert.ok(TESTER_GROUP_IDS.some(group => QUEST_PATHS[group].includes(id)), id);
  assert.deepEqual(QUEST_PATHS.E, ['builder', 'market']);
});

test('tester-map progress: parsing keeps only known steps once, in quest order, and rejects other shapes', () => {
  for (const value of [null, undefined, 1, 'x', [], {}, { v: 2, done: [QUEST_STEP_IDS[0]] }, { done: [QUEST_STEP_IDS[0]] }])
    assert.deepEqual(normalizeProgress(value), { group: null, done: [] });
  const [first, second] = QUEST_STEP_IDS;
  assert.deepEqual(normalizeProgress({ v: 1, group: 'C', done: [second, 'invented.step', first, second, 7, null] }), { group: 'C', done: [first, second] });
  assert.deepEqual(normalizeProgress({ v: 1, group: 'F', done: 'not-a-list' }), { group: null, done: [] });
  assert.deepEqual(normalizeProgress({ v: 1, group: '__proto__', done: [first] }), { group: null, done: [first] });
});

test('tester-map progress: write, read and reset use one versioned key and survive broken storage', () => {
  const storage = memoryStorage();
  assert.deepEqual(readTesterProgress(storage), { group: null, done: [] });
  const progress = toggleStep({ group: 'A', done: [] }, QUEST_STEP_IDS[2]);
  writeTesterProgress(progress, storage);
  assert.deepEqual([...storage.values.keys()], [TESTER_PROGRESS_KEY]);
  assert.match(TESTER_PROGRESS_KEY, /-v1$/);
  assert.deepEqual(JSON.parse(storage.values.get(TESTER_PROGRESS_KEY)!), { v: 1, group: 'A', done: [QUEST_STEP_IDS[2]] });
  assert.deepEqual(readTesterProgress(storage), { group: 'A', done: [QUEST_STEP_IDS[2]] });
  assert.deepEqual(toggleStep(readTesterProgress(storage), QUEST_STEP_IDS[2]).done, []);
  resetTesterProgress(storage);
  assert.equal(storage.values.has(TESTER_PROGRESS_KEY), false);
  assert.deepEqual(readTesterProgress(memoryStorage({ [TESTER_PROGRESS_KEY]: '{not json' })), { group: null, done: [] });
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  assert.deepEqual(readTesterProgress(broken), { group: null, done: [] });
  assert.doesNotThrow(() => writeTesterProgress(progress, broken));
  assert.doesNotThrow(() => resetTesterProgress(broken));
  assert.deepEqual(readTesterProgress(null), { group: null, done: [] });
});

test('tester-map medals: derived only from local progress for steps, stages, the chosen path and the whole map', () => {
  assert.deepEqual(earned({ group: null, done: [] }), []);
  const stage = QUEST_STAGES[0];
  const oneStep = { group: null, done: [stage.steps[0].id] };
  assert.deepEqual(earned(oneStep), ['first-step']);
  const firstStage = normalizeProgress({ v: 1, done: stage.steps.map(step => step.id) });
  assert.equal(stageProgress(stage, firstStage).complete, true);
  assert.ok(earned(firstStage).includes(`stage:${stage.id}`));
  const pathSteps = (group: 'E') => QUEST_STAGES.filter(item => QUEST_PATHS[group].includes(item.id)).flatMap(item => item.steps.map(step => step.id));
  assert.equal(earned({ group: null, done: pathSteps('E') }).includes('path'), false);
  assert.ok(earned(normalizeProgress({ v: 1, group: 'E', done: pathSteps('E') })).includes('path'));
  assert.ok(earned(normalizeProgress({ v: 1, group: 'E', done: pathSteps('E') })).includes('ten-steps'));
  const all = earned({ group: 'A', done: QUEST_STEP_IDS });
  assert.equal(all.length, testerMedals({ group: null, done: [] }).length);
  assert.ok(all.includes('all-stages'));
  assert.equal(earned({ group: 'A', done: QUEST_STEP_IDS.slice(1) }).includes('all-stages'), false);
});

test('tester-map: event registration is not behind event_participation_enabled, matching the real route gates', () => {
  const source = readFileSync('apps/platform-api/src/platform-app.ts', 'utf8');
  const gated = [...source.matchAll(/app\.use\('([^']+)',eventParticipationEnabled\)/g)].map(match => match[1]);
  assert.ok(gated.length >= 6);
  for (const path of gated) assert.match(path, /\/(participation|participation-request|waitlist|waitlist-policy|schedule|calendar|reminder)$/, path);
  // Baseline member RSVP and the public registration form stay outside the flag.
  assert.match(readFileSync('apps/platform-api/src/routes/community-events.ts', 'utf8'), /app\.post\('\/events\/:id\/rsvp'/);
  assert.match(readFileSync('apps/platform-api/src/features/public-events.ts', 'utf8'), /app\.post\('\/api\/v1\/public\/events\/:id\/register'/);
  for (const path of ['/api/v1/events/:id/rsvp', '/api/v1/public/events/:id/register']) assert.equal(gated.includes(path), false, path);
  const register = features.find(feature => feature.id === 'events.register')!;
  assert.equal(register.flag, undefined);
  assert.equal(isDefaultOff(register), false);
  assert.ok(steps.some(step => step.features.includes('events.register')));
  assert.equal(features.find(feature => feature.id === 'events.participation')!.flag, 'event_participation_enabled');
});

test('tester-map quest: five-place words appear in every language and match visible navigation and screen titles', () => {
  const step = steps.find(item => item.id === 'explore.features')!;
  const view = readFileSync('apps/portal-web/src/features/PlaceView.tsx', 'utf8');
  const directory = readFileSync('apps/portal-web/src/guild-tools/GuildToolDirectory.tsx', 'utf8');
  const navigation = readFileSync('apps/portal-web/src/Navigation.tsx', 'utf8');
  assert.ok(navigation.includes('{item.title}'));
  const message = /choice\('([^']+)','messages'\)/.exec(view)![1];
  assert.ok(view.includes('>檢視<select'));
  assert.ok(directory.includes('>公會工具<select'));
  const tools = ['store', 'catalog'].map(id => GUILD_TOOLS.find(tool => tool.tool_id === id)!);
  const labels = ['me', 'guilds'].map(id => PORTAL_PLACES.find(place => place.id === id)!.title);
  // These shell controls currently render Chinese literals in every locale.
  const visible = [...labels, '檢視', message, '公會工具', ...tools.flatMap(tool => [guildRepository(tool.guild_key)!.name, tool.title])];
  for (let index = 0; index < 5; index++) {
    for (const label of visible) assert.ok(step.task[index].includes(label), `${index}: ${label}`);
    for (const key of ['nav.messages'] as const)
      assert.ok(step.check[index].includes(interfaceMessages[key][index]), `${index}: ${key}`);
    for (const tool of tools) assert.ok(step.check[index].includes(tool.title), `${index}: ${tool.title}`);
    assert.ok(step.task[index].includes(['瀏覽器上一頁', 'browser Back', 'ブラウザーで戻', '브라우저에서 뒤로', 'Atrás'][index]));
    assert.ok(!step.task[index].includes(interfaceMessages['nav.more'][index]));
    assert.ok(!step.title[index].includes(interfaceMessages['nav.search'][index]));
  }
  for (const [id, place, tab] of [
    ['guild.shelf', 'explore', 'skills'], ['profile.content', 'me', 'my-content'],
    ['profile.todos', 'me', 'todos'], ['social.people', 'explore', 'members'],
    ['market.orders', 'me', 'reservations'], ['market.orders', 'me', 'business'],
    ['builder.promotion', 'explore', 'services'], ['builder.promotion', 'me', 'promotion'],
  ]) {
    const label = new RegExp("choice\\('([^']+)','" + tab + "'").exec(view)![1];
    const placeTitle = PORTAL_PLACES.find(item => item.id === place)!.title;
    for (const task of steps.find(item => item.id === id)!.task) {
      assert.ok(task.includes(placeTitle), `${id}: ${placeTitle}`);
      assert.ok(task.includes(label), `${id}: ${label}`);
    }
  }
  for (const [id, toolId] of [['builder.tasks', 'work'], ['builder.tasks', 'cocreation'], ['builder.opensource', 'marketing'], ['market.offer', 'supplier-kit'], ['market.offer', 'retail-kit']]) {
    const tool = GUILD_TOOLS.find(item => item.tool_id === toolId)!;
    for (const task of steps.find(item => item.id === id)!.task) {
      assert.ok(task.includes(tool.title), `${id}: ${tool.title}`);
      assert.ok(task.includes(guildRepository(tool.guild_key)!.name), `${id}: guild`);
    }
  }
  for (let index = 0; index < 5; index++)
    assert.ok(steps.find(item => item.id === 'profile.menu')!.task[index].includes(interfaceMessages['settings.title'][index]));
  assert.equal(resolvePortalRoute('#messages').place, 'me');
  for (const hash of ['#stores', '#stores/supply']) assert.equal(resolvePortalRoute(hash).place, 'guilds');
});

test('tester-map quest: event and highlight checks quote the real visibility labels and expect restricted recaps to be refused', () => {
  const panel = readFileSync('apps/portal-web/src/modules/EventsPanel.tsx', 'utf8');
  const highlights = readFileSync('apps/portal-web/src/modules/EventHighlights.tsx', 'utf8');
  for (const label of ['完全公開 · ', '推薦連結公開 · ', '工坊會員 · ', '公會內部 · ']) assert.ok(panel.includes(label), label);
  assert.ok(highlights.includes('公開頁 ↗'));
  assert.match(highlights, /不提供匿名公開頁/);
  const events = steps.find(item => item.id === 'explore.events')!, recap = steps.find(item => item.id === 'explore.highlights')!;
  for (let index = 0; index < 5; index++) {
    for (const label of ['完全公開', '推薦連結公開']) assert.ok(events.task[index].includes(label), `events.task[${index}] ${label}`);
    for (const label of ['工坊會員', '公會內部']) assert.ok(events.check[index].includes(label), `events.check[${index}] ${label}`);
    assert.ok(recap.task[index].includes('公開頁 ↗'), `highlights.task[${index}]`);
  }
});

test('tester-map quest: store steps never ask for photo uploads while hosted_store_photo_uploads_enabled is off', () => {
  // The real dependency: site flag → HostedStore → StorePage → products area → photo editor guard.
  assert.match(readFileSync('apps/portal-web/src/features/commerce.tsx', 'utf8'), /photoUploadsEnabled=\{site\?\.hosted_store_photo_uploads_enabled===true\}/);
  function assertForwarded(path: string, tag: string, property: string, count: number) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found = 0;
    function visit(node: ts.Node) {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === tag) {
        found++;
        const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(source) === property);
        assert.ok(attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer));
        assert.equal(attribute.initializer.expression?.getText(source), 'photoUploadsEnabled', `${path}: ${tag}.${property}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source); assert.equal(found, count, `${path}: ${tag} forwarding sites`);
  }
  assertForwarded('apps/portal-web/src/modules/HostedStore.tsx', 'StorePage', 'photoUploadsEnabled', 2);
  assertForwarded('apps/portal-web/src/modules/HostedStore.tsx', 'HostedStoreProductsArea', 'photoUploadsEnabled', 1);
  assertForwarded('apps/portal-web/src/modules/HostedStoreProductsArea.tsx', 'HostedStorePhoto', 'uploadsEnabled', 1);
  assert.match(readFileSync('apps/portal-web/src/modules/HostedStorePhoto.tsx', 'utf8'), /\{uploadsEnabled&&<label htmlFor=\{id\}>商品照片<input [^>]*type="file"/);
  const uploads = features.find(feature => feature.id === 'shop.photo-uploads')!;
  assert.equal(uploads.flag, 'hosted_store_photo_uploads_enabled');
  assert.equal(TESTER_FLAGS.hosted_store_photo_uploads_enabled, 'off');
  assert.equal(isDefaultOff(uploads), true);
  assert.equal(steps.some(step => step.features.includes('shop.photo-uploads')), false);
  // Adding/uploading wording per language: zh, en, ja, ko, es.
  const asksForUpload = [
    /(加|新增|上傳|選擇|附上)[^。；]{0,15}(照片|圖片)/,
    /\b(add|upload|attach|choose)\b[^.;]{0,60}\b(photo|picture|image)s?\b/i,
    /(写真|画像)(を|も)?(付け|追加|アップロード|選)/,
    /(사진|이미지)[^.]{0,6}(넣|추가|업로드|올리|선택)/,
    /\b(añade|añadir|sube|subir|adjunta|elige)\b[^.;]{0,60}\b(foto|imagen)/i,
  ];
  const market = QUEST_STAGES.find(stage => stage.id === 'market')!;
  for (const step of market.steps) for (let index = 0; index < 5; index++)
    for (const text of [step.task[index], step.check[index]]) assert.doesNotMatch(text, asksForUpload[index], `${step.id}[${index}]`);
});
