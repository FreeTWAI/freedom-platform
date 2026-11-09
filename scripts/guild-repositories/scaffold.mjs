import {readFile, writeFile, mkdir, copyFile, stat} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateWorkspace} from '../../modules/guild-workspace/repositories/template/build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(root, 'modules/guild-workspace/repositories');
const registry = JSON.parse(await readFile(resolve(source, 'registry.json'), 'utf8'));
export async function scaffold(guildKey, output) {
  const entry = registry.find(entry => entry.guild_key === guildKey);
  if (!entry || !output || !output.startsWith('/')) throw new Error('Use a registered guild key and an absolute, new output directory');
  try {await stat(output); throw new Error('Output already exists; existing repositories are never overwritten');}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  const profileBytes = await readFile(resolve(source, 'profiles', `${guildKey}.json`), 'utf8');
  const profile = validateWorkspace(JSON.parse(profileBytes));
  if (profile.repository !== `FreeTWAI/${entry.repository}` || profile.guild_key !== entry.guild_key) throw new Error('Registry/profile mismatch');
  const files = {
    'build.mjs': 'scripts/build.mjs', 'serve.mjs': 'scripts/serve.mjs',
    'site.js': 'src/site.js', 'style.css': 'src/style.css',
    'workspace.test.mjs': 'tests/workspace.test.mjs', 'browser.spec.mjs': 'tests/browser/workspace.spec.mjs',
    'playwright.config.mjs': 'playwright.config.mjs', 'publish.yml': '.github/workflows/publish.yml',
    'package.json': 'package.json', 'package-lock.json': 'package-lock.json',
  };
  await mkdir(output, {recursive: true});
  const hashes = {};
  for (const [name, destination] of Object.entries(files)) {
    const bytes = await readFile(resolve(source, 'template', name));
    await mkdir(dirname(resolve(output, destination)), {recursive: true});
    await writeFile(resolve(output, destination), bytes);
    hashes[destination] = createHash('sha256').update(bytes).digest('hex');
  }
  await writeFile(resolve(output, 'workspace.json'), profileBytes);
  await copyFile(resolve(root, 'LICENSE'), resolve(output, 'LICENSE'));
  await copyFile(resolve(root, 'apps/portal-web/public/brand/freedom-workshop-compact-transparent.png'), resolve(output, 'brand.png'));
  await writeFile(resolve(output, '.gitignore'), 'node_modules/\ndist/\ntest-results/\nplaywright-report/\n');
  await writeFile(resolve(output, '.github/CODEOWNERS'), '# Guild maintainers may be added through a reviewed PR.\n* @teddashh @detna-vibe-coding @arumwu @Hao0321\n');
  const producerCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  const producerDirty = Boolean(execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim());
  await writeFile(resolve(output, 'template.lock.json'), JSON.stringify({schema_version: 'freedom.guild-template/v1', producer: 'FreeTWAI/freedom-platform', producer_commit: producerCommit, producer_dirty: producerDirty, template_files: hashes}, null, 2) + '\n');
  await writeFile(resolve(output, 'AGENTS.md'), `# ${entry.name}\n\nRead README.md and workspace.json. Work on a branch and open a PR. Run npm test, npm run build, and npm run test:browser. Keep the navigation bridge version and sandbox boundary. Never add member cookies, tokens, private data, production credentials, or direct database access. Actual work commands run in the central platform. Keep original attribution, LICENSE and brand assets. Public copy must describe the real workflow and avoid invented tools, results or membership.\n`);
  await writeFile(resolve(output, 'README.md'), `# ${entry.name}\n\n${profile.headline}。${profile.purpose}\n\n[開啟啟動台](https://freetwai.github.io/${entry.repository}/) · [進入自由工坊工作區](https://freetwai.com/#guilds/${entry.guild_key}/start)\n\n## 本公會的工作路徑\n\n${profile.steps.map((step, index) => `${index + 1}. ${step.title}：${step.detail}`).join('\n')}\n\n成果：${profile.outcome}。\n\n## 修改、預覽與發布\n\n需要 Node 24。執行 npm ci、npm test、npm run build、npm run preview；開啟 http://127.0.0.1:4417。瀏覽器驗證：npx playwright install chromium，再執行 npm run test:browser。\n\n文字與流程在 workspace.json，畫面在 src/。本 Repo 的 PR 由非作者維護者審查；verify 通過並合併 main 後，由 GitHub Actions 自動發布本公會的 GitHub Pages，毋須重建主站或其他公會。release.json 記錄實際發布的 source SHA。\n\n需回復時，在 Verify and publish workspace 的 Run workflow 選 main，填入曾合併到 main 的完整 source_sha。它會重新驗證並發布該版本；一般發布留空。main 分支與 github-pages 環境的保護不能關閉。發布失敗保留原站點；以 Actions 與公開 release.json 核對實際結果。\n\n## 與中央平台的邊界\n\n本 Repo 擁有啟動台的畫面與導覽。會員登入、入會、技能書、應用安裝、私人工作與版本資料仍由 freedom-platform 的原 API 管理。本頁可獨立開啟，也能由主站以 sandbox=allow-scripts 載入；freedom.guild-launchpad/v1 只提供 work、skills、tools、information 導覽，沒有任意 URL、讀取私人資料或提交命令。新增業務操作需在中央領域審查接入，不能自行複製權限邏輯。\n\n模板初始來源與檔案摘要見 template.lock.json；它只記錄起點，不阻止公會獨立改版。軟體採 MIT，沿用 FreeTWAI contributors 署名；brand.png 是自由工坊原始品牌資產，維持原有品牌權利，不因 MIT 程式授權取得另外的品牌授權。\n`);
  return {guild_key: guildKey, repository: `FreeTWAI/${entry.repository}`, directory: output};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5 || process.argv[3] !== '--out') throw new Error('Usage: node scripts/guild-repositories/scaffold.mjs <guild_key> --out <new-absolute-directory>');
  console.log(JSON.stringify(await scaffold(process.argv[2], resolve(process.argv[4]))));
}
