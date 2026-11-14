import {Pool} from 'pg';
import {planShareBackfill,applyShareBackfill} from '../modules/shares/backfill.js';
const isolated=process.env.TEST_DATABASE_URL;
// Release operators must supply this explicit target; no ambient DATABASE_URL fallback.
const raw=isolated??process.env.SHARES_BACKFILL_DATABASE_URL;
if(!raw)throw Error('Explicit TEST_DATABASE_URL or operator-reviewed SHARES_BACKFILL_DATABASE_URL required.');
const url=new URL(raw);
if(isolated&&(!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/fp_[a-z0-9_]+$/.test(url.pathname)||url.password||url.search))throw Error('Use an isolated loopback fp_* database and PGPASSWORD.');
if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error('Usage: backfill-shares.ts [--apply]');
const pool=new Pool({connectionString:raw});
try{
 // Optional read-only token so the one-off run is not held to GitHub's anonymous limit.
 const plan=await planShareBackfill(pool,{token:process.env.SHARES_BACKFILL_GITHUB_TOKEN||undefined});
 const dry=await applyShareBackfill(pool,plan,false);console.log(JSON.stringify({mode:'dry-run',counts:dry,unresolved:plan.unresolved}));
 if(process.argv.includes('--apply')){const applied=await applyShareBackfill(pool,plan,true);console.log(JSON.stringify({mode:'apply',counts:applied,unresolved:plan.unresolved}));}
}finally{await pool.end();}
