import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import ts from '@typescript/typescript6';
import config from '../../apps/portal-web/vite.config.js';

const root=fileURLToPath(new URL('../../',import.meta.url)),appRoot=resolve(root,'apps/portal-web');
const entries={
  index:['src/main.tsx','./zod-csp'],
  journal:['src/journal/main.tsx',null],
  'skill-social':['src/skill-social.tsx',{lazy:'src/skill-social-widget.tsx',initializer:'./zod-csp'}],
  storefront:['src/storefront/main.tsx','../zod-csp.js'],
  'storefront-gallery':['src/storefront/gallery.ts',null],
  'storefront-variants':['src/storefront/variants.ts',null],
} as const;

function importsOf(path:string,source=readFileSync(path,'utf8')){
  return ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true).statements.filter(ts.isImportDeclaration);
}
function assertInitializer(path:string,initializer:string,source=readFileSync(path,'utf8')){
  const imports=importsOf(path,source);
  assert.equal((imports[0]?.moduleSpecifier as ts.StringLiteral)?.text,initializer,path);
  assert.equal(imports[0].importClause,undefined,'initializer must be a side-effect import');
  assert.equal(resolve(dirname(path),initializer.replace(/\.js$/,'')),resolve(appRoot,'src/zod-csp'));
}
function assertLazyBoundary(path:string,lazy:string,source=readFileSync(path,'utf8')){
  const parsed=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
  assert.equal(importsOf(path,source).length,0,'the public reading entry must not eagerly import heavy dependencies');
  const dynamic:ts.CallExpression[]=[];
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)dynamic.push(node);ts.forEachChild(node,visit);};visit(parsed);
  assert.equal(dynamic.length,1,'every deferred boundary must be classified');
  assert.ok(dynamic[0].arguments.length===1&&ts.isStringLiteral(dynamic[0].arguments[0]),'the lazy target must be statically auditable');
  assert.equal(resolve(dirname(path),dynamic[0].arguments[0].text+'.tsx'),resolve(appRoot,lazy));
}

