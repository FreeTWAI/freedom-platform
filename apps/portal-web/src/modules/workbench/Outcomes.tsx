import React from 'react'
import { client } from '../../portal-session'
import { Section } from '../../portal-feedback'
import { BenefitObservations } from '../BenefitObservations'
import { WorkContributionRoles } from '../ContributionOutcomes'
import { formatIsoLocal } from '../../format'
import type { Dashboard } from '../../types'

export function OutcomeSummaryStrip({ acceptedCount }: { acceptedCount: number }) {
  return (
    <section className="summary-strip" aria-label="成果摘要">
      <div>
        <span className="summary-label">已接受成果</span>
        <strong>{acceptedCount}</strong>
      </div>
      <p>合作當事人確認，非官方認證。</p>
    </section>
  )
}

export function OutcomesList({ gained }: { gained: Dashboard['gained'] }) {
  return (
    <Section title="已獲得的成果" description="當事人確認，非官方標示。">
      {gained.length === 0 ? (
        <p className="empty">還沒有已接受的成果。</p>
      ) : (
        <div className="card-grid">
          {gained.map((gain) => (
            <article key={gain.contribution_id} className="card">
              <h3>{gain.title}</h3>
              <p className="multiline-text">{gain.summary}</p>
              <dl className="meta">
                <div>
                  <dt>成果引用</dt>
                  <dd>
                    <code>{gain.artifact_ref}</code>
                  </dd>
                </div>
                <div>
                  <dt>接受時間</dt>
                  <dd>{formatIsoLocal(gain.accepted_at)}</dd>
                </div>
              </dl>
              <BenefitObservations client={client} workItemId={gain.work_item_id}/>
              <WorkContributionRoles client={client} workItemId={gain.work_item_id}/>
            </article>
          ))}
        </div>
      )}
    </Section>
  )
}

export function Outcomes({ acceptedCount, gained }: { acceptedCount: number; gained: Dashboard['gained'] }) {
  return (
    <>
      <OutcomeSummaryStrip acceptedCount={acceptedCount} />
      <OutcomesList gained={gained} />
    </>
  )
}
