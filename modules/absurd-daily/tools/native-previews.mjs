/** Operator tool, not CI admission. No browser/server/write in default plan mode. */
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {resolve,relative,dirname,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';

export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const manifestPath='modules/absurd-daily/cooking-3d-art.json';
const factoryPath='apps/portal-web/src/games/cooking/dish-stage.ts';
const hashPattern=/^[a-f0-9]{64}$/;
export function safeRelative(path){
 if(typeof path!=='string'||!path||path.includes('\\')||isAbsolute(path)||path.split('/').some(p=>!p||p==='.'||p==='..')||path.includes('\0'))throw Error('unsafe_relative_path');
 return path;
}
export async function regularFile(root,path){
 safeRelative(path);const file=resolve(root,path);
 for(let p=file;p!==root;p=dirname(p)){if((await lstat(p)).isSymbolicLink())throw Error('symlink_input');}
 if(!(await lstat(file)).isFile())throw Error('not_regular_file');
 return readFile(file);
}
export async function freshOutput(root,out){
 if(!isAbsolute(out))throw Error('absolute_output_required');
 const target=resolve(out),parent=dirname(target);
 if(target===root||target.startsWith(root+sep)||await realpath(parent)!==parent)throw Error('unsafe_output_directory');
 // Atomic mkdir, no recursive overwrite and no adoption of an existing directory.
 await mkdir(target);return target;
}
export async function plan(root=defaultRoot){
 root=await realpath(root);
 const historical=JSON.parse(await regularFile(root,manifestPath));
 const recipes=historical.previews.map(p=>p.recipe);
 if(recipes.length!==66||new Set(recipes).size!==66||recipes.some(id=>!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)))throw Error('recipe_set');
 const paths=[...new Set([...historical.source_inputs.map(s=>s.path),factoryPath,'apps/portal-web/src/games/cooking/catalog.ts','apps/portal-web/vite.config.ts','modules/absurd-daily/tools/native-previews.mjs','package.json','package-lock.json'])];
 const source_inputs=await Promise.all(paths.map(async path=>({path,sha256:digest(await regularFile(root,path))})));
 return {format:'freedom.native-preview-plan/v1',mode:'dry-plan',root,recipes,source_inputs,
  scope:'66 catalog previews; not full build, gameplay, native performance acceptance or deployment',
  requires:['explicit native execution permission','installed Vite, Playwright, sharp and Chromium','loopback socket capability'],
  output_policy:'new directory outside repository; candidate manifest only after complete validation; never updates product assets'};
}
export function validateCapture(receipt,expected){
 if(receipt.status!=='captured'||receipt.errors.length||!receipt.environment?.browser||!receipt.environment?.renderer||receipt.environment.dpr!==1)throw Error('native_capture_incomplete');
 if(receipt.source_inputs.length!==expected.source_inputs.length||receipt.source_inputs.some((s,i)=>s.path!==expected.source_inputs[i].path||s.sha256!==expected.source_inputs[i].sha256))throw Error('source_drift');
 const ids=new Set(expected.recipes);
 if(receipt.previews.length!==66||ids.size!==66||new Set(receipt.previews.map(p=>p.recipe)).size!==66)throw Error('recipe_set');
 let bytes=0;
 for(const p of receipt.previews){
  if(!ids.has(p.recipe)||p.path!==`apps/portal-web/public/games/absurd-daily/cooking/3d/${p.recipe}.webp`||p.width!==512||p.height!==384||!Number.isSafeInteger(p.bytes)||p.bytes<=0||!hashPattern.test(p.sha256)||!hashPattern.test(p.source_png_sha256))throw Error('invalid_preview');
  if(!p.native||!Number.isSafeInteger(p.native.calls)||p.native.calls<=0||p.native.calls>100||!Number.isSafeInteger(p.native.geometries)||p.native.geometries<0||p.native.geometries>=100||!Number.isSafeInteger(p.native.triangles)||p.native.triangles<0||!Number.isSafeInteger(p.native.textures)||p.native.textures<0||p.canvas_after_dispose!==0)throw Error('native_budget_or_cleanup');
  bytes+=p.bytes;
 }
 if(bytes!==receipt.total_bytes||bytes>2.5*1024*1024)throw Error('total_bytes');
 const meta=receipt.build;
 if(!meta?.factory||!meta.chunks?.length||!meta.inputs?.length)throw Error('build_metadata_missing');
 const chunks=new Map(meta.chunks.map(c=>[safeRelative(c.file),c]));
 if(chunks.size!==meta.chunks.length||!chunks.has(meta.factory)||chunks.get(meta.factory).modules.indexOf(factoryPath)<0)throw Error('factory_binding');
 for(const c of chunks.values())if(!hashPattern.test(c.sha256)||c.imports.some(i=>!chunks.has(i)))throw Error('emitted_closure');
 for(const i of meta.inputs)if(!hashPattern.test(i.sha256)||!safeRelative(i.path))throw Error('input_binding');
 return true;
}
export async function validateFiles(root,out,receipt,expected,sharp){
 validateCapture(receipt,expected);
 for(const s of receipt.source_inputs.concat(receipt.build.inputs))if(digest(await regularFile(root,s.path))!==s.sha256)throw Error('source_drift');
 for(const c of receipt.build.chunks)if(digest(await regularFile(out,'portal/'+c.file))!==c.sha256)throw Error('compiled_drift');
 for(const p of receipt.previews){
  const png=await regularFile(out,p.recipe+'.png'),webp=await regularFile(out,p.recipe+'.webp');
  const pm=await sharp(png).metadata(),wm=await sharp(webp).metadata();
  if(digest(png)!==p.source_png_sha256||digest(webp)!==p.sha256||webp.length!==p.bytes||pm.format!=='png'||pm.width!==640||pm.height!==480||wm.format!=='webp'||wm.width!==512||wm.height!==384)throw Error('output_bytes_or_dimensions');
 }
}

