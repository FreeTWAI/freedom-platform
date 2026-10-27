import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {decideGuildPresentationProfile, decideAffectedJobs, decideE2eProfile, loadModuleDescriptors, GENERATED_INVENTORY_PATH,collectRepositoryDecision,evaluateVerifyAggregate,githubOutput,SELECTABLE_JOBS} from './select-affected-jobs.mjs';
import {guildPresentationDependenciesProven,loadGuildPresentationParsers,GUILD_PRESENTATION_PROFILE} from '../../packages/contribution-tools/guild-presentation-profile.mjs';
import {GUIDE_COMPOSITION_PROFILE} from '../../packages/contribution-tools/pinned-e2e.mjs';
import {isModuleDescriptorPath,selectImpact,owns} from '../../packages/contribution-tools/context.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const head=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const graph=loadModuleDescriptors(root,head);assert.equal(graph.ok,true);
const actualDescriptorSources=execFileSync('git',['-C',root,'ls-tree','-r','--name-only','-z',head],{encoding:'utf8'})
  .split('\0').filter(isModuleDescriptorPath)
  .map(path=>[path,execFileSync('git',['-C',root,'show',`${head}:${path}`])]);
const supply='modules/guild-supply/CatalogBlock.tsx',opensource='modules/guild-open-source/WorksBlock.tsx';
const admin='apps/portal-web/src/modules/AdminPanel.tsx';
const parsers=loadGuildPresentationParsers();assert.ok(parsers);
const sources=Object.fromEntries([supply,opensource,admin].map(path=>[path,readFileSync(join(root,path),'utf8')]));
function descriptor(module_id, extra={}) {
  return {format:'freedom.module/v1',module_id,owner_role:'foundation',owned_paths:[`modules/${module_id}/**`],
    public_exports:[],dependencies:[],contract_families:[],client_profiles:['member'],instructions:['AGENTS.md'],
    invariants:['local-only'],tests:['runtime.full'],surfaces:[],...extra};
}
// Synthetic admission fixture for the fixed host-reviewed GUIDE_COMPOSITION_PROFILE
// and GUILD_PRESENTATION_PROFILE. It is independent of the evolving checkout's
// descriptors: unrelated dependency slots are inert, while both real guild
// entries, their surfaces and the reviewed composition obligations stay explicit.
// Current repository ownership and its expanded consumers are tested separately.
function reviewedDescriptors() {
  const descriptors=GUILD_PRESENTATION_PROFILE.leaves.map(leaf=>descriptor(leaf.module,{
    owner_role:leaf.owner,public_exports:[leaf.entry],dependencies:[...leaf.dependencies],tests:['runtime.guild-blocks'],
    surfaces:[{surface_id:leaf.surface,entry:leaf.entry,kind:'page',auth_profile:'member-session',operations:[...leaf.operations]}],
  }));
  descriptors.push(descriptor('platform-admin-portal',{owned_paths:[admin],
    dependencies:['development','guild-workspace','positioning','shared'],tests:['runtime.full','ui.default']}));
  descriptors.push(descriptor(GUIDE_COMPOSITION_PROFILE.module,{owned_paths:['apps/portal-web/src/App.tsx'],
    dependencies:[...GUIDE_COMPOSITION_PROFILE.dependencies],tests:['runtime.full']}));
  for(const id of new Set(descriptors.flatMap(item=>item.dependencies)))
    if(!descriptors.some(item=>item.module_id===id))descriptors.push(descriptor(id));
  return descriptors;
}
function reviewedDescriptorSources() {
  const locations={'application-composition':'apps/freedom.module.json',
    'platform-admin-portal':'apps/admin/freedom.module.json','guild-presentation':'packages/guild-presentation/freedom.module.json'};
  return reviewedDescriptors().map(item=>[locations[item.module_id]??`modules/${item.module_id}/freedom.module.json`,JSON.stringify(item)]);
}
function input(paths=[supply], descriptors=reviewedDescriptors()) {return {event:'pull_request',diffComplete:true,descriptorsProven:true,
  changes:paths.map(path=>({status:'M',path})),baseline:structuredClone(descriptors),candidate:structuredClone(descriptors)};}
