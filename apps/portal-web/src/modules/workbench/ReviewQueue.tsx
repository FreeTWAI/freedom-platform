import React, { useState } from 'react'
import { client, usePortal, type PortalContextValue } from '../../portal-session'
import { Section } from '../../portal-feedback'
import { claimStateLabel } from '../../format'
import type { ReviewQueueItem } from '../../types'

export function ReviewQueue({
  entries,
  pending,
  mutate,
  onChanged,
}: {
  entries: ReviewQueueItem[]
  pending: string | null
  mutate: PortalContextValue['mutate']
  onChanged: () => Promise<void>
}) {
  return (
    <Section title="待你回饋" description="貢獻者不可自審。">
      {entries.length === 0 ? (
        <p className="empty">目前沒有待回饋項目。</p>
      ) : (
        <div className="card-grid">
          {entries.map((entry) => (
            <ReviewCard key={entry.claim.claim_id} entry={entry} pending={pending} mutate={mutate} onChanged={onChanged} />
          ))}
        </div>
      )}
    </Section>
  )
}

export function ReviewCard({
  entry,
  pending,
  mutate,
  onChanged,
}: {
  entry: ReviewQueueItem
  pending: string | null
  mutate: PortalContextValue['mutate']
  onChanged: () => Promise<void>
}) {
  const { isMe } = usePortal()
  const [decision, setDecision] = useState<'accept' | 'changes_requested'>('accept')
  const [feedback, setFeedback] = useState('')
  const busy = Boolean(pending)
  const self = isMe(entry.claim.claimant_ref)

  if (self) {
    return (
      <article className="card">
        <h3>{entry.work_item.title}</h3>
        <p className="hint">實際貢獻者不能回饋自己的提交。</p>
      </article>
    )
  }

  async function beginReview() {
    const ok = await mutate(`begin-review:${entry.claim.claim_id}`, async (key) => {
      await client.post(`/work-claims/${entry.claim.claim_id}:begin-review`, {}, {
        idempotencyKey: key,
        ifMatch: entry.claim.aggregate_version,
      })
    })
    if (ok) await onChanged()
  }

  async function decide(event: React.FormEvent) {
    event.preventDefault()
    const sha = entry.claim.latest_submission?.sha256
    if (!sha) return
    if (decision === 'changes_requested' && !feedback.trim()) return
    const ok = await mutate(`decide:${entry.claim.claim_id}`, async (key) => {
      await client.post(
        `/work-claims/${entry.claim.claim_id}:decide`,
        {
          decision,
          feedback: feedback.trim(),
          submission_sha256: sha,
        },
        { idempotencyKey: key, ifMatch: entry.claim.aggregate_version },
      )
    })
    if (ok) await onChanged()
  }

  return (
    <article className="card">
      <div className="card-head">
        <h3>{entry.work_item.title}</h3>
        <span className="pill pill-green">{claimStateLabel(entry.claim.state)}</span>
      </div>
      <p>提交者：{entry.claimant_name}</p>
      {entry.claim.latest_submission ? (
        <p>
          提交摘要：<span className="multiline-text">{entry.claim.latest_submission.summary}</span>（<code>{entry.claim.latest_submission.artifact_ref}</code>）
        </p>
      ) : (
        <p className="hint">尚無提交成果，無法作成決定。</p>
      )}
      {entry.claim.state === 'submitted' && (
        <div className="actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void beginReview()}>
            開始回饋
          </button>
        </div>
      )}
      {entry.claim.state === 'in_review' && entry.claim.latest_submission && (
        <form className="stack" onSubmit={(event) => void decide(event)}>
          <fieldset className="fieldset">
            <legend>決定</legend>
            <label className="choice">
              <input
                type="radio"
                name={`decision-${entry.claim.claim_id}`}
                checked={decision === 'accept'}
                onChange={() => setDecision('accept')}
                disabled={busy}
              />
              接受這次提交
            </label>
            <label className="choice">
              <input
                type="radio"
                name={`decision-${entry.claim.claim_id}`}
                checked={decision === 'changes_requested'}
                onChange={() => setDecision('changes_requested')}
                disabled={busy}
              />
              請對方調整
            </label>
          </fieldset>
          <label className="field">
            <span className="field-label">回饋說明</span>
            <textarea
              rows={3}
              required
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              disabled={busy}
            />
          </label>
          <button className="btn btn-secondary" type="submit" disabled={busy}>
            送出決定
          </button>
        </form>
      )}
    </article>
  )
}
