import type { SkillPageContent } from '../../../../modules/community/skill-page-content.js';
import type { SkillFlow, SkillFlowStep } from '../../../../modules/development/skill-flow.js';

function mapSteps(steps: SkillFlow['steps'], update: (step: SkillFlowStep, index: number) => SkillFlowStep): SkillFlow['steps'] {
  return [update(steps[0], 0), update(steps[1], 1), update(steps[2], 2)];
}

export type ManualSkillPageFields = { headline: string; problem: string; mechanism: string; outcomes: string; flow: SkillFlow };
export function blankSkillPageFields(): ManualSkillPageFields {
  return { headline: '', problem: '', mechanism: '', outcomes: '', flow: {
    title: '從輸入到產出', lead: '',
    steps: [{ icon: 'doc', title: '準備輸入', note: '' }, { icon: 'sliders', title: '執行處理', note: '' }, { icon: 'check', title: '取得成果', note: '' }],
    caption: '操作條件與限制請一起閱讀下方的使用說明。',
  } };
}
export function skillPageFields(content: SkillPageContent): ManualSkillPageFields {
  return { headline: content.headline, problem: content.problem, mechanism: content.mechanism, outcomes: content.outcomes.join('\n'), flow: content.flow };
}
/** The shared validator checks cardinality and every field before preview/save. */
export function manualSkillPageContent(fields: ManualSkillPageFields): SkillPageContent {
  return { headline: fields.headline.trim(), problem: fields.problem.trim(), mechanism: fields.mechanism.trim(),
    outcomes: fields.outcomes.split('\n').map(item => item.trim()) as [string, string, string],
    flow: { ...fields.flow, lead: fields.flow.lead.trim(), steps: mapSteps(fields.flow.steps, step => ({ ...step, note: step.note.trim() })) },
  };
}

export function SkillSubmissionPageFields({ value, onChange }: { value: ManualSkillPageFields; onChange: (value: ManualSkillPageFields) => void }) {
  return <section className="stack" aria-label="介紹頁內容">
    <h3>讓讀者看懂這個工具</h3><p className="hint">依原作文件填寫問題、原理與實際成果，網站會自動排成介紹頁與流程圖。</p>
    <label className="field">效益主標<input required minLength={6} maxLength={30} pattern=".*[。！？]" placeholder="例如：把散落的會議紀錄整理成行動清單。" value={value.headline} onChange={event => onChange({ ...value, headline: event.target.value })}/><span className="field-hint">6–30 字，以「。」「！」「？」結尾，寫實際能做到的事。</span></label>
    <label className="field">使用者遇到什麼問題<textarea required minLength={12} maxLength={100} rows={2} placeholder="誰在什麼情境遇到什麼困難？" value={value.problem} onChange={event => onChange({ ...value, problem: event.target.value })}/><span className="field-hint">12–100 字。</span></label>
    <label className="field">工具如何解決問題<textarea required minLength={20} maxLength={160} rows={3} placeholder="說明它接收什麼、實際如何處理、產生什麼結果。" value={value.mechanism} onChange={event => onChange({ ...value, mechanism: event.target.value })}/><span className="field-hint">20–160 字，說明運作原理，不只重複效益。</span></label>
    <label className="field">三個實際成果<textarea required maxLength={92} rows={3} placeholder={'每行一項，例如：\n整理好的會議摘要\n可指派的行動清單\n保留來源的決策紀錄'} value={value.outcomes} onChange={event => onChange({ ...value, outcomes: event.target.value })}/><span className="field-hint">剛好三行、每項 4–30 字，寫讀者實際拿到的不同成果。</span></label>
    <label className="field">使用條件<input required minLength={10} maxLength={100} value={value.flow.lead} placeholder="需要的環境、資料或事前準備；請依原作文件填寫。" onChange={event => onChange({ ...value, flow: { ...value.flow, lead: event.target.value } })}/><span className="field-hint">10–100 字，若尚未確認，請說明需先核對原作文件。</span></label>
    <label className="field">流程名稱<input required minLength={4} maxLength={24} value={value.flow.title} placeholder="例如：從會議筆記到行動清單" onChange={event => onChange({ ...value, flow: { ...value.flow, title: event.target.value } })}/><span className="field-hint">4–24 字，點出工具實際處理的工作。</span></label>
    {value.flow.steps.map((step, index) => <fieldset className="stack" key={index} style={{ border: 0, padding: 0 }}>
      <legend>步驟 {index + 1}</legend>
      <label className="field">步驟 {index + 1} 名稱<input required minLength={2} maxLength={14} value={step.title} placeholder={['例如：讀取會議筆記', '例如：整理決策與待辦', '例如：匯出行動清單'][index]} onChange={event => onChange({ ...value, flow: { ...value.flow, steps: mapSteps(value.flow.steps, (item, i) => i === index ? { ...item, title: event.target.value } : item) } })}/><span className="field-hint">2–14 字，使用實際的操作名稱。</span></label>
      <label className="field">步驟 {index + 1} 說明<input required minLength={8} maxLength={60} value={step.note} placeholder={['使用者先提供什麼資料？', '工具實際執行什麼處理？', '最後怎麼取得或使用結果？'][index]} onChange={event => onChange({ ...value, flow: { ...value.flow, steps: mapSteps(value.flow.steps, (item, i) => i === index ? { ...item, note: event.target.value } : item) } })}/><span className="field-hint">8–60 字，只填這個工具實際支援的步驟。</span></label>
    </fieldset>)}
  </section>;
}
