import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Pool} from 'pg';
import {createWorkerHandler, type WorkerEnv} from '../../apps/platform-api/src/worker.js';
import {GITHUB_SYNC_REQUEST_BUDGET, type GitHubSyncOptions, type GitHubSyncSummary} from '../../modules/community/github-sync.js';

const TOKEN = 'synthetic-metrics-token';
const empty: GitHubSyncSummary = {requests: 0, repositories: 0, items_upserted: 0, not_modified: 0, stop_reason: 'completed'};

function env(): WorkerEnv {
  return {FREEDOM_COMMERCE_CONTACT_RETENTION:'all',HYPERDRIVE: {connectionString: 'postgres://unused'}, ASSETS: {fetch: async () => new Response(null)}, GITHUB_METRICS_TOKEN: TOKEN} as WorkerEnv;
}
function context() {
  const pending: Promise<unknown>[] = [];
  return {pending, ctx: {waitUntil(promise: Promise<unknown>) { pending.push(promise); }}};
}
async function capture(run: () => Promise<void>) {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
  try { await run(); } finally { console.error = original; }
  return logged;
}

test('the platform worker exposes scheduled and runs one bounded sync for events, repositories and metrics', async () => {
  const pool = {ended: 0,async query(sql:string){return {rows:sql.includes('INSERT INTO github_feed_state')?[{}]:[]};}, async end() { this.ended += 1; }};
  let retained = 0, refreshed = 0;
  const githubFetcher: typeof fetch = async () => { throw Error('unexpected network'); };
  let seen: {budget?: number; token?: string; pool?: unknown} = {};
  let pruned: unknown;
  const handler = createWorkerHandler({
    createPool: () => pool as unknown as Pool,
    commerceRetention: async given => {
      assert.equal(given, pool); retained++;
      return {claimed: 0, completed: 0, failed: 0, externalCalls: 0, released: 0, unknown: 0};
    },
    commerceDueWork:async()=>({claimed:0,completed:0,failed:0,externalCalls:0,released:0,unknown:0}),
    commerceSweep:async()=>0,
    commerceEmailSweep:async()=>({expired:0,deleted:0}),
    commerceApplyDeferred:async()=>({applied:0,failed:0,skipped:0}),
    githubFetcher,
    sharesRefresh: async (given, options, limit) => { assert.equal(given, pool); assert.equal(options?.token, TOKEN); assert.notEqual(options?.fetcher, githubFetcher); assert.equal(limit, 2); refreshed++; return 0; },
    syncGitHub: async (given, options?: GitHubSyncOptions) => {
      assert.equal(refreshed, 1);
      seen = {budget: options?.budget, token: options?.token, pool: given};
      return empty;
    },
    authPrune: async given => { pruned = given; return {sessions: 0, login_attempts: 0, auth_rate_limits: 0, password_reset_tokens: 0}; },
    agentPings: async () => ({claimed: 0, sent: 0, failed: 0}),
  });
  assert.equal(typeof handler.fetch, 'function');
  assert.equal(typeof handler.scheduled, 'function');
  const {ctx, pending} = context();
  await handler.scheduled({cron: '*/10 * * * *', scheduledTime: Date.now()}, env(), ctx);
  assert.equal(seen.budget, 18);
  assert.equal(GITHUB_SYNC_REQUEST_BUDGET, 40);
  assert.equal(seen.token, TOKEN);
  assert.equal(seen.pool, pool);
  assert.equal(pruned, pool, 'the scheduled run prunes expired auth records with the same pool');
  assert.equal(retained, 1);
  assert.equal(refreshed, 1);
  assert.equal(pool.ended, 1);
  assert.equal(pending.length, 1);
  await Promise.all(pending);
});

