/** Local-only draft. No fetch, upload, member identity, or executable game content. */
export const GAME_ISSUES_URL = 'https://github.com/FreeTWAI/freedom-platform/issues';
export const GAME_SUBMISSION_LIMITS = { title: 60, description: 200, controls: 200, license: 160, repository: 300, revision: 40 } as const;
export type GameSubmissionDraft = Record<keyof typeof GAME_SUBMISSION_LIMITS, string> & { source: 'repository' | 'attachment' };
export type GameSubmissionBrief = { title: string; body: string; url: string };
export function blankGameSubmission(): GameSubmissionDraft {
  return { title: '', description: '', controls: '', license: '', repository: '', revision: '', source: 'repository' };
}
const labels = { title: '遊戲名稱', description: '玩法介紹', controls: '操作與啟動方式', license: '作者與素材授權', repository: 'GitHub 原始碼網址', revision: '完整 commit SHA' };
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
// Indented code blocks keep user text inert in the GitHub preview, including
// Markdown links, HTML, mentions and fences. Do not render it as raw HTML here.
function section(title: string, value: string) {
  return `### ${title}\n\n${value.split('\n').map(line => `    ${line}`).join('\n')}\n`;
}
export function prepareGameSubmission(draft: GameSubmissionDraft): GameSubmissionBrief {
  if (!draft || !['repository', 'attachment'].includes(draft.source)) throw Error('請選擇提供原始碼的方式。');
  const values = {} as Record<keyof typeof GAME_SUBMISSION_LIMITS, string>;
  for (const key of Object.keys(GAME_SUBMISSION_LIMITS) as Array<keyof typeof GAME_SUBMISSION_LIMITS>) {
    // Ignore inactive source fields rather than transmitting an old private URL.
    if (draft.source === 'attachment' && (key === 'repository' || key === 'revision')) { values[key] = ''; continue; }
    const raw = draft[key];
    if (typeof raw !== 'string' || raw.length > GAME_SUBMISSION_LIMITS[key] || controls.test(raw)) throw Error(`${labels[key]}格式不符或超過長度上限。`);
    const value = raw.replace(/\r\n?/g, '\n').trim();
    if (!value) throw Error(`請填寫${labels[key]}。`);
    if (['title', 'repository', 'revision'].includes(key) && /[\n\t\u2028\u2029]/.test(value)) throw Error(`${labels[key]}請使用單行文字。`);
    values[key] = value;
  }
  if (draft.source === 'repository') {
    // Accept a repository, not a URL to credentials, an API, an arbitrary host,
    // a moving branch, or a redirect. The maintainer still verifies ownership.
    const match = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})\/?$/.exec(values.repository);
    if (!match || ['.', '..'].includes(match[2])) throw Error('請填寫 https://github.com/作者/專案，不含登入資訊、查詢或其他路徑。');
    if (!/^[a-fA-F0-9]{40}$/.test(values.revision)) throw Error('請提供 40 字元的完整 commit SHA，讓審核固定在同一版本。');
    values.repository = `https://github.com/${match[1]}/${match[2]}`;
    values.revision = values.revision.toLowerCase();
  }
  const title = `[遊戲投稿] ${values.title}`;
  const body = [
    '這是社群遊戲投稿，尚未審核、上架或由平台執行。請先協調現有 Issue／PR，避免重複工作。\n',
    section('遊戲名稱', values.title), section('玩法介紹', values.description),
    section('操作與啟動方式', values.controls), section('作者與素材授權（投稿者自述，待審核）', values.license),
    draft.source === 'repository'
      ? section('固定原始碼版本', `${values.repository}/tree/${values.revision}`)
      : '### 原始碼附件\n\n請在 GitHub 送出前附上可公開的原始碼 ZIP（依 GitHub 支援的格式與大小），或改填固定版本的原始碼網址。尚未附檔，不能開始審核。\n',
    '### 維護者審核（尚未完成）\n\n- [ ] 核對來源、作者、LICENSE／NOTICE 與素材權利\n- [ ] 固定 commit 或附件 SHA-256，檢查秘密、外連、依賴與不安全程式\n- [ ] 在無平台憑證／正式資料的隔離環境驗證手機、鍵盤與退出／重開\n- [ ] 連回獨立整合 PR，完成必要 CI 與維護者審查；投稿本身不自動上架\n',
  ].join('\n');
  const url = new URL(`${GAME_ISSUES_URL}/new`);
  url.searchParams.set('title', title); url.searchParams.set('body', body);
  if (url.href.length > 8000) throw Error('投稿連結過長，請縮短介紹、操作或授權說明後重試。');
  return { title, body, url: url.href };
}
