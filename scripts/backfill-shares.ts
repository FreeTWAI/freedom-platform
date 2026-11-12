import {Pool} from 'pg';
import {planShareBackfill,applyShareBackfill} from '../modules/shares/backfill.js';
// Explicit connection only. Operators run against a separately reviewed backup/target at integration.
const raw=process.env.TEST_DATABASE_URL;
if(!raw)throw Error('An explicitly provisioned TEST_DATABASE_URL is required.');
const url=new URL(raw);
if(!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/fp_[a-z0-9_]+$/.test(url.pathname)||url.password||url.search)throw Error('Only explicit loopback fp_* test databases are accepted; use PGPASSWORD.');
if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error('Usage: backfill-shares.ts [--apply]');
const pool=new Pool({connectionString:raw});
try{
 const plan=await planShareBackfill(pool);
 const dry=await applyShareBackfill(pool,plan,false);console.log(JSON.stringify({mode:'dry-run',counts:dry}));
 if(process.argv.includes('--apply')){const applied=await applyShareBackfill(pool,plan,true);console.log(JSON.stringify({mode:'apply',counts:applied}));}
}finally{await pool.end();}
