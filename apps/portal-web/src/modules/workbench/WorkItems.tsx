import React, { useState } from 'react'
import { client, usePortal, isOwnRef, type PortalContextValue } from '../../portal-session'
import { BenefitObservations } from '../BenefitObservations'
import { WorkContributionRoles } from '../ContributionOutcomes'
import { claimStateLabel, formatIsoLocal, isPastIso, looksLikeUrl, participationModeLabel, workStateLabel } from '../../format'
import type { WorkClaim, WorkItem } from '../../types'

export function WorkItemList({
  items,
  empty,
  pending,
  mutate,
  onChanged,
}: {
  items: WorkItem[]
  empty: string
  pending: string | null
  mutate: PortalContextValue['mutate']
  onChanged: () => Promise<void>
}) {
  if (items.length === 0) return <p className="empty">{empty}</p>
  return (
    <div className="card-grid">
      {items.map((item) => (
        <WorkItemCard key={item.work_item_id} item={item} pending={pending} mutate={mutate} onChanged={onChanged} primaryAction={false} />
      ))}
    </div>
  )
}

export function WorkItemCard({
  item,
  pending,
  mutate,
  onChanged,
  primaryAction = true,
}: {
  item: WorkItem
  pending: string | null
  mutate: PortalContextValue['mutate']
  onChanged: () => Promise<void>
  primaryAction?: boolean
}) {
  const { session } = usePortal()
  const claim = item.my_claim
  const busy = Boolean(pending)
  const claimExpired = isPastIso(item.claim_window_expires_at)
  const [summary, setSummary] = useState('')
  const [artifactRef, setArtifactRef] = useState('artifact:template-v1')
  const [formError, setFormError] = useState<string | null>(null)

  async function claimItem() {
    if (!session.user.profession_membership_ref) return
    const ok = await mutate(`claim:${item.work_item_id}`, async (key) => {
      await client.post<WorkClaim>(
        `/work-items/${item.work_item_id}:claim`,
        {
          claimant_type: 'user',
          acting_profession_membership_ref: session.user.profession_membership_ref,
          expected_aggregate_version: item.aggregate_version,
          terms_status: 'declared',
          participation_terms_revision: item.participation_terms_revision,
          participation_terms_sha256: item.participation_terms_sha256,
        },
        { idempotencyKey: key, ifMatch: item.aggregate_version },
      )
    })
    if (ok) await onChanged()
  }

  async function startClaim() {
    if (!claim) return
    const ok = await mutate(`start:${claim.claim_id}`, async (key) => {
      await client.post(`/work-claims/${claim.claim_id}:start`, {}, { idempotencyKey: key, ifMatch: claim.aggregate_version })
    })
    if (ok) await onChanged()
  }

  async function submitClaim(event: React.FormEvent) {
    event.preventDefault()
    if (!claim) return
    setFormError(null)
    const artifact = artifactRef.trim()
    if (!artifact || looksLikeUrl(artifact)) {
      setFormError('成果引用須為不透明代號，例如 artifact:template-v1，不可填網址或私人資料')
      return
    }
    const ok = await mutate(`submit:${claim.claim_id}`, async (key) => {
      await client.post(
        `/work-claims/${claim.claim_id}:submit`,
        { summary: summary.trim(), artifact_ref: artifact },
        { idempotencyKey: key, ifMatch: claim.aggregate_version },
      )
    })
    if (ok) {
      setSummary('')
      await onChanged()
    }
  }

  return (
    <article className="card">
      <div className="card-head">
        <h3>{item.title}</h3>
        <div className="pill-row">
          <span className="pill">{workStateLabel(item.state)}</span>
          {claim && <span className="pill pill-green">{claimStateLabel(claim.state)}</span>}
          {item.review_capacity === 'waiting_reviewer_capacity' && <span className="pill">尚無回饋容量</span>}
        </div>
      </div>
      <p className="multiline-text">{item.objective}</p>
      <dl className="meta">
        <div>
          <dt>完成條件</dt>
          <dd className="multiline-text">{item.acceptance_criteria}</dd>
        </div>
        <div>
          <dt>幫助者當次收益</dt>
          <dd className="multiline-text">{item.gain}</dd>
        </div>
        <div>
          <dt>認領期限</dt>
          <dd>{formatIsoLocal(item.claim_window_expires_at)}</dd>
        </div>
        <div>
          <dt>完成期限</dt>
          <dd>{formatIsoLocal(item.due_at)}</dd>
        </div>
        {item.participation_terms?.participation_mode && (
          <div>
            <dt>參與方式</dt>
            <dd>{participationModeLabel(item.participation_terms.participation_mode)}</dd>
          </div>
        )}
      </dl>
      {item.participation_terms?.reuse?.consent_required && <p className="hint">{!item.participation_terms.reuse.artifact_license_ref||item.participation_terms.reuse.artifact_license_ref==='local-demo-author-consent'?'成果重用前仍需取得權利人同意；目前未記錄明確授權。':'成果重用前請確認記錄的授權與權利人同意。'}</p>}
      {item.review_capacity === 'waiting_reviewer_capacity' && (
        <p className="hint">目前沒有回饋容量，仍可認領與提交，但不保證有人回饋，也不表示官方品管。</p>
      )}
      {claim?.feedback && (
        <p className="feedback">
          <strong>回饋：</strong>
          <span className="multiline-text">{claim.feedback}</span>
        </p>
      )}
      {claim?.latest_submission && (
        <p className="hint">
          最近提交：<span className="multiline-text">{claim.latest_submission.summary}</span>（<code>{claim.latest_submission.artifact_ref}</code>）
        </p>
      )}
      {!claim && item.state === 'open' && item.owner_ref !== session.user.user_id && (
        <div className="actions">
          <button
            type="button"
            className={`btn ${primaryAction ? 'btn-primary' : 'btn-secondary'}`}
            disabled={busy || claimExpired || !session.user.profession_membership_ref}
            onClick={() => void claimItem()}
          >
            認領這張工作
          </button>
          {claimExpired && <p className="hint">認領期限已過。</p>}
          {!session.user.profession_membership_ref && <p className="hint">先到「職業公會」加入一個公會，才能以該職業身分認領。</p>}
        </div>
      )}
      {!claim && item.state === 'open' && isOwnRef(session.user, item.owner_ref) && <p className="hint">這是你發布的工作，等待夥伴自願認領。</p>}
      {claim?.state === 'claimed' && (
        <div className="actions">
          <button type="button" className={`btn ${primaryAction ? 'btn-primary' : 'btn-secondary'}`} disabled={busy} onClick={() => void startClaim()}>
            開始進行
          </button>
        </div>
      )}
      {claim && (claim.state === 'in_progress' || claim.state === 'changes_requested') && (
        <form className="stack" onSubmit={(event) => void submitClaim(event)}>
          {formError && (
            <p className="banner banner-error" role="alert">
              {formError}
            </p>
          )}
          <label className="field">
            <span className="field-label">提交摘要</span>
            <textarea required rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} disabled={busy} />
          </label>
          <label className="field">
            <span className="field-label">成果引用（例如 artifact:template-v1）</span>
            <input
              required
              value={artifactRef}
              onChange={(event) => setArtifactRef(event.target.value)}
              disabled={busy}
              placeholder="artifact:template-v1"
            />
            <span className="field-hint">填成果代號，例如 artifact:logo-v1。檔案另行分享，別貼含登入權限的連結或私人資料。</span>
          </label>
          <button className={`btn ${primaryAction ? 'btn-primary' : 'btn-secondary'}`} type="submit" disabled={busy}>
            提交成果
          </button>
        </form>
      )}
      {claim?.state === 'submitted' && <p className="hint">已提交，等待回饋。</p>}
      {claim?.state === 'in_review' && <p className="hint">回饋進行中。</p>}
      {claim?.state === 'accepted' && <p className="hint">這次提交已被接受，非正式官方品管。</p>}
      {(isOwnRef(session.user,item.owner_ref)||(claim&&claim.state!=='claimed'))&&<BenefitObservations client={client} workItemId={item.work_item_id}/>}
      <WorkContributionRoles client={client} workItemId={item.work_item_id}/>
    </article>
  )
}
