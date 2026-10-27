import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createSkillInstallRoutes} from '../../apps/platform-api/src/routes/skill-install.js';
import {gitBlobSha1,skillInstallSource,skillFolderName,isSafeBundlePath} from '../../modules/skill-install/index.js';
import {communityCatalog,type SkillBook} from '../../modules/community/catalog.js';
import {parseInstallBundle,writeBundleToFolder,buildInstallZip,installCommands,SkillInstallError,SKILL_INSTALL_RECEIPT_FILE,type DirectoryHandleLike} from '../../apps/portal-web/src/modules/skill-install-client.js';

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

type MemoryNode={dirs:Map<string,MemoryNode>;files:Map<string,string>};
const memoryNode=():MemoryNode=>({dirs:new Map(),files:new Map()});
type MemoryOperation='directory'|'file'|'createWritable'|'write'|'close'|'remove';
function memoryHandle(name:string,state:MemoryNode,operations:string[]=[],fail?:(operation:MemoryOperation,path:string)=>boolean,path=''):DirectoryHandleLike{
  function record(operation:MemoryOperation,child:string){
    const location=path+'/'+child;operations.push(operation+':'+location);
    if(fail?.(operation,location))throw new Error('injected '+operation+' failure');
    return location;
  }
  return {name,
    async getDirectoryHandle(child,options){
      const location=record('directory',child);let next=state.dirs.get(child);
      if(!next){
        if(state.files.has(child))throw new DOMException('not a directory','TypeMismatchError');
        if(!options?.create)throw new DOMException('missing','NotFoundError');
        next=memoryNode();state.dirs.set(child,next);
      }
      return memoryHandle(child,next,operations,fail,location);
    },
    async getFileHandle(child,options){
      record('file',child);
      if(!state.files.has(child)){
        if(!options?.create)throw new DOMException('missing','NotFoundError');
        state.files.set(child,'');
      }
      return {async createWritable(){record('createWritable',child);let text='';return {
        async write(data){record('write',child);text+=typeof data==='string'?data:new TextDecoder().decode(data);},
        async close(){record('close',child);state.files.set(child,text);},
      };}};
    },
    async removeEntry(child){record('remove',child);state.dirs.delete(child);state.files.delete(child);},
    async *keys(){yield* state.dirs.keys();yield* state.files.keys();},
    async requestPermission(){return 'granted';},
  };
}
async function clientBundle(){
  const {fetcher}=await fakeGitHub({'SKILL.md':skill,'templates/notes.md':'notes'});
  return parseInstallBundle(await (await createSkillInstallRoutes(fetcher,undefined,[book('demo')]).request('/api/v1/skills/demo/install-bundle')).json());
}
function hasInstallCode(code:string){return (error:unknown)=>error instanceof SkillInstallError&&error.code===code;}

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
  await assert.rejects(parseInstallBundle({...data,repository:'FreeTWAI/x";touch /tmp/p;"'}),hasInstallCode('bundle_invalid'));
  await assert.rejects(parseInstallBundle({...data,repository:'FreeTWAI'}),hasInstallCode('bundle_invalid'));
  const bundle=await parseInstallBundle(data);

  const home=memoryNode();
  const first=await writeBundleToFolder(memoryHandle('.claude',home),bundle,'claude-code',()=>false);
  assert.deepEqual(first,{where:'.claude/skills/freedom-demo'});
  const installed=home.dirs.get('skills')!.dirs.get('freedom-demo')!;
  assert.equal(installed.files.get('SKILL.md'),skill);
  assert.equal(installed.dirs.get('templates')!.files.get('notes.md'),'notes');
  const receipt=JSON.parse(installed.files.get(SKILL_INSTALL_RECEIPT_FILE)!);
  assert.equal(receipt.package.commit,commit);assert.equal(receipt.manifest_digest,bundle.manifest_digest);
  assert.doesNotMatch(JSON.stringify(receipt),/\.claude|skills\/|\/home|\/Users/i,'receipt holds no local paths');
  installed.files.set('stale.md','old');
  await assert.rejects(writeBundleToFolder(memoryHandle('skills',home.dirs.get('skills')!),bundle,'claude-code',()=>true),hasInstallCode('exists'));
  assert.equal(installed.files.get('stale.md'),'old','reinstall preserves files dropped by the new version');
  assert.equal(installed.files.get('SKILL.md'),skill);
  assert.equal(installed.files.get(SKILL_INSTALL_RECEIPT_FILE),JSON.stringify(receipt,null,2)+'\n');

  const zip=new Uint8Array(await buildInstallZip(bundle,'codex').arrayBuffer());
  assert.deepEqual([...zip.slice(0,4)],[0x50,0x4b,0x03,0x04]);
  assert.ok(new TextDecoder().decode(zip).includes('freedom-demo/templates/notes.md'));
  const commands=installCommands(bundle,'openclaw');
  assert.ok(commands.shell.includes('/tar.gz/'+commit)&&commands.shell.includes('"$HOME/.openclaw/skills/freedom-demo"'));
  assert.ok(commands.powershell.includes('/zip/'+commit));
});

