import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createSkillInstallRoutes} from '../../apps/platform-api/src/routes/skill-install.js';
import {createSkillInstallBundleLoader,gitBlobSha1,skillInstallSource,skillFolderName,isSafeBundlePath} from '../../modules/skill-install/index.js';
import {communityCatalog,type SkillBook} from '../../modules/community/catalog.js';
import {parseInstallBundle,installReceipt,buildInstallZip,copyText,installCommands,SkillInstallError} from '../../apps/portal-web/src/modules/skill-install-client.js';

const commit='a'.repeat(40);
const book=(id:string,extra:Partial<SkillBook>={}):SkillBook=>({id,title:id,repository_url:'https://github.com/FreeTWAI/freedom-skill-'+id,description:'',kind:'starter',fork_url:'',license_status:'MIT',upstream_url:'',source_commit:commit,introduction_url:null,...extra});
const encoder=new TextEncoder();

const redirectTarget='https://redirect.example.invalid/skill';
async function fakeGitHub(files:Record<string,string>,{tamper,truncated,redirect}:{tamper?:string;truncated?:boolean;redirect?:'tree'|'SKILL.md'}={}){
  const tree=await Promise.all(Object.entries(files).map(async([path,text])=>({path,type:'blob',sha:await gitBlobSha1(encoder.encode(text)),size:encoder.encode(text).length})));
  const calls:string[]=[];
  const redirects:(RequestRedirect|undefined)[]=[];
  const fetcher=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=String(input);calls.push(url);redirects.push(init?.redirect);
    if(url.startsWith('https://api.github.com/repos/')){
      if(redirect==='tree')return new Response(null,{status:302,headers:{Location:redirectTarget}});
      return Response.json({sha:commit,truncated:truncated??false,tree:[...tree,{path:'templates',type:'tree',sha:'b'.repeat(40)}]});
    }
    const prefix=/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//.exec(url);
    const path=prefix&&decodeURIComponent(url.slice(prefix[0].length));
    if(path&&path===redirect)return new Response(null,{status:302,headers:{Location:redirectTarget}});
    if(path&&path in files)return new Response(path===tamper?files[path]+'x':files[path]);
    return new Response('missing',{status:404});
  }) as typeof fetch;
  return {fetcher,calls,redirects};
}
const skill='---\nname: freedom-demo\ndescription: demo\n---\n# Demo\n';

function hasInstallCode(code:string){return (error:unknown)=>error instanceof SkillInstallError&&error.code===code;}

test('install bundle is pinned, verified, excludes development files and is cached per commit',async()=>{
  const {fetcher,calls,redirects}=await fakeGitHub({'SKILL.md':skill,'templates/notes.md':'筆記 ✓','.github/workflows/ci.yml':'x','tests/test_a.py':'x'});
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
  assert.deepEqual(redirects,['manual','manual','manual'],'tree and raw file fetches never follow redirects');
  const parsed=await parseInstallBundle(data);
  assert.equal(new TextDecoder().decode(parsed.files[1].bytes),'筆記 ✓');
  const before=calls.length;
  assert.equal((await app.request('/api/v1/skills/demo/install-bundle')).status,200);
  assert.equal(calls.length,before,'second read is served from the commit cache');
});

