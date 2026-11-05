// CPU-only diagnostic. Never starts a browser or a server. No write build.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const root=resolve(process.argv[2]),out=resolve(process.argv[3]),require=createRequire(resolve(root,'package.json'));
const {build}=await import(require.resolve('vite'));const factory=resolve(root,'apps/portal-web/src/games/cooking/dish-stage.ts');
const base={configFile:resolve(root,'apps/portal-web/vite.config.ts'),build:{write:false},logLevel:'error'};
const summarize=r=>(Array.isArray(r)?r:[r]).flatMap(x=>x.output).filter(c=>c.type==='chunk'&&Object.keys(c.modules).includes(factory)).map(c=>({file:c.fileName,exports:c.exports,modules:Object.keys(c.modules)}));
const old=summarize(await build(base));
const fixed=summarize(await build({...base,build:{write:false,rolldownOptions:{input:'native-cooking-fixture',preserveEntrySignatures:'strict'}},plugins:[{name:'native-cooking-fixture',resolveId(id){if(id==='native-cooking-fixture')return '\0native-cooking-fixture';},load(id){if(id==='\0native-cooking-fixture')return `export {createDishStage} from ${JSON.stringify(factory)};`;}}]}));
const receipt={kind:'CPU bundle-export regression only; no native/browser execution',vite:require('vite/package.json').version,old,fixed};await writeFile(out,JSON.stringify(receipt,null,2));
// Keep the bounded export result in job logs even when an assertion fails before native capture.
console.log(JSON.stringify({kind:receipt.kind,vite:receipt.vite,old:old.map(c=>({file:c.file,exports:c.exports})),fixed:fixed.map(c=>({file:c.file,exports:c.exports}))}));
if(old.some(c=>c.exports.includes('createDishStage')))throw Error('old failure did not reproduce');
if(fixed.length!==1||!fixed[0].exports.includes('createDishStage'))throw Error('fixed export missing');console.log(JSON.stringify({vite:receipt.vite,oldFactoryChunks:old.length,fixedExports:fixed[0].exports}));
