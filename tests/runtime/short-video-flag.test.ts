import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readWorkerConfig,workerRuntime,type WorkerEnv} from '../../apps/platform-api/src/worker.js';
import {ReadinessError} from '../../apps/platform-api/src/readiness.js';
import {platformContentSecurityPolicy} from '../../apps/platform-api/src/platform-app.js';

const bindings = (): WorkerEnv => ({ FREEDOM_ENV: 'local', APP_ORIGIN: 'http://127.0.0.1:4310', HYPERDRIVE: { connectionString: 'postgres://unused' }, ASSETS: { fetch: async () => new Response() } });

test('the Worker accepts only true or false for the Short flag, and only true turns it on',()=>{
  for(const value of ['yes','TRUE','1',' true',''])
    assert.throws(()=>readWorkerConfig({...bindings(),FREEDOM_SHORT_VIDEOS_ENABLED:value}),(error:unknown)=>error instanceof ReadinessError&&error.message==='Short video flag must be true or false.');
  for(const [value,expected] of [[undefined,false],['false',false],['true',true]] as const){
    const env={...bindings(),FREEDOM_SHORT_VIDEOS_ENABLED:value};
    assert.equal(workerRuntime(env,readWorkerConfig(env)).shortVideosEnabled,expected);
  }
});

test('the player origin appears in the page policy only for a Worker that enabled the flag',()=>{
  assert.ok(!platformContentSecurityPolicy('/').includes('frame-src'));
  assert.ok(platformContentSecurityPolicy('/',undefined,undefined,true).includes('frame-src https://www.youtube-nocookie.com;'));
});
