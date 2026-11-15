import {storeNextSteps, type StoreNextStepsInput} from './hosted-store-next-steps';

export type HostedStoreNextStepsProps = StoreNextStepsInput & {
  area: 'products' | 'cooperation' | 'publish' | 'settings';
  onNext: (nextArea: 'products' | 'publish') => void;
};

/** Continuing onboarding checklist for a newly created retail store before its first publication. */
export function HostedStoreNextSteps({
  publicationState,
  productCount,
  writable,
  canWrite,
  canPublish,
  area,
  onNext,
}: HostedStoreNextStepsProps) {
  const plan = storeNextSteps({publicationState, productCount, writable, canWrite, canPublish});
  if (!plan) return null;
  const {steps, current, next} = plan;
  return (
    <section className="hosted-store-next-steps" aria-label="開店步驟">
      <ol>
        {steps.map(step => (
          <li
            key={step.key}
            data-done={step.done}
            aria-current={step.key === current ? 'step' : undefined}
          >
            {step.done && <span className="sr-only">已完成：</span>}
            {step.text}
          </li>
        ))}
      </ol>
      {next && next !== area && (
        <button type="button" className="btn btn-primary btn-small" onClick={() => onNext(next)}>
          前往下一步
        </button>
      )}
    </section>
  );
}
