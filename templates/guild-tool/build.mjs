import './check.mjs';
import {mkdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
mkdirSync('dist',{recursive:true});for(const f of ['index.html','main.js','bridge.js','style.css','freedom-tool.json','_headers'])copyFileSync(f,'dist/'+f);

// A local origin can be added only to this generated test build, never to the source allowlist.
const args=process.argv.slice(2);
if(args.length){
 if(args.length!==2||args[0]!=='--test-platform-origin'||!/^http:\/\/127\.0\.0\.1:[0-9]{4,5}$/.test(args[1])||new URL(args[1]).origin!==args[1])throw Error('Invalid test platform origin');
 const path='dist/main.js',marker='export const PLATFORM_ORIGINS=Object.freeze([';
 const main=readFileSync(path,'utf8');if(!main.includes(marker))throw Error('Platform origin list missing');
 writeFileSync(path,main.replace(marker,marker+'\n '+JSON.stringify(args[1])+','));
}
