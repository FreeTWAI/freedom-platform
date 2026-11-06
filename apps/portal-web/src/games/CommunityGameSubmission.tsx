import { useId, useState, type FormEvent } from 'react';
import { blankGameSubmission, GAME_ISSUES_URL, GAME_SUBMISSION_LIMITS, prepareGameSubmission, type GameSubmissionBrief, type GameSubmissionDraft } from './community-game-submission';
import './community-game-submission.css';

export function CommunityGameSubmission({ hidden }: { hidden: boolean }) {
  const [draft, setDraft] = useState(blankGameSubmission), [brief, setBrief] = useState<GameSubmissionBrief | null>(null);
  const [consent, setConsent] = useState(false), [error, setError] = useState('');
  const id = useId();
  function change(key: keyof GameSubmissionDraft, value: string) {
    setDraft(current => ({ ...current, [key]: value })); setBrief(null); setConsent(false); setError('');
  }
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { setBrief(prepareGameSubmission(draft)); setConsent(false); setError(''); }
    catch (cause) { setBrief(null); setError(cause instanceof Error ? cause.message : '無法準備投稿，請檢查欄位。'); }
  }
  const field = (key: 'title' | 'description' | 'controls' | 'license', label: string, hint: string, rows = 2) => <div className="game-submission-field">
    <label htmlFor={`${id}-${key}`}>{label}（最多 {GAME_SUBMISSION_LIMITS[key]} 字元）</label>
    {key === 'title' ? <input id={`${id}-${key}`} value={draft[key]} required maxLength={GAME_SUBMISSION_LIMITS[key]} onChange={e => change(key, e.target.value)} aria-describedby={`${id}-${key}-hint`}/>
      : <textarea id={`${id}-${key}`} value={draft[key]} required rows={rows} maxLength={GAME_SUBMISSION_LIMITS[key]} onChange={e => change(key, e.target.value)} aria-describedby={`${id}-${key}-hint`}/>}
    <small id={`${id}-${key}-hint`}>{hint}</small>
  </div>;
  return <section hidden={hidden} className="game-submission" aria-label="社群遊戲投稿">
    <details>
      <summary>投稿自己的遊戲</summary>
      <div className="game-submission-content">
        <p>先準備資料，再到 GitHub 由你送出公開投稿。原始碼可用固定版本網址，或在 GitHub 附 ZIP；目前不是站內檔案上傳，也不會自動上架或執行遊戲。</p>
        <p><a href={GAME_ISSUES_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">先查看已有投稿與討論 ↗</a>。需要 GitHub 帳號；請勿填入密碼、金鑰、私人資料或未授權素材。</p>
        <form onSubmit={prepare}>
          {field('title', '遊戲名稱', '用一句簡短名稱辨識你的遊戲。')}
          {field('description', '玩法介紹', '說明目標、規則與何時完成一局。')}
          {field('controls', '操作與啟動方式', '列出觸控／鍵盤操作、啟動方式及必要依賴。')}
          {field('license', '作者與素材授權', '列出原作者、程式與圖片／音樂的授權；保留 LICENSE 和 NOTICE。')}
          <label className="game-submission-field" htmlFor={`${id}-source`}>提供原始碼的方式
            <select id={`${id}-source`} value={draft.source} onChange={e => change('source', e.target.value)}>
              <option value="repository">GitHub 原始碼固定版本</option><option value="attachment">稍後在 GitHub 附原始碼 ZIP</option>
            </select>
          </label>
          {draft.source === 'repository' && <>
            <label className="game-submission-field" htmlFor={`${id}-repository`}>GitHub 原始碼網址
              <input id={`${id}-repository`} type="url" required maxLength={300} placeholder="https://github.com/作者/專案" value={draft.repository} onChange={e => change('repository', e.target.value)}/>
            </label>
            <div className="game-submission-field"><label htmlFor={`${id}-revision`}>完整 commit SHA</label>
              <input id={`${id}-revision`} required maxLength={40} spellCheck={false} value={draft.revision} onChange={e => change('revision', e.target.value)} aria-describedby={`${id}-revision-hint`}/>
              <small id={`${id}-revision-hint`}>從該版本的 GitHub commit 頁複製完整 40 字元 SHA，不使用會變動的分支名稱。</small>
            </div>
          </>}
          {error && <p role="alert">{error}</p>}
          <button className="fw-arcade-secondary" type="submit">準備投稿預覽</button>
        </form>
        {brief && <div className="game-submission-preview">
          <p role="status">預覽已準備，尚未送出。GitHub 提交後才會有真正的 Issue 編號。</p>
          <label className="game-submission-field" htmlFor={`${id}-preview`}>將傳給 GitHub 的投稿內容
            <textarea id={`${id}-preview`} readOnly rows={12} value={`${brief.title}\n\n${brief.body}`}/>
          </label>
          <label className="game-submission-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/>我已檢查內容，願意將以上資料傳給 GitHub，並在那裡確認後公開投稿。</label>
          {consent && <a className="fw-arcade-button fw-arcade-secondary" href={brief.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">到 GitHub 預覽投稿 ↗</a>}
          <p>若 GitHub 登入或載入失敗，回到本頁即可重開；也可手動複製以上內容。提交結果與審核進度請到 GitHub 查看，本頁不推定已送出。</p>
        </div>}
        <p>草稿只留在目前頁面，收合或玩一局後返回會保留；重新整理或離開網站會清除。需維護者審核與整合 PR 後，才可能加入大廳。</p>
      </div>
    </details>
  </section>;
}