test('a scheduled sync failure is logged without the token and still ends the pool', async () => {
  const pool = {ended: 0,async query(sql:string){return {rows:sql.includes('INSERT INTO github_feed_state')?[{}]:[]};}, async end() { this.ended += 1; }};
  let retained = 0;
  const handler = createWorkerHandler({
    createPool: () => pool as unknown as Pool,
    commerceRetention: async given => {
      assert.equal(given, pool); retained++;
      return {claimed: 0, completed: 0, failed: 0, externalCalls: 0, released: 0, unknown: 0};
    },
    commerceDueWork:async()=>({claimed:0,completed:0,failed:0,externalCalls:0,released:0,unknown:0}),
    commerceSweep:async()=>0,
    commerceEmailSweep:async()=>({expired:0,deleted:0}),
    commerceApplyDeferred:async()=>({applied:0,failed:0,skipped:0}),
    sharesRefresh: async (given, options, limit) => { assert.equal(given, pool); assert.equal(options?.token, TOKEN); assert.equal(limit, 2); return 0; },
    syncGitHub: async () => { throw new Error('sync failed ' + TOKEN); },
    authPrune: async () => ({sessions: 0, login_attempts: 0, auth_rate_limits: 0, password_reset_tokens: 0}),
    agentPings: async () => ({claimed: 0, sent: 0, failed: 0}),
  });
  const {ctx, pending} = context();
  const logged = await capture(async () => {
    await handler.scheduled({cron: '*/10 * * * *'}, env(), ctx);
  });
  assert.deepEqual(logged, ['github_sync_failed Error']);
  assert.equal(logged.join(' ').includes(TOKEN), false);
  assert.equal(retained, 1);
  assert.equal(pool.ended, 1);
  await Promise.all(pending);
});

test('a failing auth prune logs one line and still ends the pool', async () => {
  const pool = {ended: 0,async query(sql:string){return {rows:sql.includes('INSERT INTO github_feed_state')?[{}]:[]};}, async end() { this.ended += 1; }};
  let retained = 0;
  const handler = createWorkerHandler({
    createPool: () => pool as unknown as Pool,
    commerceRetention: async given => {
      assert.equal(given, pool); retained++;
      return {claimed: 0, completed: 0, failed: 0, externalCalls: 0, released: 0, unknown: 0};
    },
    commerceDueWork:async()=>({claimed:0,completed:0,failed:0,externalCalls:0,released:0,unknown:0}),
    commerceSweep:async()=>0,
    commerceEmailSweep:async()=>({expired:0,deleted:0}),
    commerceApplyDeferred:async()=>({applied:0,failed:0,skipped:0}),
    sharesRefresh: async (given, options, limit) => { assert.equal(given, pool); assert.equal(options?.token, TOKEN); assert.equal(limit, 2); return 0; },
    syncGitHub: async () => empty,
    authPrune: async () => { throw new Error('prune failed ' + TOKEN); },
    agentPings: async () => ({claimed: 0, sent: 0, failed: 0}),
  });
  const {ctx, pending} = context();
  const logged = await capture(async () => {
    await handler.scheduled({cron: '*/10 * * * *'}, env(), ctx);
  });
  assert.deepEqual(logged, ['auth_prune_failed']);
  assert.equal(retained, 1);
  assert.equal(pool.ended, 1);
  await Promise.all(pending);
});

test('a pool factory failure is logged by name and does not end a pool', async () => {
  let ended = 0;
  const handler = createWorkerHandler({
    createPool: () => { throw new Error('postgres://user:secret@127.0.0.1/freedom_local'); },
    syncGitHub: async () => { ended += 1; return empty; },
  });
  const {ctx, pending} = context();
  const logged = await capture(async () => {
    await handler.scheduled({cron: '*/10 * * * *'}, env(), ctx);
  });
  assert.deepEqual(logged, ['github_sync_failed Error']);
  assert.equal(logged.join(' ').includes('postgres://'), false);
  assert.equal(logged.join(' ').includes('secret'), false);
  assert.equal(ended, 0);
  await Promise.all(pending);
});

