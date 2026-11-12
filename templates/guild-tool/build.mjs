import './check.mjs';
import {mkdirSync,copyFileSync} from 'node:fs';
mkdirSync('dist',{recursive:true});for(const f of ['index.html','main.js','bridge.js','style.css','freedom-tool.json'])copyFileSync(f,'dist/'+f);
