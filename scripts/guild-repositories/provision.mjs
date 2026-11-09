/** One-time, explicitly invoked repository bootstrap. Never overwrites an existing repository. */
import {execFileSync} from 'node:child_process';
import {readFile, mkdir, writeFile, stat} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scaffold} from './scaffold.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const registry = JSON.parse(await readFile(join(root, 'modules/guild-workspace/repositories/registry.json'), 'utf8'));
const args = process.argv.slice(2);
let apply = false, key = null, directory = null;
const seen = new Set();
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (seen.has(flag)) throw new Error('Duplicate argument');
  seen.add(flag);
  if (flag === '--apply') {apply = true; continue;}
  if (!['--guild', '--out'].includes(flag) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Unknown or incomplete argument');
  if (flag === '--guild') key = args[++index];
  else directory = args[++index];
}
const selected = key ? registry.filter(entry => entry.guild_key === key) : registry;
if (!selected.length) throw new Error('Unknown guild');
if (!apply) {
  console.log(JSON.stringify({mode: 'plan', repositories: selected.map(entry => `FreeTWAI/${entry.repository}`), effects: ['create missing public repository', 'push initial source', 'enable Pages workflow', 'protect main and Pages environment']}, null, 2));
} else {
  if (!directory?.startsWith('/')) throw new Error('--apply requires --out with an absolute new fleet directory');
  if (execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim()) throw new Error('Commit the reviewed source before provisioning');
  const call = (endpoint, method = 'GET', body) => JSON.parse(execFileSync('gh', ['api', endpoint, '--method', method, ...(body ? ['--input', '-'] : [])], {encoding: 'utf8', ...(body ? {input: JSON.stringify(body)} : {})}));
  const operator = call('user').login;
  if (!['teddashh', 'detna-vibe-coding', 'arumwu', 'Hao0321'].includes(operator)) throw new Error('Use an existing platform release maintainer');
  await mkdir(directory, {recursive: true});
  for (const entry of selected) {
    const fullName = `FreeTWAI/${entry.repository}`;
    let existing;
    try {existing = call(`repos/${fullName}`);}
    catch (error) {if (!String(error.stderr).includes('HTTP 404')) throw error;}
    if (existing) throw new Error(`${fullName} already exists; inspect its state and resume explicitly, never overwrite`);
    const local = join(directory, entry.repository);
    try {await stat(local); throw new Error('Local repository already exists');}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
    await scaffold(entry.guild_key, local);
    const git = (...args) => execFileSync('git', args, {cwd: local, encoding: 'utf8'}).trim();
    git('init', '-b', 'main'); git('add', '.'); git('commit', '-m', `Initialize ${entry.name} independent workspace`);
    const sha = git('rev-parse', 'HEAD');
    const created = call('orgs/FreeTWAI/repos', 'POST', {name: entry.repository, description: `${entry.name}的獨立啟動台與工作流程`, private: false, has_issues: true, has_projects: false, has_wiki: false, auto_init: false, delete_branch_on_merge: true, allow_auto_merge: true, allow_squash_merge: true});
    const record = {guild_key: entry.guild_key, repository: fullName, repository_id: created.id, source_sha: sha, operator, state: 'created'};
    const receipt = join(directory, `${entry.repository}.json`);
    const save = async state => {record.state = state; await writeFile(receipt, JSON.stringify(record, null, 2) + '\n');};
    await save('created');
    call(`repos/${fullName}/environments/github-pages`, 'PUT', {deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}});
    call(`repos/${fullName}/environments/github-pages/deployment-branch-policies`, 'POST', {name: 'main', type: 'branch'});
    git('remote', 'add', 'origin', `https://github.com/${fullName}.git`);
    git('push', '-u', 'origin', 'main');
    await save('source_pushed');
    call(`repos/${fullName}/pages`, 'POST', {build_type: 'workflow'});
    await save('pages_enabled');
    call(`repos/${fullName}/rulesets`, 'POST', {name: 'guild-main', target: 'branch', enforcement: 'active', bypass_actors: [], conditions: {ref_name: {include: ['refs/heads/main'], exclude: []}}, rules: [
      {type: 'deletion'}, {type: 'non_fast_forward'},
      {type: 'pull_request', parameters: {required_approving_review_count: 1, dismiss_stale_reviews_on_push: true, require_code_owner_review: true, require_last_push_approval: true, required_review_thread_resolution: true}},
      {type: 'required_status_checks', parameters: {strict_required_status_checks_policy: true, required_status_checks: [{context: 'verify', integration_id: 15368}]}},
    ]});
    const pages = call(`repos/${fullName}/pages`);
    if (pages.html_url !== `https://freetwai.github.io/${entry.repository}/` || pages.build_type !== 'workflow') throw new Error('Unexpected Pages destination');
    await save('configured_waiting_for_publication');
    console.log(JSON.stringify(record));
  }
}
