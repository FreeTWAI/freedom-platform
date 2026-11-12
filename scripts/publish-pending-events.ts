import {Pool} from 'pg';
import {publishPendingEvents} from '../modules/community/publish-pending-events.js';
const isolated=process.env.TEST_DATABASE_URL;
// Release operators must supply this explicit target; no ambient DATABASE_URL fallback.
const raw=isolated??process.env.EVENT_PUBLISH_DATABASE_URL;
if(!raw)throw Error('Explicit TEST_DATABASE_URL or operator-reviewed EVENT_PUBLISH_DATABASE_URL required.');
const url=new URL(raw);
if(isolated&&(!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/fp_[a-z0-9_]+$/.test(url.pathname)||url.password||url.search))throw Error('Use an isolated loopback fp_* database and PGPASSWORD.');
if(process.argv.slice(2).some(x=>x!=='--apply'))throw Error('Usage: publish-pending-events.ts [--apply]');
const pool=new Pool({connectionString:raw});
try{console.log(JSON.stringify({mode:'dry-run',...await publishPendingEvents(pool)}));if(process.argv.includes('--apply'))console.log(JSON.stringify({mode:'apply',...await publishPendingEvents(pool,true)}));}finally{await pool.end();}
