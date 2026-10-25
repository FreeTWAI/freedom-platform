import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSkillInstallRoutes} from '../../apps/platform-api/src/routes/skill-install.js';
import {gitBlobSha1,skillInstallSource,skillFolderName,isSafeBundlePath} from '../../modules/skill-install/index.js';
import {communityCatalog,type SkillBook} from '../../modules/community/catalog.js';
import {parseInstallBundle,writeBundleToFolder,buildInstallZip,installCommands,SKILL_INSTALL_RECEIPT_FILE,type DirectoryHandleLike} from '../../apps/portal-web/src/modules/skill-install-client.js';

const commit='a'.repeat(40);
const book=(id:string,extra:Partial<SkillBook>={}):SkillBook=>({id,title:id,repository_url:'https://github.com/FreeTWAI/freedom-skill-'+id,description:'',kind:'starter',fork_url:'',license_status:'MIT',upstream_url:'',source_commit:commit,introduction_url:null,...extra});
const encoder=new TextEncoder();

async function fakeGitHub(files:Record<string,string>,{tamper,truncated}:{tamper?:string;truncated?:boolean}={}){
  const tree=await Promise.all(Object.entries(files).map(async([path,text])=>({path,type:'blob',sha:await gitBlobSha1(encoder.encode(text)),size:encoder.encode(text).length})));
  const calls:string[]=[];
  const fetcher=(async(input:string|URL|Request)=>{
    const url=String(input);calls.push(url);
    if(url.startsWith('https://api.github.com/repos/'))return Response.json({sha:commit,truncated:truncated??false,tree:[...tree,{path:'templates',type:'tree',sha:'b'.repeat(40)}]});
    const prefix=/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//.exec(url);
    const path=prefix&&decodeURIComponent(url.slice(prefix[0].length));
    if(path&&path in files)return new Response(path===tamper?files[path]+'x':files[path]);
    return new Response('missing',{status:404});
  }) as typeof fetch;
  return {fetcher,calls};
}
const skill='---\nname: freedom-demo\ndescription: demo\n---\n# Demo\n';

test('install bundle is pinned, verified, excludes development files and is cached per commit',async()=>{
  const {fetcher,calls}=await fakeGitHub({'SKILL.md':skill,'templates/notes.md':'筆記 ✓','.github/workflows/ci.yml':'x','tests/test_a.py':'x'});
  const app=createSkillInstallRoutes(fetcher,()=>null,[book('demo')]);
  const response=await app.request('/api/v1/skills/demo/install-bundle');
  assert.equal(response.status,200);
  assert.match(response.headers.get('Cache-Control')??'',/max-age=/);
  const data=await response.json();
  assert.equal(data.format,'freedom.skill-install-bundle/v1');
  assert.equal(data.name,'freedom-demo');
  assert.equal(data.commit,commit);
  assert.deepEqual(data.files.map((file:{path:string})=>file.path),['SKILL.md','templates/notes.md']);
  assert.ok(calls.every(url=>url.includes(commit)),'every request names the exact commit');
  const parsed=await parseInstallBundle(data);
  assert.equal(new TextDecoder().decode(parsed.files[1].bytes),'筆記 ✓');
  const before=calls.length;
  assert.equal((await app.request('/api/v1/skills/demo/install-bundle')).status,200);
  assert.equal(calls.length,before,'second read is served from the commit cache');
});

test('install bundle refuses unknown, unpinned, non-skill, tampered and unsafe sources',async()=>{
  const ok=await fakeGitHub({'SKILL.md':skill});
  const books=[book('demo'),book('floating',{source_commit:null}),book('elsewhere',{repository_url:'https://gitlab.com/x/y'})];
  const app=createSkillInstallRoutes(ok.fetcher,undefined,books);
  for(const id of ['missing','floating','elsewhere']){
    const response=await app.request('/api/v1/skills/'+id+'/install-bundle');
    assert.equal(response.status,404,id);assert.equal((await response.json()).error,'skill_install_unavailable');
  }
  assert.equal(ok.calls.length,0,'unknown books never reach GitHub');
  const noSkill=await fakeGitHub({'README.md':'x'});
  assert.equal((await (await createSkillInstallRoutes(noSkill.fetcher,undefined,books).request('/api/v1/skills/demo/install-bundle')).json()).error,'not_a_skill_package');
  const tampered=await fakeGitHub({'SKILL.md':skill,'a.md':'a'},{tamper:'a.md'});
  const mismatch=await createSkillInstallRoutes(tampered.fetcher,undefined,books).request('/api/v1/skills/demo/install-bundle');
  assert.equal(mismatch.status,502);assert.equal(mismatch.headers.get('Cache-Control'),'no-store');
  const truncated=await fakeGitHub({'SKILL.md':skill},{truncated:true});
  assert.equal((await createSkillInstallRoutes(truncated.fetcher,undefined,books).request('/api/v1/skills/demo/install-bundle')).status,422);
  for(const path of ['../x','/etc/passwd','a//b','a\\b','./a'])assert.equal(isSafeBundlePath(path),false,path);
  assert.equal(skillFolderName('---\nname: ../evil\n---',' My Repo'),'-my-repo');
});