test('every production input is classified and static or deferred Zod entries import CSP config first',async()=>{
  const inputs=config.build!.rolldownOptions!.input as Record<string,string>;
  assert.deepEqual(Object.keys(inputs).sort(),Object.keys(entries).sort());
  const html=readFileSync(resolve(appRoot,'index.html'),'utf8');
  assert.match(html,/<script type="module" src="\/src\/main\.tsx"><\/script>/);
  for(const [name,[entry,initializer]] of Object.entries(entries)){
    assert.equal(relative(appRoot,inputs[name]),name==='index'?'index.html':entry);
    const path=resolve(appRoot,entry);
    if(typeof initializer==='string')assertInitializer(path,initializer);
    else if(initializer){assertLazyBoundary(path,initializer.lazy);assertInitializer(resolve(appRoot,initializer.lazy),initializer.initializer);}
    const result=await build({entryPoints:[path],absWorkingDir:root,bundle:true,write:false,metafile:true,loader:{'.css':'empty'},external:['*.webp','*.png','*.svg','*.woff2'],logLevel:'silent'});
    const graph=result.metafile!.inputs,hasZod=(paths:Iterable<string>)=>[...paths].some(path=>path.startsWith('node_modules/zod/'));
    const staticReach=(start:string)=>{
      const seen=new Set<string>();const visit=(path:string)=>{if(seen.has(path))return;assert.ok(graph[path],`Missing graph input ${path}`);seen.add(path);
        for(const edge of graph[path].imports)if(!edge.external&&edge.kind!=='dynamic-import')visit(edge.path);};visit(start);return seen;
    };
    assert.equal(hasZod(Object.keys(graph)),initializer!==null,entry);
    const eager=staticReach(relative(root,path));
    if(initializer&&typeof initializer==='object'){
      assert.deepEqual([...eager],[relative(root,path)],'the light entry has no static runtime dependency, including Zod/React');
      const deferred=staticReach(relative(root,resolve(appRoot,initializer.lazy)));
      assert.ok(hasZod(deferred),'the widget still carries the real Zod dependency');
      assert.ok(deferred.has('apps/portal-web/src/zod-csp.ts'),'the deferred graph must initialize CSP');
    }else assert.equal(hasZod(eager),initializer!==null,entry);
  }
  const source=ts.createSourceFile('zod-csp.ts',readFileSync(resolve(appRoot,'src/zod-csp.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  assert.deepEqual(source.statements.filter(ts.isImportDeclaration).map(statement=>(statement.moduleSpecifier as ts.StringLiteral).text),['zod']);
});

test('lazy boundary guard rejects an eager dependency and a missing, moved or bound CSP initializer',()=>{
  const [entry,definition]=entries['skill-social'],path=resolve(appRoot,entry),widget=resolve(appRoot,definition.lazy);
  const light=readFileSync(path,'utf8'),heavy=readFileSync(widget,'utf8');
  assert.throws(()=>assertLazyBoundary(path,definition.lazy,`import './zod-csp';\n${light}`));
  assert.throws(()=>assertLazyBoundary(path,definition.lazy,light.replace("import('./skill-social-widget')","import('./other-widget')")));
  const statement="import './zod-csp';";assert.ok(heavy.startsWith(statement));
  assert.throws(()=>assertInitializer(widget,definition.initializer,heavy.replace(statement,'')));
  assert.throws(()=>assertInitializer(widget,definition.initializer,heavy.replace(statement,'')+'\n'+statement));
  assert.throws(()=>assertInitializer(widget,definition.initializer,heavy.replace(statement,"import * as ignored from './zod-csp';")));
});

for(const configured of [true,false])test(configured?'jitless skips the eval probe':'negative control observes the eval probe without config',()=>{
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',`
    import assert from 'node:assert/strict';
    let calls=0;
    globalThis.Function=new Proxy(globalThis.Function,{
      apply(target,receiver,args){calls++;return Reflect.apply(target,receiver,args);},
      construct(target,args,newTarget){calls++;return Reflect.construct(target,args,newTarget);},
    });
    ${configured?`await import(${JSON.stringify(new URL('../../apps/portal-web/src/zod-csp.ts',import.meta.url).href)});`:''}
    const {z}=await import('zod');
    const schema=z.object({name:z.string(),count:z.number().int()});
    assert.deepEqual(schema.parse({name:'CSP',count:1}),{name:'CSP',count:1});
    assert.equal(schema.safeParse({name:'CSP',count:'invalid'}).success,false);
    console.log(JSON.stringify({configured:${configured},calls}));
    ${configured?'assert.equal(calls,0);':'assert.ok(calls>=1);'}
  `],{cwd:root,encoding:'utf8',timeout:30_000});
  assert.equal(result.status,0,result.stderr||String(result.error));
  const observed=JSON.parse(result.stdout);
  assert.equal(observed.configured,configured);
  if(configured)assert.equal(observed.calls,0);else assert.ok(observed.calls>=1);
  console.log(result.stdout.trim());
});

// Run the built, unchanged production entry and its real dynamic chunks in a
// fresh restricted VM. This models forbidden string compilation, not browser
// CSP event delivery or rendering. CI builds the portal before runtime tests.
const productionProbe=`import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const root=process.argv[1];
const assets=path.join(root,'apps/portal-web/dist/assets');
const files=fs.readdirSync(assets);
const findChunk=prefix=>{const matches=files.filter(f=>new RegExp(\`^\${prefix}-[A-Za-z0-9_-]+\\\\.js$\`).test(f));assert.equal(matches.length,1,\`\${prefix}: \${matches}\`);return matches[0];};
const initializer=findChunk('zod-csp'),widget=findChunk('skill-social-widget'),schemas=findChunk('schemas');
const hashes=new Map();
const clean=value=>JSON.parse(JSON.stringify(value));
const validFields=[{path:'payment.account_name',code:'required'}];
const problem=fields=>({type:'urn:fixture:offline-settings-invalid',title:'Synthetic invalid settings',status:422,code:'offline_settings_invalid',fields});
const results=[];

for(const configured of [true,false]){
  const requests=[],preloads=[],events=[],modules=new Map(),dynamicLoads=[];
  const listeners=new Map();
  let observerCallback,activeFields=validFields;
  const card={dataset:{skillSocial:'csp-fixture',repository:'https://github.com/example/synthetic-repository'},isConnected:true,contains:()=>false,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n)=>listeners.delete(n)};
  const document={visibilityState:'visible',activeElement:null,querySelectorAll:selector=>selector==='[data-skill-social]'?[card]:[],querySelector:()=>null,getElementsByTagName:tag=>tag==='link'?preloads:[],createElement:tag=>({tagName:tag.toUpperCase(),style:{},setAttribute(){},removeAttribute(){},addEventListener(){},removeEventListener(){},appendChild(){}}),head:{appendChild:el=>preloads.push(el)},documentElement:{style:{}},addEventListener(){},removeEventListener(){}};
  const sandbox={console,URL,Headers,Response,AbortController,AbortSignal,setTimeout,clearTimeout,queueMicrotask,performance,TextEncoder,TextDecoder,document,navigator:{userAgent:'Node VM fixture'},Event,IntersectionObserver:class{constructor(cb){observerCallback=cb;}observe(){}unobserve(){}disconnect(){}},fetch:async(url,options)=>{assert.equal(url,'/api/v1/session');assert.equal(options.method,'GET');requests.push({url,method:options.method,fields:clean(activeFields)});return new Response(JSON.stringify(problem(activeFields)),{status:422,headers:{'Content-Type':'application/problem+json'}});},addEventListener(){},removeEventListener(){},dispatchEvent:event=>{events.push({type:event.type,error:event.payload?.message});return true;}};
  const context=vm.createContext(sandbox,{codeGeneration:{strings:false,wasm:false},name:configured?'production-configured':'negative-jitless-disabled'});
  vm.runInContext(\`globalThis.window=globalThis;globalThis.__functionCalls=[];globalThis.Function=new Proxy(Function,{apply(target,receiver,args){__functionCalls.push({kind:'apply',args,stack:new Error().stack});return Reflect.apply(target,receiver,args);},construct(target,args,newTarget){__functionCalls.push({kind:'construct',args,stack:new Error().stack});return Reflect.construct(target,args,newTarget);}});\`,context);
  const denial=vm.runInContext(\`(()=>{try{(()=>{}).constructor('return 1')();return 'not_blocked';}catch(error){return error.name+': '+error.message;}})()\`,context);
  assert.match(denial,/EvalError: Code generation from strings disallowed/);
  assert.equal(context.__functionCalls.length,0,'policy self-check must not consume instrumentation');
  function resolveSpecifier(specifier,referencing){assert.ok(specifier.startsWith('./'),\`Unexpected specifier \${specifier}\`);const resolved=path.resolve(path.dirname(referencing.identifier),specifier);assert.equal(path.dirname(resolved),assets);return resolved;}
  function getModule(filename){const abs=path.resolve(assets,filename);assert.equal(path.dirname(abs),assets);if(modules.has(abs))return modules.get(abs);const source=fs.readFileSync(abs,'utf8');hashes.set(path.basename(abs),{bytes:Buffer.byteLength(source),sha256:createHash('sha256').update(source).digest('hex')});const mod=new vm.SourceTextModule(source,{context,identifier:abs,initializeImportMeta(meta){meta.url=\`https://fixture.invalid/assets/\${path.basename(abs)}\`;},importModuleDynamically:async(specifier,referencing)=>{const loaded=getModule(resolveSpecifier(specifier,referencing));const operation=(async()=>{if(loaded.status==='unlinked')await loaded.link(linker);if(loaded.status==='linked')await loaded.evaluate();assert.equal(loaded.status,'evaluated');return loaded;})();dynamicLoads.push(operation);return operation;}});modules.set(abs,mod);return mod;}
  function linker(specifier,referencing){return getModule(resolveSpecifier(specifier,referencing));}
  async function evaluate(filename){const mod=getModule(filename);if(mod.status==='unlinked')await mod.link(linker);if(mod.status==='linked')await mod.evaluate();return mod;}
  if(!configured){await evaluate(initializer);assert.equal(context.__zod_globalConfig.jitless,true);context.__zod_globalConfig.jitless=false;}
  const beforeEntry=[...modules.keys()];
  await evaluate('skill-social.js');
  assert.equal(dynamicLoads.length,0,'entry must remain lazy before visibility trigger');
  assert.equal(context.__functionCalls.length,0,'entry must not attempt Function');
  assert.ok(!modules.has(path.join(assets,schemas)),'schemas must remain unloaded before visibility trigger');
  const entryOnly=[...modules.keys()].filter(f=>!beforeEntry.includes(f)).map(f=>path.basename(f));
  assert.ok(observerCallback,'fixture must reach actual IntersectionObserver registration');
  observerCallback([{target:card,isIntersecting:true}]);
  const deadline=Date.now()+5000;
  while(requests.length===0&&Date.now()<deadline)await delay(1);
  await Promise.all(dynamicLoads);
  assert.equal(events.length,0,JSON.stringify(events));
  assert.equal(requests.length,1,'lazy widget must reach actual session request');
  await delay(0); // Flush response/body continuation before directly exercising the same exported API.
  assert.equal(modules.get(path.join(assets,widget)).status,'evaluated');
  assert.equal(modules.get(path.join(assets,schemas)).status,'evaluated');
  const callsAfterWidget=context.__functionCalls.length;
  const clients=[];
  for(const [file,mod]of modules)for(const [exportName,value]of Object.entries(mod.namespace))if(typeof value==='function'&&['get','post','patch','put','delete','getSession'].every(key=>typeof value.prototype?.[key]==='function'))clients.push({file:path.basename(file),exportName,ctor:value});
  assert.equal(clients.length,1,'identify PortalClient by its public API, never a fixed minified alias');
  const client=new clients[0].ctor();
  assert.equal(client.csrfToken,null);
  async function requestFields(fields){activeFields=fields;let error;try{await client.get('/session',{skipAuthHandler:true,background:true,suppressConsole:true});}catch(e){error=e;}assert.ok(error);assert.equal(error.name,'ApiError');assert.equal(error.status,422);assert.equal(error.code,'offline_settings_invalid');assert.equal(error.network,false);assert.equal(error.definitiveResponse,true);return error.errors===undefined?undefined:clean(error.errors);}
  assert.deepEqual(await requestFields(validFields),validFields,'valid fields must survive real schema parse');
  const invalids=[[],[{path:'payment.account_name',code:'not_a_contract_code'}],[{path:'payment account',code:'required'}],[{path:'payment.account_name',code:'required',extra:true}],Array.from({length:21},()=>validFields[0])];
  for(const fields of invalids)assert.equal(await requestFields(fields),undefined,'malformed fields must be rejected by production schema');
  if(configured)assert.equal(context.__functionCalls.length,0,'configured full lazy graph must never attempt Function');
  else{assert.ok(context.__functionCalls.length>=1,'negative control must detect Function probe');assert.ok(context.__functionCalls.some(call=>call.stack.includes(initializer)));}
  results.push({configured,vmStringCodeGenerationBlocked:denial,entryOnly,lazyTarget:widget,evaluatedModules:[...modules].filter(([,m])=>m.status==='evaluated').map(([f])=>path.basename(f)),sessionRequests:requests.length,validSchemaResult:validFields,invalidCasesRejected:invalids.length,callsAfterWidget,functionCalls:context.__functionCalls.length,functionProbeLocations:context.__functionCalls.map(c=>({kind:c.kind,args:c.args,stack:c.stack.split('\\n').slice(0,4)})),apiExport:{chunk:clients[0].file,identifiedByPublicMethods:true,observedMinifiedExport:clients[0].exportName},preloads:preloads.map(l=>({rel:l.rel,href:l.href})),limitations:['Node VM codeGeneration restriction, not browser CSP or securitypolicyviolation evidence.','Synthetic DOM and Response fixtures; no browser render, authentication, network, database, deployment or real user data.','Negative control changes only fresh VM runtime jitless flag after evaluating initializer; production bundle bytes are unchanged.']});
}
for(const [name,before]of hashes){const bytes=fs.readFileSync(path.join(assets,name));assert.equal(createHash('sha256').update(bytes).digest('hex'),before.sha256,'production artifact changed during probe');}
console.log(JSON.stringify({node:process.version,assets,artifactHashes:Object.fromEntries(hashes),results},null,2));
`;
test('production lazy chunks parse real fields without string compilation; an unconfigured control detects the probe',()=>{
  const result=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',productionProbe,root],{cwd:root,encoding:'utf8',timeout:30_000});
  assert.equal(result.status,0,result.stderr||String(result.error));
  const report=JSON.parse(result.stdout);
  assert.equal(report.results.length,2);
  const [configured,negative]=report.results;
  assert.equal(configured.configured,true);assert.equal(configured.functionCalls,0);
  assert.equal(negative.configured,false);assert.ok(negative.functionCalls>=1);
  for(const observation of report.results){assert.equal(observation.sessionRequests,7);assert.equal(observation.invalidCasesRejected,5);}
  console.log(JSON.stringify({production_vm:report.results.map((value:any)=>({configured:value.configured,functionCalls:value.functionCalls,invalidCasesRejected:value.invalidCasesRejected,sessionRequests:value.sessionRequests}))}));
});
