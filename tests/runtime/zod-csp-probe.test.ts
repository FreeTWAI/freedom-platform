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
  'skill-social':['src/skill-social.tsx','./zod-csp'],
  storefront:['src/storefront/main.tsx','../zod-csp.js'],
  'storefront-gallery':['src/storefront/gallery.ts',null],
  'storefront-variants':['src/storefront/variants.ts',null],
} as const;

test('every production input is classified and Zod entries import CSP config first',async()=>{
  const inputs=config.build!.rolldownOptions!.input as Record<string,string>;
  assert.deepEqual(Object.keys(inputs).sort(),Object.keys(entries).sort());
  const html=readFileSync(resolve(appRoot,'index.html'),'utf8');
  assert.match(html,/<script type="module" src="\/src\/main\.tsx"><\/script>/);
  for(const [name,[entry,initializer]] of Object.entries(entries)){
    assert.equal(relative(appRoot,inputs[name]),name==='index'?'index.html':entry);
    const path=resolve(appRoot,entry),source=readFileSync(path,'utf8');
    const parsed=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
    const imports=parsed.statements.filter(ts.isImportDeclaration);
    if(initializer){
      assert.equal((imports[0]?.moduleSpecifier as ts.StringLiteral)?.text,initializer,entry);
      assert.equal(imports[0].importClause,undefined,'initializer must be a side-effect import');
      assert.equal(resolve(dirname(path),initializer.replace(/\.js$/,'')),resolve(appRoot,'src/zod-csp'));
    }
    const result=await build({entryPoints:[path],absWorkingDir:root,bundle:true,write:false,metafile:true,loader:{'.css':'empty'},external:['*.webp','*.png','*.svg','*.woff2'],logLevel:'silent'});
    assert.equal(Object.keys(result.metafile!.inputs).some(path=>path.startsWith('node_modules/zod/')),initializer!==null,entry);
  }
  const source=ts.createSourceFile('zod-csp.ts',readFileSync(resolve(appRoot,'src/zod-csp.ts'),'utf8'),ts.ScriptTarget.Latest,true);
  assert.deepEqual(source.statements.filter(ts.isImportDeclaration).map(statement=>(statement.moduleSpecifier as ts.StringLiteral).text),['zod']);
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