test('only pinned GitHub catalog books are offered',()=>{
  const pinned=communityCatalog.skill_books.filter(item=>skillInstallSource(item.id));
  assert.ok(pinned.length>0);
  for(const item of pinned)assert.match(item.source_commit!,/^[0-9a-f]{40}$/);
});

test('client rejects a tampered bundle and writes a verified bundle with a path-free receipt',async()=>{
  const {fetcher}=await fakeGitHub({'SKILL.md':skill,'templates/notes.md':'notes'});
  const data=await (await createSkillInstallRoutes(fetcher,undefined,[book('demo')]).request('/api/v1/skills/demo/install-bundle')).json();
  await assert.rejects(parseInstallBundle({...data,files:data.files.map((file:{path:string;content_base64:string})=>file.path==='SKILL.md'?{...file,content_base64:btoa('changed')}:file)}),/驗證失敗/);
  await assert.rejects(parseInstallBundle({...data,files:[...data.files,{path:'../escape',sha:'0'.repeat(40),content_base64:''}]}),/格式不正確/);
  const bundle=await parseInstallBundle(data);

  type Node={dirs:Map<string,Node>;files:Map<string,string>};
  const node=():Node=>({dirs:new Map(),files:new Map()});
  const handle=(name:string,state:Node):DirectoryHandleLike=>({name,
    async getDirectoryHandle(child,options){let next=state.dirs.get(child);if(!next){if(!options?.create)throw new Error('missing');next=node();state.dirs.set(child,next);}return handle(child,next);},
    async getFileHandle(child){return {async createWritable(){let text='';return {async write(data){text+=typeof data==='string'?data:new TextDecoder().decode(data);},async close(){state.files.set(child,text);}};}};},
    async removeEntry(child){state.dirs.delete(child);state.files.delete(child);},
    async *keys(){yield* state.dirs.keys();yield* state.files.keys();},
    async requestPermission(){return 'granted';}});
  const home=node();
  const first=await writeBundleToFolder(handle('.claude',home),bundle,'claude-code',()=>false);
  assert.deepEqual(first,{updated:false,where:'.claude/skills/freedom-demo'});
  const installed=home.dirs.get('skills')!.dirs.get('freedom-demo')!;
  assert.equal(installed.files.get('SKILL.md'),skill);
  assert.equal(installed.dirs.get('templates')!.files.get('notes.md'),'notes');
  const receipt=JSON.parse(installed.files.get(SKILL_INSTALL_RECEIPT_FILE)!);
  assert.equal(receipt.package.commit,commit);assert.equal(receipt.manifest_digest,bundle.manifest_digest);
  assert.doesNotMatch(JSON.stringify(receipt),/\.claude|skills\/|\/home|\/Users/i,'receipt holds no local paths');
  installed.files.set('stale.md','old');
  assert.equal((await writeBundleToFolder(handle('skills',home.dirs.get('skills')!),bundle,'claude-code',()=>false)).updated,true);
  assert.equal(installed.files.has('stale.md'),false,'update removes files dropped by the new version');
  const foreign=node();foreign.dirs.set('freedom-demo',{dirs:new Map(),files:new Map([['mine.md','keep']])});
  await assert.rejects(writeBundleToFolder(handle('skills',foreign),bundle,'claude-code',()=>false),/已取消/);
  assert.equal(foreign.dirs.get('freedom-demo')!.files.get('mine.md'),'keep','a folder without a receipt is not overwritten without consent');

  const zip=new Uint8Array(await buildInstallZip(bundle,'codex').arrayBuffer());
  assert.deepEqual([...zip.slice(0,4)],[0x50,0x4b,0x03,0x04]);
  assert.ok(new TextDecoder().decode(zip).includes('freedom-demo/templates/notes.md'));
  const commands=installCommands(bundle,'openclaw');
  assert.ok(commands.shell.includes('/tar.gz/'+commit)&&commands.shell.includes('~/.openclaw/skills/freedom-demo'));
  assert.ok(commands.powershell.includes('/zip/'+commit));
});
