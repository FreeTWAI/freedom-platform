/** Candidate-art operator only. Not a trusted admission gate or release tool. */
import {readFile,writeFile,mkdir,lstat,readdir,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const approvedPaths=["apps/portal-web/src/games/cooking/catalog.ts","apps/portal-web/src/games/cooking/dish-designs.ts","apps/portal-web/src/games/cooking/dish-model.ts","apps/portal-web/src/games/cooking/dish-stage.ts","apps/portal-web/src/games/cooking/food-geometry.ts","apps/portal-web/src/games/cooking/food-kit.ts","apps/portal-web/src/games/cooking/food-studio.ts","apps/portal-web/src/games/cooking/food-surfaces.ts","apps/portal-web/src/games/cooking/market-domain.ts","apps/portal-web/src/games/cooking/market-food.ts","apps/portal-web/src/games/domain.ts","apps/portal-web/src/games/party/catalog.ts","apps/portal-web/src/games/party/domain.ts","apps/portal-web/src/games/party/stage.ts","apps/portal-web/src/games/party/tofu-batch.ts","apps/portal-web/src/games/stage-batch.ts","apps/portal-web/vite.config.ts","package-lock.json","package.json"];
const approvedRequestDigest='5badbaddd73d77169cd4fcb8bacd78304558f0641c32e6d830db39baabf09e66';
const approvedPreviousHead='adeeefedfc6c7a9bf9177fbaba6b530e6021f299';
const approvedPreviousRequestDigest='29991f3c59c58ae15b01f4efe1d0f64d62c083680beaaa37f8fd60e82d6f0120';
const approvedSource='ba3992ee23fc503e0e2b8f0e2f08dde8fa91d440';
const requestPath='modules/absurd-daily/tools/capture-request.json';
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
export function validateRequest(r){
 if(r?.format!=='freedom.native-capture-request/v1'||r.request_id!=='cooking66-party3-20261028-03-index-framing'||r.source_base_sha!=='ba3992ee23fc503e0e2b8f0e2f08dde8fa91d440'||r.families?.join(',')!=='cooking,party'||!Array.isArray(r.source_inputs)||r.source_inputs.length!==approvedPaths.length)throw Error('invalid_capture_request');
 const paths=new Set();for(const s of r.source_inputs){if(typeof s.path!=='string'||!(/^(apps\/portal-web\/src\/games\/|apps\/portal-web\/vite\.config\.ts$|package(?:-lock)?\.json$)/.test(s.path))||s.path.split('/').some(p=>!p||p==='.'||p==='..')||s.path.includes('\\')||!(/^[a-f0-9]{64}$/.test(s.sha256))||paths.has(s.path))throw Error('invalid_source_input');if(!approvedPaths.includes(s.path))throw Error('unapproved_source_input');paths.add(s.path);}
 for(const p of ['package.json','package-lock.json','apps/portal-web/vite.config.ts','apps/portal-web/src/games/cooking/dish-stage.ts','apps/portal-web/src/games/party/stage.ts','apps/portal-web/src/games/party/domain.ts','apps/portal-web/src/games/party/tofu-batch.ts'])if(!paths.has(p))throw Error('missing_source_input');return r;
}
export function validateApprovedRequestBytes(raw){
 if(hash(raw)!==approvedRequestDigest)throw Error('unapproved_request_bytes');return validateRequest(JSON.parse(raw));
}
export function verifySourceBytes(s,approved,current){
 if(hash(approved)!==s.sha256)throw Error('request_not_bound_to_approved_source:'+s.path);
 if(hash(current)!==s.sha256)throw Error('capture_source_drift:'+s.path);
}
export function admitTransition({attempt,action,before,parent,sourceParent,parentCount,sourceParentCount,sourceRequestDigest,previousRequestDigest,changed}){
 if(attempt!=='1'||action!=='synchronize'||before!==approvedPreviousHead)return false;
 if(parent!==approvedSource||sourceParent!==approvedPreviousHead||parentCount!==1||sourceParentCount!==1)throw Error('capture_transition_parent');
 if(sourceRequestDigest!==approvedPreviousRequestDigest)throw Error('source_commit_request_changed');
 if(previousRequestDigest!==approvedPreviousRequestDigest)throw Error('unexpected_previous_request');return changed===true;
}
async function verify(root){
 const raw=await readFile(resolve(root,requestPath));const r=validateApprovedRequestBytes(raw);
 if(!/^[a-f0-9]{40}$/.test(process.env.EXPECTED_HEAD??'')||git('rev-parse','HEAD')!==process.env.EXPECTED_HEAD||git('status','--porcelain','--untracked-files=no'))throw Error('unclean_or_wrong_head');
 for(const s of r.source_inputs){const approvedBytes=execFileSync('git',['show',`${approvedSource}:${s.path}`]);const bytes=await readFile(resolve(root,s.path));verifySourceBytes(s,approvedBytes,bytes);}
 return r;
}
export async function boundEvidence(root,maxBytes=268435456){
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>268435456)throw Error('invalid_evidence_budget');
 let bytes=0,entries=0;
 async function walk(path,depth){
  if(++entries>10000||depth>20)throw Error('evidence_entry_budget');
  const info=await lstat(path);if(info.isSymbolicLink())throw Error('evidence_symlink');
  if(info.isDirectory()){for(const name of await readdir(path))await walk(resolve(path,name),depth+1);}
  else if(info.isFile()){bytes+=info.size;if(!Number.isSafeInteger(bytes)||bytes>maxBytes)throw Error('evidence_byte_budget');}
  else throw Error('evidence_nonregular');
 }
 const rootInfo=await lstat(root);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw Error('evidence_root');
 await walk(root,0);return {bytes,entries};
}
export async function preserveFailedRegression(root,source){
 try{await lstat(root);return false;}catch(e){if(e.code!=='ENOENT')throw e;}
 let info;try{info=await lstat(source);}catch(e){if(e.code==='ENOENT')return false;throw e;}
 if(info.isSymbolicLink()||!info.isFile()||info.size>8388608)throw Error('unsafe_regression_receipt');
 const handle=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes;
 try{const current=await handle.stat();if(!current.isFile()||current.ino!==info.ino||current.dev!==info.dev||current.size!==info.size)throw Error('regression_receipt_changed');bytes=await handle.readFile();if(bytes.length!==info.size)throw Error('regression_receipt_changed');}finally{await handle.close();}
 // A fresh evidence root only. Never adopt an existing directory for this copy.
 await mkdir(root);await writeFile(resolve(root,'bundle-regression.json'),bytes,{flag:'wx'});return true;
}
async function main(){
 const root=process.cwd(),mode=process.argv[2];
 if(mode==='evidence'){if(!process.env.RUNNER_TEMP||!process.env.GITHUB_OUTPUT)throw Error('hosted_evidence_required');const evidence=resolve(process.env.RUNNER_TEMP,'native-game-previews');await preserveFailedRegression(evidence,resolve(process.env.RUNNER_TEMP,'native-cooking-bundle-regression.json'));console.log(JSON.stringify(await boundEvidence(evidence)));await writeFile(process.env.GITHUB_OUTPUT,'bounded=true\n',{flag:'a'});return;}
 if(mode==='admit'){
  let capture=false;
  if(process.env.GITHUB_RUN_ATTEMPT==='1'&&process.env.EVENT_ACTION==='synchronize'&&process.env.PREVIOUS_HEAD===approvedPreviousHead){
   // One reviewed two-commit transition; source A then request B, one ref CAS.
   const parent=git('rev-parse','HEAD^1');
   const sourceParent=git('rev-parse',`${approvedSource}^1`),parentCount=git('show','-s','--format=%P','HEAD').split(' ').length,sourceParentCount=git('show','-s','--format=%P',approvedSource).split(' ').length;
   const sourceRequestDigest=hash(execFileSync('git',['show',`${approvedSource}:${requestPath}`]));
   const previousRequestDigest=hash(execFileSync('git',['show',`${approvedPreviousHead}:${requestPath}`]));
   capture=admitTransition({attempt:process.env.GITHUB_RUN_ATTEMPT,action:process.env.EVENT_ACTION,before:process.env.PREVIOUS_HEAD,parent,sourceParent,parentCount,sourceParentCount,sourceRequestDigest,previousRequestDigest,changed:git('diff','--name-only',approvedPreviousHead,'HEAD','--',requestPath)===requestPath});
  }
  if(capture)await verify(root);
  if(!process.env.GITHUB_OUTPUT)throw Error('github_output_required');
  await writeFile(process.env.GITHUB_OUTPUT,`capture=${capture}\n`,{flag:'a'});return;
 }
 if(mode!=='capture')throw Error('usage: capture-ci.mjs admit|capture');
 const r=await verify(root);if(!process.env.RUNNER_TEMP||process.env.GITHUB_RUN_ATTEMPT!=='1')throw Error('hosted_attempt_required');
 const out=resolve(process.env.RUNNER_TEMP,'native-game-previews');await mkdir(out);
 await writeFile(resolve(out,'bundle-regression.json'),await readFile(resolve(process.env.RUNNER_TEMP,'native-cooking-bundle-regression.json')),{flag:'wx'});
 const receipt={format:'freedom.native-capture-run/v1',request:r,head_sha:git('rev-parse','HEAD'),workflow_sha:process.env.WORKFLOW_SHA,run_id:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,status:'failed',families:{},errors:[]};
 try{
  const {chromium}=await import('playwright');
  const cooking=await import('./native-previews.mjs');
  const party=await import('./native-party-previews.mjs');
  for(const [name,tool]of [['cooking',cooking],['party',party]])try{receipt.families[name]=await tool.capture(root,resolve(out,name),chromium.executablePath());}catch(e){receipt.errors.push(name+': '+String(e));}
  await verify(root);if(receipt.errors.length)throw Error('native_family_failed');
  receipt.status='captured_pending_visual_review';
 }catch(e){receipt.errors.push(String(e));throw e;}
 finally{await writeFile(resolve(out,'run-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