const decide=decideGuildPresentationProfile;
test('reviewed two-guild fixture retains composition obligations and explains exact checks',()=>{
  const composition = reviewedDescriptors().find(item => item.module_id === GUIDE_COMPOSITION_PROFILE.module);
  assert.deepEqual([...composition.dependencies].sort(), [...GUIDE_COMPOSITION_PROFILE.dependencies].sort());
  assert.ok(composition.dependencies.includes('platform-admin-portal'));
  const supplyLeaf = GUILD_PRESENTATION_PROFILE.leaves.find(item => item.module === 'guild-supply');
  assert.deepEqual(supplyLeaf.operations, ['storefront.supply-catalog.list', 'supplier-console.summary']);
  assert.deepEqual(supplyLeaf.dependencies, ['guild-presentation', 'hosted-distribution', 'supplier-console']);
  for(const paths of [[supply],[opensource],[supply,opensource,GENERATED_INVENTORY_PATH]]){
    const result=decide(input(paths));assert.equal(result.profile,'guild-presentation');
    assert.deepEqual(result.affected_modules, ['application-composition', ...new Set(paths.filter(path => path !== GENERATED_INVENTORY_PATH)
      .map(path => path === supply ? 'guild-supply' : 'guild-open-source'))].sort());
    assert.deepEqual(result.declared_suites,['runtime.full','runtime.guild-blocks']);
    assert.ok(result.integration_files.includes('tests/e2e/guild-block-composition.spec.ts'));
    assert.ok(result.preview_files.includes('modules/guild-open-source/WorksBlock.spec.ts'));
  }
});
test('actual admin ownership retains full suites, jobs and browser coverage alone or with guild edits',()=>{
  const owner = graph.descriptors.find(item => item.module_id === 'platform-admin-portal');
  assert.equal(owner.owner_role, 'foundation');
  for(const dependency of ['development','guild-workspace','positioning','shared','command-core','community',
    'member-card','member-communications','resource-scopes','tenant-workspaces'])assert.ok(owner.dependencies.includes(dependency),dependency);
  assert.deepEqual([...owner.tests].sort(), ['runtime.full', 'ui.default']);
  for(const path of owner.owned_paths.map(path => path.endsWith('/**') ? path.slice(0,-2)+'workspace.tsx' : path)) {
    assert.ok(graph.descriptors.filter(item => owns(item,path)).some(item=>item.module_id==='platform-admin-portal'),path);
    const impact = selectImpact({baseline:graph.descriptors,candidate:graph.descriptors,changedPaths:[path]});
    assert.deepEqual(impact.unknown_paths, [], path);
    for(const module of ['application-composition','platform-admin-portal','repo-maintainer','portal-features'])
      assert.ok(impact.module_ids.includes(module),path+': '+module);
    for(const suite of ['e2e.harness','runtime.full','runtime.member-card','ui.default'])assert.ok(impact.tests.includes(suite),path+': '+suite);
    for(const paths of [[path],[supply,path]]) {
      const value=input(paths,graph.descriptors),selection=decideAffectedJobs(value);
      assert.equal(decide(value).profile, 'full', path);
      assert.equal(decideE2eProfile(value).profile, 'full', path);
      assert.equal(selection.mode, 'full', path);
      assert.deepEqual(Object.keys(selection.jobs).filter(id => selection.jobs[id]), [...SELECTABLE_JOBS], path);
    }
  }
});
test('admin becoming a guild consumer or composition dependency drift keeps full fallback',()=>{
  for(const module of ['guild-supply','guild-open-source']) {
    const value=input([module === 'guild-supply' ? supply : opensource]);
    for(const graph of [value.baseline,value.candidate])graph.find(item => item.module_id === 'platform-admin-portal').dependencies.push(module);
    assert.deepEqual(decide(value), {profile:'full',reason:'guild_impact_unproven'});
  }
  const value=input();
  for(const graph of [value.baseline,value.candidate]) {
    const composition=graph.find(item => item.module_id === GUIDE_COMPOSITION_PROFILE.module);
    composition.dependencies=composition.dependencies.filter(id => id !== 'platform-admin-portal');
  }
  assert.deepEqual(decide(value), {profile:'full',reason:'guild_impact_unproven'});
});
test('unknown, core, new preview tests, manifest and registration keep full integration',()=>{
  for(const path of ['packages/guild-presentation/block.ts','modules/guild-supply/NewBlock.spec.ts','modules/guild-supply/freedom.module.json','apps/portal-web/src/guild-blocks/registry.generated.ts','contracts/guild-launchpad/v2/config.ts','apps/platform-api/src/routes/guild-launchpad.ts','README.md','migrations/new.sql'])assert.equal(decide(input([supply,path])).profile,'full',path);
  assert.equal(decide(input([GENERATED_INVENTORY_PATH])).profile,'full');
});
test('events, incomplete diff, deletion, rename and duplicate changes cannot narrow',()=>{
  for(const event of ['push','merge_group','workflow_dispatch',''])assert.equal(decide({...input(),event}).profile,'full');
  for(const status of ['D','R','R100','T','U']){const value=input();value.changes[0].status=status;assert.equal(decide(value).profile,'full');}
  assert.equal(decide({...input(),diffComplete:false}).profile,'full');
  assert.equal(decide({...input(),descriptorsProven:false}).profile,'full');
  assert.equal(decide(input([])).profile,'full');assert.equal(decide(input([supply,supply])).profile,'full');
});
test('baseline and candidate union cannot shed obligations or gain an unreviewed consumer',()=>{
  for(const side of ['baseline','candidate'])for(const field of ['owner_role','dependencies','tests','surfaces','public_exports']){
    const value=input(),owner=value[side].find(d=>d.module_id==='guild-supply');
    owner[field]=field==='owner_role'?'someone-else':[];assert.equal(decide(value).profile,'full',side+field);
  }
  const extra=input();for(const graph of [extra.baseline,extra.candidate])graph.find(d=>d.module_id==='personal-content').dependencies.push('guild-supply');
  assert.equal(decide(extra).profile,'full');
  const instruction=input(['modules/guild-supply/README.md']);
  for(const side of [instruction.baseline,instruction.candidate])side.find(d=>d.module_id==='guild-supply').instructions.push('modules/guild-supply/README.md');
  assert.equal(decide(instruction).profile,'full');
  const duplicate=input();duplicate.candidate.push(duplicate.candidate[0]);assert.equal(decide(duplicate).profile,'full');
  const missing=input();missing.candidate=missing.candidate.filter(d=>d.module_id!=='guild-presentation');assert.equal(decide(missing).profile,'full');
});