for(const receipt of [true,false])test('folder install refuses a non-empty folder '+(receipt?'with':'without')+' a receipt without writes',async()=>{
  const bundle=await clientBundle(),home=memoryNode(),existing=memoryNode(),nested=memoryNode(),operations:string[]=[];
  nested.files.set('mine.md','nested content');existing.dirs.set('my-notes',nested);existing.files.set('mine.md','keep');
  if(receipt)existing.files.set(SKILL_INSTALL_RECEIPT_FILE,'previous receipt');
  home.dirs.set(bundle.name,existing);
  const before=structuredClone(home);
  await assert.rejects(writeBundleToFolder(memoryHandle('skills',home,operations),bundle,'claude-code',()=>assert.fail('overwrite must never ask for confirmation')),error=>{
    assert.ok(hasInstallCode('exists')(error));
    assert.equal((error as SkillInstallError).message,'「freedom-demo」資料夾已經存在。為了不動到裡面的檔案，這次沒有覆寫；要更新請先自行移走或刪除這個資料夾再安裝，或改用下載 zip。');
    return true;
  });
  assert.deepEqual(home,before);
  assert.deepEqual(operations,['directory:/'+bundle.name],'only the existence lookup may run');
});

for(const preexisting of [false,true])test('folder write failure '+(preexisting?'restores a pre-existing empty folder':'removes only the newly created skill folder'),async()=>{
  const bundle=await clientBundle(),home=memoryNode(),sibling=memoryNode(),empty=memoryNode();
  sibling.files.set('mine.md','keep');home.dirs.set('other-skill',sibling);
  if(preexisting)home.dirs.set(bundle.name,empty);
  await assert.rejects(writeBundleToFolder(memoryHandle('skills',home,[],(operation,path)=>operation==='createWritable'&&path.endsWith('/notes.md')),bundle,'codex',()=>false),error=>{
    assert.ok(hasInstallCode('write_failed')(error));
    assert.equal((error as SkillInstallError).message,'安裝沒有完成，已移除這次寫入的檔案；原有檔案沒有變動。');return true;
  });
  assert.deepEqual(sibling.files,new Map([['mine.md','keep']]));
  assert.equal(home.dirs.get('other-skill'),sibling);
  assert.deepEqual([...home.dirs.keys()].sort(),preexisting?['freedom-demo','other-skill']:['other-skill']);
  if(preexisting){assert.equal(home.dirs.get(bundle.name),empty);assert.deepEqual(empty,memoryNode());}
});

for(const [operation,suffix] of [['directory','/templates'],['write','/notes.md'],['write','/'+SKILL_INSTALL_RECEIPT_FILE],['close','/'+SKILL_INSTALL_RECEIPT_FILE]] as const){
  test('folder install cleans an empty selected skill folder after '+operation+' fails at '+suffix,async()=>{
    const bundle=await clientBundle(),empty=memoryNode();
    await assert.rejects(writeBundleToFolder(memoryHandle(bundle.name,empty,[],(op,path)=>op===operation&&path.endsWith(suffix)),bundle,'codex',()=>assert.fail('selected skill folder needs no confirmation')),hasInstallCode('write_failed'));
    assert.deepEqual(empty,memoryNode());
  });
}

test('folder install propagates existence lookup errors without creating or removing anything',async()=>{
  const bundle=await clientBundle(),home=memoryNode(),operations:string[]=[],handle=memoryHandle('skills',home,operations);
  const error=new DOMException('cannot read','NotAllowedError');
  handle.getDirectoryHandle=async(_name,options)=>{assert.deepEqual(options,{create:false});throw error;};
  await assert.rejects(writeBundleToFolder(handle,bundle,'codex',()=>false),actual=>actual===error);
  assert.deepEqual(home,memoryNode());assert.deepEqual(operations,[]);
});

test('folder cleanup failure preserves write_failed and attempts the remaining created entries',async()=>{
  const bundle=await clientBundle(),empty=memoryNode(),operations:string[]=[];
  await assert.rejects(writeBundleToFolder(memoryHandle(bundle.name,empty,operations,(op,path)=>op==='write'&&path.endsWith('/notes.md')||op==='remove'&&path==='/SKILL.md'),bundle,'codex',()=>false),hasInstallCode('write_failed'));
  assert.ok(operations.includes('remove:/templates'));
  assert.equal(empty.dirs.size,0);
});

test('folder install retains selected-folder confirmation and supports an empty skill folder',async()=>{
  const bundle=await clientBundle(),home=memoryNode();let confirmations=0;
  await assert.rejects(writeBundleToFolder(memoryHandle('custom',home),bundle,'codex',()=>{confirmations++;return false;}),hasInstallCode('cancelled'));
  assert.deepEqual(home,memoryNode());assert.equal(confirmations,1);
  assert.deepEqual(await writeBundleToFolder(memoryHandle('custom',home),bundle,'codex',()=>true),{where:'custom/freedom-demo'});
  const empty=memoryNode();
  assert.deepEqual(await writeBundleToFolder(memoryHandle(bundle.name,empty),bundle,'codex',()=>false),{where:bundle.name});
  assert.equal(empty.files.get('SKILL.md'),skill);
  await assert.rejects(writeBundleToFolder(memoryHandle(bundle.name,empty),bundle,'codex',()=>true),hasInstallCode('exists'));
});

