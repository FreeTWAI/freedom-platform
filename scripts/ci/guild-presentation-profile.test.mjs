import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {decideGuildPresentationProfile, loadModuleDescriptors, GENERATED_INVENTORY_PATH,collectRepositoryDecision,evaluateVerifyAggregate,githubOutput,SELECTABLE_JOBS} from './select-affected-jobs.mjs';
import {guildPresentationDependenciesProven,loadGuildPresentationParsers,GUILD_PRESENTATION_PROFILE} from '../../packages/contribution-tools/guild-presentation-profile.mjs';
import {isModuleDescriptorPath} from '../../packages/contribution-tools/context.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const head=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const graph=loadModuleDescriptors(root,head);assert.equal(graph.ok,true);
const descriptorSources=execFileSync('git',['-C',root,'ls-tree','-r','--name-only','-z',head],{encoding:'utf8'})
  .split('\0').filter(isModuleDescriptorPath)
  .map(path=>[path,execFileSync('git',['-C',root,'show',`${head}:${path}`])]);
const supply='modules/guild-supply/CatalogBlock.tsx',opensource='modules/guild-open-source/WorksBlock.tsx';
const parsers=loadGuildPresentationParsers();assert.ok(parsers);
const sources=Object.fromEntries([supply,opensource].map(path=>[path,readFileSync(join(root,path),'utf8')]));
function input(paths=[supply]){return {event:'pull_request',diffComplete:true,descriptorsProven:true,changes:paths.map(path=>({status:'M',path})),baseline:structuredClone(graph.descriptors),candidate:structuredClone(graph.descriptors)};}
const decide=decideGuildPresentationProfile;
test('actual two-guild graph retains composition obligations and explains exact checks',()=>{
  const supplyLeaf = GUILD_PRESENTATION_PROFILE.leaves.find(item => item.module === 'guild-supply');
  assert.deepEqual(supplyLeaf.operations, ['storefront.supply-catalog.list', 'supplier-console.summary']);
  assert.deepEqual(supplyLeaf.dependencies, ['guild-presentation', 'hosted-distribution', 'supplier-console']);
  for(const paths of [[supply],[opensource],[supply,opensource,GENERATED_INVENTORY_PATH]]){
    const result=decide(input(paths));assert.equal(result.profile,'guild-presentation');
    assert.ok(result.affected_modules.includes('application-composition'));
    assert.deepEqual(result.declared_suites,['runtime.full','runtime.guild-blocks']);
    assert.ok(result.integration_files.includes('tests/e2e/guild-block-composition.spec.ts'));
    assert.ok(result.preview_files.includes('modules/guild-open-source/WorksBlock.spec.ts'));
  }
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

function integration(t, extra='') {
  const repository=mkdtempSync(join(tmpdir(),'fp-guild-impact-'));t.after(()=>rmSync(repository,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','commit.gpgsign=false',...args],{
    cwd:repository,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_AUTHOR_NAME:'Synthetic Fixture',GIT_COMMITTER_NAME:'Synthetic Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}}).trim();
  const write=(path,text)=>{mkdirSync(dirname(join(repository,path)),{recursive:true});writeFileSync(join(repository,path),text);};
  const commit=()=>{git('add','.');git('commit','-qm','Synthetic guild fixture');return git('rev-parse','HEAD');};
  git('init','-q','-b','main');
  // Preserve actual locations and raw descriptors: relocating a descriptor
  // invents another owned path and can exceed the schema's 64-path limit.
  for(const [path,source] of descriptorSources)write(path,source);
  for(const [path,source] of Object.entries(sources))write(path,source);
  const base=commit();git('switch','-qc','feature');
  write(supply,sources[supply]+'\nexport const label="after";\n'+(typeof extra==='string'?extra:''));
  if(typeof extra==='function')extra({write,source:sources[supply]});
  const head=commit();git('switch','main');git('merge','--no-ff','-qm','Synthetic integration','feature');
  return {repository,event:'pull_request',base,head,candidate:git('rev-parse','HEAD')};
}

test('real clean integration selects the fixed guild lane and aggregate requires every selected result',t=>{
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