export async function capture(root,out,executable){
 const expected=await plan(root);root=expected.root;
 if(!executable||!isAbsolute(executable)||!(await lstat(executable)).isFile())throw Error('explicit_installed_browser_required');
 out=await freshOutput(root,out);
 const require=createRequire(resolve(root,'package.json'));
 const receipt={format:'freedom.native-preview-receipt/v1',status:'failed',created_at:new Date().toISOString(),source_inputs:expected.source_inputs,previews:[],errors:[],total_bytes:0};
 let browser,server;
 try{
  // Only installed modules; no package manager, installer, API or database server.
  const {build}=await import(require.resolve('vite')),sharp=require('sharp'),{chromium}=require('playwright');
  const inputs=new Map(),transformed=new Map();
  const built=await build({configFile:resolve(root,'apps/portal-web/vite.config.ts'),build:{write:false},plugins:[{
   name:'native-preview-input-receipt',enforce:'pre',async transform(code,id){
    if(id.startsWith('\0'))return;
    const file=id.split('?')[0];if(!isAbsolute(file))return;
    const path=relative(root,file).split(sep).join('/');safeRelative(path);
    inputs.set(path,{path,sha256:digest(await regularFile(root,path))});transformed.set(id,{id:relative(root,file).split(sep).join('/')+id.slice(file.length),transform_sha256:digest(code)});
   }
  }]});
  const outputs=(Array.isArray(built)?built:[built]).flatMap(b=>b.output),chunks=outputs.filter(o=>o.type==='chunk');
  const factory=chunks.filter(c=>Object.keys(c.modules).some(id=>id.split('?')[0]===resolve(root,factoryPath)));
  if(factory.length!==1||!factory[0].exports.includes('createDishStage'))throw Error('factory_export_not_identified');
  await mkdir(resolve(out,'portal'));
  for(const c of chunks){safeRelative(c.fileName);await mkdir(dirname(resolve(out,'portal',c.fileName)),{recursive:true});await writeFile(resolve(out,'portal',c.fileName),c.code,{flag:'wx'});}
  receipt.build={node:process.version,vite:require('vite/package.json').version,kind:'Vite production portal compilation; skill-client packaging not run',factory:factory[0].fileName,inputs:[...inputs.values()],transforms:[...transformed.values()],chunks:chunks.map(c=>({file:c.fileName,sha256:digest(c.code),imports:[...c.imports,...c.dynamicImports],modules:Object.keys(c.modules).map(id=>id.startsWith('\0')?id:relative(root,id).split(sep).join('/'))}))};
  // Keep exactly emitted module metadata, including synthetic IDs. Raw file
  // hashes cover observed file-backed transform inputs, not a claimed universal closure.
  await writeFile(resolve(out,'build-metadata.json'),JSON.stringify(receipt.build,null,2)+'\n',{flag:'wx'});
  const served=new Map(chunks.map(c=>['/'+c.fileName,c.code]));
  server=createServer((req,res)=>{
   const path=new URL(req.url,'http://127.0.0.1').pathname;
   if(path==='/capture.html'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><meta charset="utf-8"><div id="host"></div>');}
   if(!served.has(path)){res.statusCode=404;return res.end();}
   res.setHeader('Content-Type','text/javascript');res.end(served.get(path));
  });
  await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:executable,headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>receipt.errors.push(String(e)));page.on('requestfailed',r=>receipt.errors.push('request_failed: '+new URL(r.url()).pathname));page.on('response',r=>{if(r.status()!==200)receipt.errors.push('http_'+r.status());});
  await page.goto(origin+'/capture.html');
  for(const recipe of expected.recipes){
   let timer;let result;try{result=await Promise.race([page.evaluate(async({factory,recipe})=>{
    const t=performance.now(),{createDishStage}=await import('/'+factory),imported=performance.now();
    const host=document.getElementById('host');let stage,result,lost=false;
    try{
     stage=createDishStage(host,recipe,()=>{lost=true;});const constructed=performance.now(),png=stage.capture(),captured=performance.now(),canvas=host.querySelector('canvas'),gl=canvas.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info');
     result={png,native:stage.stats(),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER),lost,timing_ms:{import:imported-t,construct:constructed-imported,capture:captured-constructed}};
    }finally{stage?.dispose();}
    return {...result,canvas_after_dispose:host.querySelectorAll('canvas').length};
   },{factory:receipt.build.factory,recipe}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('native_recipe_deadline')),60000);})]);}finally{clearTimeout(timer);}
   if(result.lost||receipt.errors.length)throw Error('native_browser_failure');
   if(receipt.environment&&receipt.environment.renderer!==result.renderer)throw Error('renderer_changed');
   receipt.environment={browser:browser.version(),renderer:result.renderer,viewport:[1280,900],dpr:1};
   const png=Buffer.from(result.png.split(',')[1],'base64'),webp=await sharp(png).resize(512,384).webp({quality:82}).toBuffer();
   await writeFile(resolve(out,recipe+'.png'),png,{flag:'wx'});await writeFile(resolve(out,recipe+'.webp'),webp,{flag:'wx'});
   receipt.previews.push({recipe,path:`apps/portal-web/public/games/absurd-daily/cooking/3d/${recipe}.webp`,width:512,height:384,bytes:webp.length,sha256:digest(webp),source_png_sha256:digest(png),native:result.native,canvas_after_dispose:result.canvas_after_dispose,timing_ms:result.timing_ms});
  }
  // Finalize owned native resources before producing any successful candidate.
  await browser.close();browser=null;
  await new Promise((ok,no)=>server.close(error=>error?no(error):ok()));server=null;
  receipt.total_bytes=receipt.previews.reduce((n,p)=>n+p.bytes,0);receipt.status='captured';
  await validateFiles(root,out,receipt,expected,sharp);
  const manifest={format:'freedom.cooking-3d-art/v1',created_at:receipt.created_at,origin:'original procedural 3D models; actual production createDishStage factory',environment:receipt.environment,compiled_factory:{file:receipt.build.factory.split('/').at(-1),sha256:receipt.build.chunks.find(c=>c.file===receipt.build.factory).sha256},source_inputs:receipt.source_inputs,total_bytes:receipt.total_bytes,previews:receipt.previews};
  await writeFile(resolve(out,'candidate-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  receipt.status='captured_pending_visual_review';
 }catch(error){receipt.status='failed';receipt.errors.push(String(error));throw error;}
 finally{
  try{await browser?.close();}finally{if(server)await new Promise(ok=>server.close(ok));await writeFile(resolve(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});}
 }
 return receipt;
}
async function main(){
 const args=process.argv.slice(2);
 if(!args.length||args[0]==='plan'&&args.length===1){console.log(JSON.stringify(await plan(),null,2));return;}
 if(args[0]==='capture'&&args.length===3){console.log(JSON.stringify(await capture(defaultRoot,args[1],args[2]),null,2));return;}
 throw Error('Usage: node modules/absurd-daily/tools/native-previews.mjs [plan | capture NEW_OUTPUT_ABSOLUTE INSTALLED_CHROMIUM_ABSOLUTE]');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e);process.exitCode=1;});