test('PowerShell commands stop on errors, stage pinned archives and remove only their temp directory',()=>{
  for(const target of ['claude-code','codex','openclaw'] as const){
    const {powershell}=installCommands({name:'freedom-demo',repository:'FreeTWAI/freedom-skill-demo',commit},target);
    assert.ok(powershell.startsWith("$ErrorActionPreference='Stop';"));
    assert.ok(powershell.includes('/zip/'+commit));
    assert.ok(powershell.includes('Join-Path $env:TEMP ([guid]::NewGuid().ToString())'));
    assert.ok(powershell.includes('Expand-Archive -LiteralPath $z -DestinationPath $t'));
    assert.ok(powershell.includes('Test-Path -LiteralPath "$s\\SKILL.md" -PathType Leaf'));
    const check=powershell.indexOf('if (Test-Path -LiteralPath $dest)'),move=powershell.indexOf('Move-Item -LiteralPath $s -Destination $dest');
    assert.ok(check>0&&move>check);
    assert.match(powershell.slice(check,move),/throw "「freedom-demo」資料夾已經存在/);
    assert.deepEqual(powershell.match(/Remove-Item[^}]+/g),['Remove-Item -LiteralPath $t -Recurse -Force ']);
    assert.ok(powershell.includes('finally { Remove-Item -LiteralPath $t -Recurse -Force }'));
  }
});

for(const scenario of ['success','curl failure','destination exists','missing SKILL.md','invalid archive'])test('shell command: '+scenario+' preserves existing files and removes staging',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'skill-install-command-'));
  try{
    const home=join(workspace,'home with spaces'),bin=join(workspace,'bin'),temp=join(workspace,'temp with spaces');
    const skills=join(home,'.openclaw','skills'),destination=join(skills,'freedom-demo'),extracted='freedom-skill-demo-'+commit;
    const source=join(workspace,'source'),archive=join(workspace,'fixture.tar.gz');
    await Promise.all([mkdir(join(source,extracted),{recursive:true}),mkdir(bin),mkdir(temp),mkdir(join(skills,'sibling'),{recursive:true})]);
    await writeFile(join(skills,'sibling','mine.md'),'sibling content');
    await writeFile(join(source,extracted,scenario==='missing SKILL.md'?'README.md':'SKILL.md'),skill);
    const tar=spawnSync('tar',['-czf',archive,'-C',source,extracted],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'});
    assert.equal(tar.status,0,tar.stderr);
    if(scenario==='invalid archive')await writeFile(archive,'not an archive');
    if(scenario==='destination exists'){await mkdir(destination);await writeFile(join(destination,'mine.md'),'destination content');}
    await writeFile(join(bin,'curl'),'#!/bin/sh\nif [ "$SKILL_INSTALL_CURL_FAIL" = 1 ]; then exit 22; fi\n[ "$#" -eq 4 ] && [ "$1" = -fsSL ] && [ "$3" = -o ] || exit 2\ncp "$SKILL_INSTALL_FIXTURE" "$4"\n',{mode:0o700});
    const {shell}=installCommands({name:'freedom-demo',repository:'FreeTWAI/freedom-skill-demo',commit},'openclaw');
    assert.ok(shell.includes('/tar.gz/'+commit));assert.doesNotMatch(shell,/\n/);
    const result=spawnSync('bash',['-c',shell],{cwd:workspace,env:{HOME:home,PATH:bin+':/usr/bin:/bin',TMPDIR:temp,SKILL_INSTALL_FIXTURE:archive,SKILL_INSTALL_CURL_FAIL:scenario==='curl failure'?'1':'0'},encoding:'utf8'});
    assert.equal(result.error,undefined);assert.equal(result.signal,null);
    if(scenario==='success'){
      assert.equal(result.status,0,result.stderr);assert.equal(await readFile(join(destination,'SKILL.md'),'utf8'),skill);
    }else{
      assert.notEqual(result.status,0,'failure must return a non-zero exit status');
      if(scenario==='destination exists'){
        assert.match(result.stderr,/「freedom-demo」資料夾已經存在/);
        assert.deepEqual(await readdir(destination),['mine.md']);assert.equal(await readFile(join(destination,'mine.md'),'utf8'),'destination content');
      }else assert.deepEqual(await readdir(skills),['sibling']);
    }
    assert.equal(await readFile(join(skills,'sibling','mine.md'),'utf8'),'sibling content');
    assert.deepEqual(await readdir(temp),[],'staging must be removed after success and every failure');
  }finally{await rm(workspace,{recursive:true,force:true});}
});
