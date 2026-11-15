import React, { useState } from 'react'
import { client, type PortalContextValue } from '../../portal-session'
import { hoursFromNowLocalInput, localInputToIso } from '../../format'

export function CreateWorkForm({
  pending,
  mutate,
  onCreated,
}: {
  pending: string | null
  mutate: PortalContextValue['mutate']
  onCreated: (title: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [acceptance, setAcceptance] = useState('')
  const [gain, setGain] = useState('')
  const [estimated, setEstimated] = useState('60')
  const [maximum, setMaximum] = useState('90')
  const [claimBy, setClaimBy] = useState(() => hoursFromNowLocalInput(24 * 7))
  const [finishBy, setFinishBy] = useState(() => hoursFromNowLocalInput(24 * 14))
  const [willReview, setWillReview] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const busy = Boolean(pending)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    try {
      if (!/^\d+$/.test(estimated.trim()) || !/^\d+$/.test(maximum.trim())) {
        throw new Error('分鐘須為正整數，不會四捨五入')
      }
      const estimatedMinutes = Number(estimated)
      const maximumMinutes = Number(maximum)
      if (!Number.isInteger(estimatedMinutes) || estimatedMinutes <= 0) throw new Error('預估分鐘須為正整數')
      if (!Number.isInteger(maximumMinutes) || maximumMinutes < estimatedMinutes) {
        throw new Error('上限分鐘須為整數，且不可小於預估分鐘')
      }
      const createdTitle = title.trim()
      const ok = await mutate('create-work-item', async (key) => {
        await client.post(
          '/work-items',
          {
            title: createdTitle,
            objective: objective.trim(),
            acceptance_criteria: acceptance.trim(),
            gain: gain.trim(),
            estimated_minutes: estimatedMinutes,
            maximum_minutes: maximumMinutes,
            claim_by: localInputToIso(claimBy),
            finish_by: localInputToIso(finishBy),
            will_review: willReview,
          },
          { idempotencyKey: key },
        )
      })
      if (ok) {
        setTitle('')
        setObjective('')
        setAcceptance('')
        setGain('')
        setWillReview(false)
        setOpen(false)
        await onCreated(createdTitle)
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '請檢查表單')
    }
  }

  if (!open) {
    return (
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          + 新增工作卡
        </button>
      </div>
    )
  }

  return (
    <section className="card">
      <h2>發布自願互助工作</h2>
      <p className="lede">說清楚需要什麼幫忙、花多少時間，以及怎樣算完成。由夥伴自願認領，平台不會自動派人。</p>
      {formError && (
        <p className="banner banner-error" role="alert">
          {formError}
        </p>
      )}
      <form className="stack" onSubmit={(event) => void onSubmit(event)}>
        <label className="field">
          <span className="field-label">標題</span>
          <input required value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span className="field-label">要解決的問題</span>
          <textarea required maxLength={1000} rows={3} value={objective} onChange={(event) => setObjective(event.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span className="field-label">完成條件</span>
          <textarea required rows={3} value={acceptance} onChange={(event) => setAcceptance(event.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span className="field-label">幫助者當次可得到什麼</span>
          <textarea required rows={2} value={gain} onChange={(event) => setGain(event.target.value)} disabled={busy} />
        </label>
        <div className="two-col">
          <label className="field">
            <span className="field-label">預估分鐘</span>
            <input required inputMode="numeric" value={estimated} onChange={(event) => setEstimated(event.target.value)} disabled={busy} />
          </label>
          <label className="field">
            <span className="field-label">上限分鐘</span>
            <input required inputMode="numeric" value={maximum} onChange={(event) => setMaximum(event.target.value)} disabled={busy} />
          </label>
        </div>
        <div className="two-col">
          <label className="field">
            <span className="field-label">認領期限</span>
            <input required type="datetime-local" value={claimBy} onChange={(event) => setClaimBy(event.target.value)} disabled={busy} />
          </label>
          <label className="field">
            <span className="field-label">完成期限</span>
            <input required type="datetime-local" value={finishBy} onChange={(event) => setFinishBy(event.target.value)} disabled={busy} />
          </label>
        </div>
        <label className="choice">
          <input type="checkbox" checked={willReview} onChange={(event) => setWillReview(event.target.checked)} disabled={busy} />
          我願意驗收這件工作的提交（不承諾即時回饋，也不是官方品管）
        </label>
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            發布工作卡
          </button>
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>
            取消
          </button>
        </div>
      </form>
    </section>
  )
}