function integration(t, extra='', changedPath=supply, descriptorSources=reviewedDescriptorSources()) {
  const repository=mkdtempSync(join(tmpdir(),'fp-guild-impact-'));t.after(()=>rmSync(repository,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgsign=false',...args],{
    cwd:repository,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_AUTHOR_NAME:'Synthetic Fixture',GIT_COMMITTER_NAME:'Synthetic Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}}).trim();
  const write=(path,text)=>{mkdirSync(dirname(join(repository,path)),{recursive:true});writeFileSync(join(repository,path),text);};
  const commit=()=>{git('add','.');git('commit','-qm','Synthetic guild fixture');return git('rev-parse','HEAD');};
  git('init','-q','-b','main');
  // Preserve actual locations and raw descriptors: relocating a descriptor
  // invents another owned path and can exceed the schema's 256-path limit.
  for(const [path,source] of descriptorSources)write(path,source);
  for(const [path,source] of Object.entries(sources))write(path,source);
  const base=commit();git('switch','-qc','feature');
  write(changedPath,sources[changedPath]+'\nexport const label="after";\n'+(typeof extra==='string'?extra:''));
  if(typeof extra==='function')extra({write,source:sources[supply]});
  const head=commit();git('switch','main');git('merge','--no-ff','-qm','Synthetic integration','feature');
  return {repository,event:'pull_request',base,head,candidate:git('rev-parse','HEAD')};
}

test('clean synthetic integration with the reviewed graph selects the guild lane and requires every result',t=>{
  const args=integration(t),result=collectRepositoryDecision(args);
  assert.equal(result.mode,'affected');assert.equal(result.reason,'guild_presentation_dependency_closure');
  assert.deepEqual(Object.keys(result.jobs).filter(key=>result.jobs[key]),['static-worker','guild-presentation']);
  const outputs=Object.fromEntries(githubOutput(result).trim().split('\n').map(line=>line.split('=')));
  const needs={select:{result:'success',outputs},'source-integrity':{result:'success'}};
  for(const id of SELECTABLE_JOBS)needs[id]={result:result.jobs[id]?'success':'skipped'};
  assert.equal(evaluateVerifyAggregate(needs).ok,true);
  for(const id of ['guild-presentation','static-worker','source-integrity'])for(const state of ['skipped','failure','cancelled']){
    assert.equal(evaluateVerifyAggregate({...needs,[id]:{result:state}}).ok,false);
  }
  const missing=structuredClone(needs);delete missing['guild-presentation'];assert.equal(evaluateVerifyAggregate(missing).ok,false);
  const forged=structuredClone(needs);forged.select.outputs.ui_e2e='true';assert.equal(evaluateVerifyAggregate(forged).ok,false);
  assert.equal(collectRepositoryDecision({...args,candidate:args.head}).mode,'full');
  writeFileSync(join(args.repository,'untracked.ts'),'synthetic');assert.equal(collectRepositoryDecision(args).mode,'full');
});

test('actual expanded composition keeps guild edits on full jobs and browser coverage',t=>{
  const composition=graph.descriptors.find(item=>item.module_id===GUIDE_COMPOSITION_PROFILE.module);
  for(const module of ['portal-features','platform-api-features','portal-shell','platform-host'])
    assert.ok(composition.dependencies.includes(module),module);
  assert.notDeepEqual([...composition.dependencies].sort(),[...GUIDE_COMPOSITION_PROFILE.dependencies].sort());
  for(const paths of [[supply],[opensource],[supply,opensource]]) {
    const value=input(paths,graph.descriptors),impact=selectImpact({baseline:value.baseline,candidate:value.candidate,changedPaths:paths});
    assert.deepEqual(impact.unknown_paths,[]);
    assert.deepEqual(impact.tests,['runtime.full','runtime.guild-blocks']);
    assert.deepEqual(decide(value),{profile:'full',reason:'guild_impact_unproven'});
    assert.equal(decideE2eProfile(value).profile,'full');
    assert.deepEqual(Object.keys(decideAffectedJobs(value).jobs).filter(id=>decideAffectedJobs(value).jobs[id]),[...SELECTABLE_JOBS]);
  }
  // Keep the real descriptor locations; moving them would change implicit
  // ownership and could exceed the unchanged 256-path limit.
  const result=collectRepositoryDecision(integration(t,'',supply,actualDescriptorSources));
  assert.equal(result.mode,'full');assert.equal(result.reason,'guild_impact_unproven');
  assert.deepEqual(Object.keys(result.jobs).filter(id=>result.jobs[id]),[...SELECTABLE_JOBS]);
});

test('new guild reverse consumers in either revision preserve additional suites and full fallback',()=>{
  const reviewed=reviewedDescriptors(),expanded=structuredClone(reviewed);
  expanded.push(descriptor('additional-guild-consumer',{dependencies:['guild-supply'],tests:['runtime.member-card','ui.default']}));
  for(const [baseline,candidate] of [[reviewed,expanded],[expanded,reviewed],[expanded,expanded]]) {
    const value={...input(),baseline,candidate};
    const impact=selectImpact({baseline,candidate,changedPaths:[supply]});
    assert.ok(impact.module_ids.includes('additional-guild-consumer'));
    assert.deepEqual(impact.tests,['runtime.full','runtime.guild-blocks','runtime.member-card','ui.default']);
    assert.deepEqual(decide(value),{profile:'full',reason:'guild_impact_unproven'});
    const result=decideAffectedJobs(value);
    assert.deepEqual(Object.keys(result.jobs).filter(id=>result.jobs[id]),[...SELECTABLE_JOBS]);
  }
});

test('real clean admin integration selects every job',t=>{
  const result=collectRepositoryDecision(integration(t,'',admin,actualDescriptorSources));
  assert.equal(result.mode,'full');
  assert.deepEqual(Object.keys(result.jobs).filter(id=>result.jobs[id]),[...SELECTABLE_JOBS]);
});

test('new source imports cannot preserve a falsely unchanged descriptor graph',t=>{
  for(const extra of ["import '../../modules/community/service';\n",
    "export * from // additional source dependency\n '../../apps/portal-web/src/api';\n"]){
    const args=integration(t,extra);
    assert.equal(collectRepositoryDecision(args).mode,'full');
    assert.equal(collectRepositoryDecision(args).reason,'guild_source_dependencies_unproven');
  }
});

test('approved module directories include local helpers, CSS, docs and existing preview tests',()=>{
  for(const path of ['modules/guild-supply/CatalogBlock.spec.ts','modules/guild-supply/README.md',
    'modules/guild-supply/ui/Card.tsx','modules/guild-supply/styles.css']) {
    assert.equal(decide(input([supply,path])).profile,'guild-presentation',path);
  }
  const added=input(['modules/guild-supply/ui/Card.tsx']);added.changes[0].status='A';
  assert.equal(decide(added).profile,'guild-presentation');
  for(const path of ['modules/guild-supply/AGENTS.md','modules/guild-supply/vite.config.ts',
    'modules/guild-supply/.private.ts','modules/guild-events/EventsBlock.tsx'])assert.equal(decide(input([path])).profile,'full',path);
});

function boundary(after, before=new Map([[supply,sources[supply]]])) {
  return guildPresentationDependenciesProven({module:'guild-supply',baseline:before,candidate:after},parsers);
}
test('AST ignores comment/string wording and ordinary constructor properties',()=>{
  const candidate=new Map([[supply,sources[supply]+`
// import from require constructor Worker
export const wording = 'from constructor require import';
export const labels = {constructor: 'builder'};
`]]);
  assert.equal(boundary(candidate),true);
  assert.equal(boundary(new Map([[supply,sources[supply].replace("from 'react'","from /* comment */ 'react'")]])),true);
  assert.equal(guildPresentationDependenciesProven({module:'guild-supply',baseline:candidate,candidate},null),false);
});
test('source graph rejects new cross-domain imports, dynamic/type imports, require and export dependencies',()=>{
  for(const extra of ["import '../../modules/community/service';", "export {foo} from '../../modules/community/service';",
    "export * from // comment\n '../../apps/portal-web/src/api';", "import('new-package')", "require('new-package')",
    "type T = import('new-package').T;", "import.meta.glob('../../community/*.ts');", "new URL('../../community/file', import.meta.url);", "import x = require('react');", "new Function('return 1')",
    "export {foo} from " + '*//*'.repeat(16384) + '!']) {
    assert.equal(boundary(new Map([[supply,sources[supply]+'\n'+extra]])),false,extra.slice(0,90));
  }
  assert.equal(boundary(new Map([[supply,sources[supply].replace("from 'react'","from 'new-package'")]])),false);
});
test('same-module helpers and CSS resolve across the complete graph; outside helpers and unresolved paths do not',()=>{
  const candidate=new Map([[supply,sources[supply]+"\nimport './ui/Card';\nimport './styles.css';"],
    ['modules/guild-supply/ui/Card.tsx',"import React from 'react'; export const Card = () => <p>from constructor</p>;"],
    ['modules/guild-supply/styles.css','.card { color: var(--text-primary); }']]);
  assert.equal(boundary(candidate),true);
  candidate.set('modules/guild-supply/ui/Card.tsx',"import '../../../modules/community/service';");
  assert.equal(boundary(candidate),false);
  candidate.delete('modules/guild-supply/ui/Card.tsx');assert.equal(boundary(candidate),false);
});
test('CSS external imports, URL assets, escaped names and malformed sources keep full verification',()=>{
  for(const css of ['@import "https://example.invalid/style.css";', '.x { background: url(https://example.invalid/a); }',
    '.x { background: image-set("https://example.invalid/a" 1x); }', String.raw`@\69mport "./other.css";`, '.x {']) {
    assert.equal(boundary(new Map([[supply,sources[supply]],['modules/guild-supply/styles.css',css]])),false,css);
  }
});
test('preview-only external dependencies cannot be laundered into production helpers',()=>{
  const spec='modules/guild-supply/CatalogBlock.spec.ts';
  const before=new Map([[supply,sources[supply]],[spec,"import {test} from '@playwright/test';"]]);
  const after=new Map(before);after.set(supply,sources[supply]+"\nimport {test} from '@playwright/test';");
  assert.equal(boundary(after,before),false);
  after.set(supply,sources[supply]+"\nimport './CatalogBlock.spec';");assert.equal(boundary(after,before),false);
});
test('real integration admits module helper/style/doc edits without omitting required jobs',t=>{
  const args=integration(t,({write,source})=>{
    write(supply,source+"\nimport './Card';\nimport './card.css';");
    write('modules/guild-supply/Card.tsx',"import React from 'react';export const Card=()=> <p>constructor from</p>;");
    write('modules/guild-supply/card.css','.card {color: var(--text-primary)}');
    write('modules/guild-supply/README.md','Module-local development notes.\n');
  });
  const result=collectRepositoryDecision(args);
  assert.equal(result.mode,'affected');assert.equal(result.reason,'guild_presentation_dependency_closure');
});
test('nested helper imports cannot hide new cross-domain dependencies',t=>{
  const args=integration(t,({write,source})=>{
    write(supply,source+"\nimport './Card';");
    write('modules/guild-supply/Card.tsx',"export * from '../../community/service';");
  });
  assert.equal(collectRepositoryDecision(args).reason,'guild_source_dependencies_unproven');
});

test('current complete module trees remain eligible, including real preview tests',()=>{
  for(const leaf of GUILD_PRESENTATION_PROFILE.leaves){
    const paths=execFileSync('git',['-C',root,'ls-tree','-r','--name-only',head,'--',`modules/${leaf.module}/`],{encoding:'utf8'}).trim().split('\n');
    const files=new Map(paths.map(path=>[path,readFileSync(join(root,path),'utf8')]));
    assert.equal(guildPresentationDependenciesProven({module:leaf.module,baseline:files,candidate:files},parsers),true,leaf.module);
  }
});
test('parser installation stays in pinned selector checkout with lifecycle scripts disabled',()=>{
  const workflow=readFileSync(join(root,'.github/workflows/verify.yml'),'utf8');
  const select=workflow.slice(workflow.indexOf('  select:'),workflow.indexOf('  source-integrity:'));
  assert.match(select,/working-directory: trusted-selector\n        run: npm ci --ignore-scripts --no-audit --no-fund/);
  assert.ok(select.indexOf('npm ci')<select.indexOf('- name: Select affected jobs'));
});
