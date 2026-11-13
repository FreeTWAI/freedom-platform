import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer,type AddressInfo} from 'node:net';
import {dirname} from 'node:path';
import {Pool} from 'pg';
import {test as base} from './fixtures.js';
import {LOCAL_DATABASE_URL} from '../../packages/db/index.js';
import {e2eSchema,resetE2eAuthState} from '../../packages/testing/e2e-auth-isolation.js';

// Authoring only: execute through the official isolated local/CI E2E harness.
// Never point a journey or its synthetic fixture at a production database.
// Publication retains immutable credit facts, so a journey that publishes in a
// synthetic second community cannot delete that community afterwards. Such a
// spec owns its entire schema: it starts the configured browser-test server
// command (the same flags and fixtures as the shared server) on its own schema
// and port, so the community never leaks into another file's single-community
// guild catalog. The server drops its schema on the same graceful signal that
// Playwright sends the shared server.
async function loopbackPort(){
  const probe=createServer();
  await new Promise<void>((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});
  const {port}=probe.address() as AddressInfo;
  await new Promise<void>(resolve=>probe.close(()=>resolve()));
  return port;
}

export const isolatedSchemaTest=base.extend<{},{isolatedServer:{origin:string;schema:string}}>({
  isolatedServer:[async({},use,workerInfo)=>{
    const {workers,webServer,configFile}=workerInfo.config;
    if(workers!==1)throw Error('The isolated-schema fixture requires one worker.');
    if(!webServer)throw Error('The isolated-schema fixture starts the configured browser-test server.');
    const schema=e2eSchema(`fp_e2e_${randomUUID().replaceAll('-','')}`);
    const port=await loopbackPort(),origin=`http://127.0.0.1:${port}`;
    const server=spawn(webServer.command,{shell:true,detached:true,cwd:webServer.cwd??(configFile?dirname(configFile):process.cwd()),
      stdio:['ignore','ignore','pipe'],env:{...process.env,...webServer.env,FREEDOM_E2E_SCHEMA:schema,FREEDOM_E2E_PORT:String(port)}});
    let stderr='';server.stderr!.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
    let running=true;const exited=new Promise<void>(resolve=>server.once('exit',()=>{running=false;resolve();}));
    const signal=(name:NodeJS.Signals)=>{if(running)try{process.kill(-server.pid!,name);}catch{/* already gone */}};
    const onWorkerExit=()=>signal('SIGTERM');process.once('exit',onWorkerExit);
    try{
      const deadline=Date.now()+(webServer.timeout||60000);
      for(;;){
        if(!running)throw Error(`The isolated browser-test server exited during startup.\n${stderr}`);
        try{if((await fetch(`${origin}/api/v1/health`,{signal:AbortSignal.timeout(2000)})).ok)break;}catch{/* not listening yet */}
        if(Date.now()>deadline)throw Error(`The isolated browser-test server did not become healthy.\n${stderr}`);
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      await use({origin,schema});
    }finally{
      process.off('exit',onWorkerExit);
      signal('SIGTERM');
      await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,webServer.gracefulShutdown?.timeout??15000))]);
      signal('SIGKILL');
    }
  },{scope:'worker',timeout:180000}],
  e2eAuthPool:[async({isolatedServer},use)=>{
    const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL??LOCAL_DATABASE_URL,
      options:`-c search_path=${isolatedServer.schema}`,connectionTimeoutMillis:5000});
    try{await use(pool);}finally{await pool.end();}
  },{scope:'worker'}],
  isolateAuth:async({e2eAuthPool,isolatedServer},use)=>{
    await resetE2eAuthState(e2eAuthPool,isolatedServer.schema);await use();
  },
  baseURL:async({isolatedServer},use)=>{await use(isolatedServer.origin);},
});