test('share refresh failure is redacted and does not stop GitHub sync or pool cleanup', async () => {
  const calls: string[] = [];
  const pool = { async query(sql:string){return {rows:sql.includes('INSERT INTO github_feed_state')?[{}]:[]};}, async end() { calls.push('end'); } };
  const handler = createWorkerHandler({
    createPool: () => pool as unknown as Pool,
    commerceRetention: async () => ({claimed:0,completed:0,failed:0,externalCalls:0,released:0,unknown:0}),
    commerceDueWork: async () => ({claimed:0,completed:0,failed:0,externalCalls:0,released:0,unknown:0}),
    commerceSweep: async () => 0,
    commerceEmailSweep: async () => ({expired:0,deleted:0}),
    commerceApplyDeferred: async () => ({applied:0,failed:0,skipped:0}),
    sharesRefresh: async (given, options, limit) => {
      assert.equal(given, pool); assert.equal(options?.token, TOKEN); assert.equal(limit, 2);
      calls.push('shares'); throw Error('refresh failed ' + TOKEN);
    },
    syncGitHub: async (_given, options) => { assert.equal(options?.token, TOKEN); calls.push('github'); return empty; },
    authPrune: async () => { calls.push('auth'); return {sessions:0,login_attempts:0,auth_rate_limits:0,password_reset_tokens:0}; },
    agentPings: async () => ({claimed: 0, sent: 0, failed: 0}),
  });
  const {ctx, pending} = context();
  const logged = await capture(async () => { await handler.scheduled({}, env(), ctx); await Promise.all(pending); });
  assert.deepEqual(logged, ['shares_refresh_failed']);
  assert.equal(logged.join(' ').includes(TOKEN), false);
  assert.deepEqual(calls, ['auth', 'shares', 'github', 'end']);
});

test('overlapping scheduled runs are skipped and cleanup runs before refresh',async()=>{
  let owner:string|null=null,refreshes=0;
  const phases:string[]=[];
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
  const pool=()=>({
    async query(sql:string,args:unknown[]){
      if(sql.includes('INSERT INTO github_feed_state')){if(owner)return {rows:[],rowCount:0};owner=String(args[0]);return {rows:[{etag:owner}],rowCount:1};}
      if(sql.includes('DELETE FROM github_feed_state')){if(owner===args[0])owner=null;return {rows:[],rowCount:1};}
      throw Error('unexpected query');
    },async end(){}
  }) as unknown as Pool;
  const handler=createWorkerHandler({createPool:pool,
    commerceDueWork:async()=>({claimed:0,completed:0,failed:0,externalCalls:0,released:0,unknown:0}),commerceSweep:async()=>0,commerceEmailSweep:async()=>({expired:0,deleted:0}),commerceApplyDeferred:async()=>({applied:0,failed:0,skipped:0}),
    commerceRetention:async()=>({claimed:0,completed:0,failed:0,externalCalls:0,released:0,unknown:0}),
    authPrune:async()=>{phases.push('cleanup');return {sessions:0,login_attempts:0,auth_rate_limits:0,password_reset_tokens:0};},
    agentPings:async()=>({claimed:0,sent:0,failed:0}),
    sharesRefresh:async()=>{phases.push('refresh');refreshes++;if(refreshes===1){started();await gate;}return 0;},
    syncGitHub:async()=>empty});
  const first=handler.scheduled({},env(),context().ctx);
  await entered;
  try{await handler.scheduled({},env(),context().ctx);assert.equal(refreshes,1);assert.deepEqual(phases.slice(0,2),['cleanup','refresh']);}
  finally{release();await first;}
});

test('scheduled repository refresh has a bounded outbound budget',async()=>{
  let outbound=0,limitSeen=0;
  const pool={async query(sql:string){return sql.includes('INSERT INTO github_feed_state')?{rows:[{etag:'claimed'}],rowCount:1}:{rows:[],rowCount:1};},async end(){}} as unknown as Pool;
  const handler=createWorkerHandler({createPool:()=>pool,githubFetcher:async()=>{outbound++;return new Response('{}');},
    commerceDueWork:async()=>({claimed:0,completed:0,failed:0,externalCalls:0,released:0,unknown:0}),commerceSweep:async()=>0,commerceEmailSweep:async()=>({expired:0,deleted:0}),commerceApplyDeferred:async()=>({applied:0,failed:0,skipped:0}),
    commerceRetention:async()=>({claimed:0,completed:0,failed:0,externalCalls:0,released:0,unknown:0}),
    authPrune:async()=>({sessions:0,login_attempts:0,auth_rate_limits:0,password_reset_tokens:0}),
    agentPings:async()=>({claimed:0,sent:0,failed:0}),
    sharesRefresh:async(_pool,options,limit)=>{limitSeen=limit??0;for(let i=0;i<30;i++)try{await options!.fetcher!('https://api.github.com/repos/example/repo');}catch{}return 0;},
    syncGitHub:async()=>empty});
  await handler.scheduled({},env(),context().ctx);
  assert.ok(limitSeen<=3,`repository limit was ${limitSeen}`);
  assert.ok(outbound<=20,`scheduled GitHub requests were ${outbound}`);
});

