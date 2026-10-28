import {readFile,lstat,realpath,mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep,join} from 'node:path';
import {createHash} from 'node:crypto';
const expected=new Set(['light','dark','versefolk'].flatMap(base=>[390,1280].flatMap(width=>['off-same-candidate','halloween','christmas','newyear'].map(season=>`${base}-${width}-${season}`))));
const root=resolve('seasonal-raw'),out=resolve('seasonal-evidence');
const report=JSON.parse(await readFile('seasonal-report.json','utf8'));
if((report.errors??[]).length)throw Error('capture_global_error');
const found=[];
function visit(suite){for(const spec of suite.specs??[])for(const test of spec.tests??[]){if(test.status!=='expected'||test.results?.length!==1||test.results[0].status!=='passed')throw Error('capture_test_not_passed');for(const a of test.results[0].attachments??[])if(expected.has(a.name))found.push(a);}for(const child of suite.suites??[])visit(child);}
for(const suite of report.suites??[])visit(suite);
if(found.length!==24||new Set(found.map(a=>a.name)).size!==24)throw Error('capture_count_mismatch');
await mkdir(out,{recursive:false});let total=0;const files=[];
for(const a of found){
 if(a.contentType!=='image/png'||typeof a.path!=='string')throw Error('capture_not_png');
 const path=resolve(a.path);if(!path.startsWith(root+sep)||await realpath(path)!==path)throw Error('capture_path_invalid');
 const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw Error('capture_file_invalid');
 const bytes=await readFile(path);if(bytes.length!==stat.size)throw Error('capture_changed');
 total+=bytes.length;if(total>256*1024*1024)throw Error('capture_budget_exceeded');
 if(bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.subarray(12,16).toString()!=='IHDR')throw Error('capture_signature_invalid');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(width!==Number(a.name.split('-')[1])||height<1||height>16384)throw Error('capture_dimensions_invalid');
 const name=a.name+'.png';await writeFile(join(out,name),bytes,{flag:'wx'});files.push({name,width,height,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(join(out,'manifest.json'),JSON.stringify({source:'04d09d6b33990ca8d6531eaf4b7e2978c8605da3',head:process.env.SEASONAL_CAPTURE_HEAD,run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,count:files.length,total_bytes:total,files},null,2)+'\n');