for(const redirect of ['tree','SKILL.md'] as const)test('install bundle rejects a redirect from '+redirect+' without following it',async()=>{
  const {fetcher,calls,redirects}=await fakeGitHub({'SKILL.md':skill},{redirect});
  const load=createSkillInstallBundleLoader(fetcher,undefined,[book('demo')]);
  await assert.rejects(load('demo'),{status:503,code:'skill_source_unreachable'});
  assert.deepEqual(calls,[
    'https://api.github.com/repos/FreeTWAI/freedom-skill-demo/git/trees/'+commit+'?recursive=1',
    ...(redirect==='SKILL.md'?['https://raw.githubusercontent.com/FreeTWAI/freedom-skill-demo/'+commit+'/SKILL.md']:[]),
  ]);
  assert.equal(calls.includes(redirectTarget),false,'redirect target is never fetched');
  assert.ok(redirects.every(value=>value==='manual'));
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

test('client rejects a tampered bundle and builds a verified zip with a path-free receipt',async()=>{
  const {fetcher}=await fakeGitHub({'SKILL.md':skill,'templates/notes.md':'notes'});
  const data=await (await createSkillInstallRoutes(fetcher,undefined,[book('demo')]).request('/api/v1/skills/demo/install-bundle')).json();
  await assert.rejects(parseInstallBundle({...data,files:data.files.map((file:{path:string;content_base64:string})=>file.path==='SKILL.md'?{...file,content_base64:btoa('changed')}:file)}),/驗證失敗/);
  await assert.rejects(parseInstallBundle({...data,files:[...data.files,{path:'../escape',sha:'0'.repeat(40),content_base64:''}]}),/格式不正確/);
  await assert.rejects(parseInstallBundle({...data,repository:'FreeTWAI/x";touch /tmp/p;"'}),hasInstallCode('bundle_invalid'));
  await assert.rejects(parseInstallBundle({...data,repository:'FreeTWAI'}),hasInstallCode('bundle_invalid'));
  const bundle=await parseInstallBundle(data);

  const receipt=installReceipt(bundle,'claude-code','zip');
  assert.equal(receipt.package.commit,commit);assert.equal(receipt.manifest_digest,bundle.manifest_digest);
  assert.doesNotMatch(JSON.stringify(receipt),/\.claude|skills\/|\/home|\/Users/i,'receipt holds no local paths');

  const zip=new Uint8Array(await buildInstallZip(bundle,'codex').arrayBuffer());
  assert.deepEqual([...zip.slice(0,4)],[0x50,0x4b,0x03,0x04]);
  assert.ok(new TextDecoder().decode(zip).includes('freedom-demo/templates/notes.md'));
  const commands=installCommands(bundle,'openclaw');
  assert.ok(commands.shell.includes('/tar.gz/'+commit)&&commands.shell.includes('dest="$HOME/.openclaw/skills/freedom-demo"'));
  assert.ok(commands.powershell.includes('/zip/'+commit));
});

test('client and UI do not offer direct folder writes',async()=>{
  for(const path of ['apps/portal-web/src/modules/skill-install-client.ts','apps/portal-web/src/modules/SkillInstall.tsx']){
    const source=await readFile(path,'utf8');
    assert.doesNotMatch(source,/showDirectoryPicker|getFileHandle|createWritable/,'direct folder writes need an exclusive-create primitive; see #1110 review');
  }
});

test('copyText reports success only after a clipboard write resolves',async()=>{
  const writes:string[]=[];
  assert.equal(await copyText({writeText:async text=>{writes.push(text);}},'install command'),true);
  assert.deepEqual(writes,['install command']);
  assert.equal(await copyText({writeText:async()=>{throw new Error('clipboard denied');}},'install command'),false);
  assert.equal(await copyText(undefined,'install command'),false);
});

test('PowerShell commands stop on errors, stage pinned archives and remove only their temp directory',()=>{
  for(const target of ['claude-code','codex','openclaw'] as const){
    const {powershell}=installCommands({name:'freedom-demo',repository:'FreeTWAI/freedom-skill-demo',commit},target);
    assert.ok(powershell.startsWith("$ErrorActionPreference='Stop';"));
    assert.ok(powershell.includes('/zip/'+commit));
    assert.ok(powershell.includes('Join-Path $env:TEMP ([guid]::NewGuid().ToString())'));
    assert.ok(powershell.includes('Expand-Archive -LiteralPath $z -DestinationPath $t'));
    assert.ok(powershell.includes('Test-Path -LiteralPath "$s\\SKILL.md" -PathType Leaf'));
    assert.ok(powershell.includes('New-Item -ItemType Directory -Force -Path $d | Out-Null'));
    const check=powershell.indexOf('if (Test-Path -LiteralPath $dest)'),move=powershell.indexOf('[System.IO.Directory]::Move($s,$dest)');
    assert.ok(check>0&&move>check);
    assert.doesNotMatch(powershell,/Copy-Item|Move-Item|New-Item[^;]*\$dest/);
    assert.match(powershell.slice(check,move),/throw "「freedom-demo」資料夾已經存在/);
    assert.deepEqual(powershell.match(/Remove-Item[^}]+/g),['Remove-Item -LiteralPath $t -Recurse -Force ']);
    assert.ok(powershell.includes('finally { Remove-Item -LiteralPath $t -Recurse -Force }'));
  }
});

for(const scenario of ['success','curl failure','destination exists','destination race','copy failure','missing SKILL.md','invalid archive'])test('shell command: '+scenario+' preserves existing files and removes staging',async()=>{
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
    if(scenario==='destination race')await writeFile(join(bin,'mkdir'),'#!/bin/sh\nif [ "$#" -eq 1 ] && [ "$1" = "$SKILL_INSTALL_DEST" ]; then /bin/mkdir "$1" || exit $?; printf \'%s\' \'their content\' > "$1/theirs.md"; fi\nexec /bin/mkdir "$@"\n',{mode:0o700});
    if(scenario==='copy failure')await writeFile(join(bin,'cp'),'#!/bin/sh\nif [ "$1" = -R ]; then printf \'%s\' \'partial content\' > "$SKILL_INSTALL_DEST/partial.md"; exit 9; fi\nexec /bin/cp "$@"\n',{mode:0o700});
    const {shell}=installCommands({name:'freedom-demo',repository:'FreeTWAI/freedom-skill-demo',commit},'openclaw');
    assert.ok(shell.includes('/tar.gz/'+commit));assert.doesNotMatch(shell,/\n/);
    assert.ok(shell.includes('mkdir "$dest" || exit 1; cp -R "$staged/." "$dest/"'));assert.doesNotMatch(shell,/\bmv\b/);
    const result=spawnSync('bash',['-c',shell],{cwd:workspace,env:{HOME:home,PATH:bin+':/usr/bin:/bin',TMPDIR:temp,SKILL_INSTALL_FIXTURE:archive,SKILL_INSTALL_DEST:destination,SKILL_INSTALL_CURL_FAIL:scenario==='curl failure'?'1':'0'},encoding:'utf8'});
    assert.equal(result.error,undefined);assert.equal(result.signal,null);
    if(scenario==='success'){
      assert.equal(result.status,0,result.stderr);assert.equal(await readFile(join(destination,'SKILL.md'),'utf8'),skill);
      assert.deepEqual(await readdir(destination),['SKILL.md'],'copy contents directly without an extra archive directory');
    }else{
      assert.notEqual(result.status,0,'failure must return a non-zero exit status');
      if(scenario==='destination exists'){
        assert.match(result.stderr,/「freedom-demo」資料夾已經存在/);
        assert.deepEqual(await readdir(destination),['mine.md']);assert.equal(await readFile(join(destination,'mine.md'),'utf8'),'destination content');
      }else if(scenario==='destination race'){
        assert.match(result.stderr,/mkdir/);
        assert.deepEqual(await readdir(destination),['theirs.md']);assert.equal(await readFile(join(destination,'theirs.md'),'utf8'),'their content');
      }else if(scenario==='copy failure'){
        assert.match(result.stderr,/可能留下部分檔案；沒有刪除任何檔案/);
        assert.deepEqual(await readdir(destination),['partial.md']);assert.equal(await readFile(join(destination,'partial.md'),'utf8'),'partial content');
      }else assert.deepEqual(await readdir(skills),['sibling']);
    }
    assert.equal(await readFile(join(skills,'sibling','mine.md'),'utf8'),'sibling content');
    assert.deepEqual(await readdir(temp),[],'staging must be removed after success and every failure');
  }finally{await rm(workspace,{recursive:true,force:true});}
});