test('scheduled runs agentPings after authPrune and logs agent_pings_failed on error', async () => {
  const pool = {ended: 0, async query(sql:string){return {rows:sql.includes('INSERT INTO github_feed_state')?[{}]:[]};}, async end() { this.ended += 1; }};
  const calls: string[] = [];
  let pingPool: unknown;
  let pingSend: unknown;
  const handler = createWorkerHandler({
    createPool: () => pool as unknown as Pool,
    commerceRetention: async () => ({claimed: 0, completed: 0, failed: 0, externalCalls: 0, released: 0, unknown: 0}),
    commerceDueWork: async () => ({claimed: 0, completed: 0, failed: 0, externalCalls: 0, released: 0, unknown: 0}),
    commerceSweep: async () => 0,
    commerceEmailSweep: async () => ({expired: 0, deleted: 0}),
    commerceApplyDeferred: async () => ({applied: 0, failed: 0, skipped: 0}),
    sharesRefresh: async () => { calls.push('shares'); return 0; },
    syncGitHub: async () => { calls.push('github'); return empty; },
    authPrune: async () => { calls.push('auth'); return {sessions: 0, login_attempts: 0, auth_rate_limits: 0, password_reset_tokens: 0}; },
    agentPings: async (given, send) => {
      calls.push('pings');
      pingPool = given;
      pingSend = send;
      throw new Error('ping sweep boom');
    },
  });
  const {ctx, pending} = context();
  const logged = await capture(async () => {
    await handler.scheduled({cron: '*/10 * * * *'}, env(), ctx);
  });
  await Promise.all(pending);
  assert.equal(pingPool, pool);
  assert.equal(typeof pingSend, 'function');
  assert.deepEqual(calls, ['auth', 'pings', 'shares', 'github']);
  assert.deepEqual(logged, ['agent_pings_failed']);
});

test('scheduled skips agentPings when FREEDOM_AGENT_PINGS_DISABLED is true', async () => {
  const pool = {ended: 0, async query(sql:string){return {rows:sql.includes('INSERT INTO github_feed_state')?[{}]:[]};}, async end() { this.ended += 1; }};
  let pingCalls = 0;
  const handler = createWorkerHandler({
    createPool: () => pool as unknown as Pool,
    commerceRetention: async () => ({claimed: 0, completed: 0, failed: 0, externalCalls: 0, released: 0, unknown: 0}),
    commerceDueWork: async () => ({claimed: 0, completed: 0, failed: 0, externalCalls: 0, released: 0, unknown: 0}),
    commerceSweep: async () => 0,
    commerceEmailSweep: async () => ({expired: 0, deleted: 0}),
    commerceApplyDeferred: async () => ({applied: 0, failed: 0, skipped: 0}),
    sharesRefresh: async () => 0,
    syncGitHub: async () => empty,
    authPrune: async () => ({sessions: 0, login_attempts: 0, auth_rate_limits: 0, password_reset_tokens: 0}),
    agentPings: async () => { pingCalls++; return {claimed: 0, sent: 0, failed: 0}; },
  });
  const {ctx, pending} = context();
  const logged = await capture(async () => {
    await handler.scheduled({cron: '*/10 * * * *'}, {...env(), FREEDOM_AGENT_PINGS_DISABLED: 'true'}, ctx);
  });
  await Promise.all(pending);
  assert.equal(pingCalls, 0);
  assert.deepEqual(logged, []);
});
