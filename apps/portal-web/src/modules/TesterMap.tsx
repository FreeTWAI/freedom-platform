import {accountText} from './tester-map/text';
import type {PortalClient} from '../api';
import {useTesterAccount} from './tester-map/useTesterAccount';
import {TesterAccountContext,TesterAccountPanel,TesterStepFeedback} from './tester-map/TesterAccount';
import {useContext, useEffect, useRef, useState} from 'react';
import {
  ISSUES_URL, REDESIGN_BATCH_PR, TEST_WEEK, TESTER_AREAS, TESTER_COVERAGE_UPDATED_AT, TESTER_FLAGS_OBSERVED_AT,
  TESTER_GROUP_IDS, TESTER_GROUPS, TESTER_GUILD, COVERAGE_STATUSES, QUEST_PATHS, QUEST_STAGES,
  areasForGroup, coverageOf, coverageSummary, isDefaultOff, overallProgress,
  stageProgress, testerMedals, toggleStep,
  type CoverageStatus, type Localized, type QuestStage, type QuestStep, type TesterFeature, type TesterGroupId, type TesterProgress,
} from '../../../../modules/tester-map/index';
import {useLanguage, type InterfaceLanguage} from '../language';
import type {InterfaceMessage} from '../interface-messages';
import './TesterMap.css';

const statusKey: Record<CoverageStatus, InterfaceMessage> = {'未測': 'testerMap.status.untested', '測試中': 'testerMap.status.testing', '已測': 'testerMap.status.tested', '有問題': 'testerMap.status.issue'};
const statusClass: Record<CoverageStatus, string> = {'未測': 'is-untested', '測試中': 'is-testing', '已測': 'is-tested', '有問題': 'is-issue'};
const groupHint: Record<TesterGroupId, InterfaceMessage> = {A: 'testerMap.hintPhone', B: 'testerMap.hintDesktop', C: 'testerMap.hintPhone', D: 'testerMap.hintDesktop', E: 'testerMap.hintAdvanced'};
// Plan data carries its own five translations in the interface catalog order.
const indexes: Record<InterfaceLanguage, number> = {'zh-Hant': 0, en: 1, ja: 2, ko: 3, es: 4};
const featureById = new Map(TESTER_AREAS.flatMap(area => area.features).map(feature => [feature.id, feature]));
const stepFeatures = (step: QuestStep) => step.features.map(id => featureById.get(id)).filter((feature): feature is TesterFeature => Boolean(feature));
const stepHref = (step: QuestStep) => step.href ?? stepFeatures(step).find(feature => feature.href)?.href;
const stepRedesign = (step: QuestStep) => [...new Set(stepFeatures(step).flatMap(feature => feature.redesign ?? []))];

function FeatureRow({feature, pick}: {feature: TesterFeature; pick: (value: Localized) => string}) {
  const {t} = useLanguage();
  const coverage = coverageOf(feature.id), off = isDefaultOff(feature);
  return <li className="tester-map-feature" data-feature-id={feature.id}>
    <div className="tester-map-feature-main">
      <strong>{pick(feature.name)}</strong>
      <span className="tester-map-tags">
        {feature.redesign && <span className="pill pill-green">{t('testerMap.priority')} · {feature.redesign.map(pr => `#${pr}`).join(' ')}</span>}
        {off && <span className="pill">{t('testerMap.off')}</span>}
        {feature.access === 'admin' && <span className="pill">{t('testerMap.admin')}</span>}
        {feature.access === 'guild-manager' && <span className="pill">{t('testerMap.guildManager')}</span>}
        {feature.flag && <code className="tester-map-flag">{feature.flag}</code>}
      </span>
    </div>
    <div className="tester-map-feature-side">
      <span className={`tester-map-status ${statusClass[coverage.status]}`}><span className="sr-only">{t('testerMap.status')}: </span>{t(statusKey[coverage.status])}</span>
      {coverage.issues?.map(number => <a key={number} href={`${ISSUES_URL}/${number}`} target="_blank" rel="noopener noreferrer">#{number}<span className="sr-only"> {t('testerMap.newTab')}</span></a>)}
      {feature.href && <a className="btn btn-ghost btn-small" href={feature.href}>{t('testerMap.open')}</a>}
    </div>
  </li>;
}

function QuestStepItem({step, done, pick, onToggle}: {step: QuestStep; done: boolean; pick: (value: Localized) => string; onToggle: () => void}) {
  const {t} = useLanguage();
  const href = stepHref(step), redesign = stepRedesign(step), titleId = `tester-step-${step.id.replace('.', '-')}`;
  return <li className={`tester-quest-step${done ? ' is-done' : ''}`} data-step-id={step.id} aria-labelledby={titleId}>
    <div className="tester-quest-step-head">
      <h4 id={titleId}>{pick(step.title)}</h4>
      {done && <span className="pill pill-green">{t('testerMap.stepDone')}</span>}
      {redesign.length > 0 && <span className="pill">{t('testerMap.priority')} · {redesign.map(pr => `#${pr}`).join(' ')}</span>}
    </div>
    <dl className="tester-quest-step-body">
      <div><dt>{t('testerMap.stepTry')}</dt><dd>{pick(step.task)}</dd></div>
      <div><dt>{t('testerMap.stepCheck')}</dt><dd>{pick(step.check)}</dd></div>
    </dl>
    <p className="field-hint">{t('testerMap.stepReport')}</p>
    <div className="actions">
      {href && <a className="btn btn-ghost btn-small" href={href}>{t('testerMap.stepOpen')}</a>}
      <button type="button" className={`btn btn-small ${done ? 'btn-ghost' : 'btn-primary'}`} disabled={useContext(TesterAccountContext)?.account.busy} aria-pressed={done} aria-describedby={titleId} onClick={onToggle}>{done ? t('testerMap.markUndone') : t('testerMap.markDone')}</button>
    </div>
    <TesterStepFeedback step={step}/>
  </li>;
}

function QuestStageCard({stage, progress, pick, open, onOpen, onToggle}: {stage: QuestStage; progress: TesterProgress; pick: (value: Localized) => string; open: boolean; onOpen: (open: boolean) => void; onToggle: (step: QuestStep) => void}) {
  const {t} = useLanguage();
  const count = stageProgress(stage, progress);
  return <details className="card tester-quest-stage" data-stage-id={stage.id} open={open} onToggle={event => { const next = event.currentTarget.open; if (next !== open) onOpen(next); }}>
    <summary>
      <span className="tester-quest-stage-name">{pick(stage.name)}</span>
      <span className="tester-quest-stage-count">{count.complete ? t('testerMap.stageComplete') : t('testerMap.stageCount', {done: count.done, total: count.total})}</span>
      <progress max={count.total} value={count.done} aria-label={`${pick(stage.name)} ${t('testerMap.stageCount', {done: count.done, total: count.total})}`}/>
    </summary>
    <ol className="tester-quest-steps">{stage.steps.map(step => <QuestStepItem key={step.id} step={step} done={progress.done.includes(step.id)} pick={pick} onToggle={() => onToggle(step)}/>)}</ol>
  </details>;
}

const firstOpenStage = (progress: TesterProgress) => {
  const order = progress.group ? [...QUEST_PATHS[progress.group], ...QUEST_STAGES.map(stage => stage.id)] : QUEST_STAGES.map(stage => stage.id);
  return order.find(id => !stageProgress(QUEST_STAGES.find(stage => stage.id === id)!, progress).complete) ?? null;
};

/** Guests remain local; the member shell supplies its current authenticated client. */
export function TesterMap({client}: {client?:PortalClient}) {
  const {language, t} = useLanguage();
  const pick = (value: Localized) => value[indexes[language]];
  const account = useTesterAccount(client), {progress} = account;
  const [openStages, setOpenStages] = useState<ReadonlySet<string>>(() => new Set([firstOpenStage(progress)].filter((id): id is string => Boolean(id))));
  const [announcement, setAnnouncement] = useState(''), [confirmReset, setConfirmReset] = useState(false);
  const [inventoryGroup, setInventoryGroup] = useState<TesterGroupId | 'all'>('all'), [priorityOnly, setPriorityOnly] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null), cancelReset = useRef<HTMLButtonElement>(null);
  // The reset button unmounts while confirming; keep keyboard users on the choice they must make.
  useEffect(() => { if (confirmReset) cancelReset.current?.focus(); }, [confirmReset]);
  const save = account.save;
  const toggle = async (step: QuestStep) => {
    const before = new Set(testerMedals(progress).filter(medal => medal.earned).map(medal => medal.id));
    const next = toggleStep(progress, step.id), total = overallProgress(next);
    if (!await save(next)) return;
    const gained = testerMedals(next).filter(medal => medal.earned && !before.has(medal.id)).map(medal => t('testerMap.announceMedal', {medal: pick(medal.name)}));
    const key = next.done.includes(step.id) ? 'testerMap.announceDone' : 'testerMap.announceUndone';
    setAnnouncement([t(key, {step: pick(step.title), done: total.done, total: total.total}), ...gained].join(' '));
  };
  const chooseGroup = async (group: TesterGroupId | null) => {
    const next = {...progress, group};
    if (!await save(next)) return;
    const first = firstOpenStage(next);
    if (first) setOpenStages(value => new Set([...value, first]));
  };
  const reset = async () => {
    if (!await account.reset()) return; setConfirmReset(false); setOpenStages(new Set([QUEST_STAGES[0].id]));
    setAnnouncement(client ? '' : t('testerMap.resetDone'));
    requestAnimationFrame(() => resetButton.current?.focus());
  };
  const overall = overallProgress(progress), medals = testerMedals(progress), earned = medals.filter(medal => medal.earned).length;
  const path = progress.group ? QUEST_PATHS[progress.group] : [];
  const suggested = path.map(id => QUEST_STAGES.find(stage => stage.id === id)!);
  const others = QUEST_STAGES.filter(stage => !path.includes(stage.id));
  const stageCard = (stage: QuestStage) => <QuestStageCard key={stage.id} stage={stage} progress={progress} pick={pick} open={openStages.has(stage.id)}
    onOpen={open => setOpenStages(value => { const next = new Set(value); if (open) next.add(stage.id); else next.delete(stage.id); return next; })} onToggle={toggle}/>;
  const summary = coverageSummary();
  const areas = areasForGroup(inventoryGroup).map(area => ({...area, features: priorityOnly ? area.features.filter(feature => feature.redesign) : area.features})).filter(area => area.features.length > 0);
  return <TesterAccountContext.Provider value={{account,client}}><section className="module-panel tester-map stack">
    {!account.working&&progress.done.length===0&&!(account.view?.feedback.length)&&<section className="card stack" aria-labelledby="tester-start-title">
      <h2 id="tester-start-title">{pick(accountText.start)}</h2>
      <ol><li>{pick(accountText.startRoute)}</li><li>{pick(accountText.startTry)}</li><li>{pick(accountText.startSend)}</li></ol>
      <p>{pick(accountText.optional)}</p>
      <button className="btn btn-primary" type="button" onClick={()=>{
        const id=firstOpenStage(progress);if(!id)return;
        setOpenStages(value=>new Set([...value,id]));
        requestAnimationFrame(()=>{const step=document.querySelector<HTMLElement>(`[data-stage-id="${id}"] [data-step-id]`);step?.scrollIntoView({block:'start'});step?.querySelector<HTMLElement>('a,button')?.focus({preventScroll:true});});
      }}>{pick(accountText.firstStep)}</button>
    </section>}
    <section className="card stack" aria-labelledby="tester-map-intro">
      <p className="eyebrow" id="tester-map-intro">{t('testerMap.eyebrow')}</p>
      <p>{t('testerMap.intro', {start: TEST_WEEK.start, end: TEST_WEEK.end, leader: TESTER_GUILD.leaderNickname})}</p>
      <p className="field-hint">{t('testerMap.redesign', {pr: REDESIGN_BATCH_PR})}</p>
    </section>

    <section className="stack tester-quest" aria-labelledby="tester-quest-title">
      <h2 id="tester-quest-title">{t('testerMap.quest')}</h2>
      <p>{t('testerMap.questIntro')}</p>
      <TesterAccountPanel account={account} client={client}/>
      <fieldset className="card tester-quest-groups">
        <legend>{t('testerMap.chooseGroup')}</legend>
        <label className="tester-quest-group"><input type="radio" name="tester-group" disabled={account.busy} checked={progress.group === null} onChange={() => chooseGroup(null)}/><span><strong>{t('testerMap.noGroup')}</strong></span></label>
        {TESTER_GROUP_IDS.map(id => <label key={id} className="tester-quest-group"><input type="radio" name="tester-group" disabled={account.busy} checked={progress.group === id} onChange={() => chooseGroup(id)}/>
          <span><strong>{id} · {pick(TESTER_GROUPS[id].name)}</strong><span className="field-hint">{pick(TESTER_GROUPS[id].detail)}</span></span></label>)}
      </fieldset>
      <div className="card stack tester-quest-overall">
        <p className="tester-quest-overall-text"><strong>{t('testerMap.overall', {done: overall.done, total: overall.total})}</strong></p>
        <progress max={overall.total} value={overall.done} aria-label={t('testerMap.overall', {done: overall.done, total: overall.total})}/>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      </div>
      {progress.group ? <>
        <h3>{t('testerMap.suggested')}</h3>
        <p className="field-hint">{t(groupHint[progress.group])}</p>
        {suggested.map(stageCard)}
        {others.length > 0 && <h3>{t('testerMap.otherStages')}</h3>}
        {others.map(stageCard)}
      </> : QUEST_STAGES.map(stageCard)}
    </section>

    <section className="card stack" aria-labelledby="tester-medals-title">
      <h2 id="tester-medals-title">{t('testerMap.medals')}</h2>
      <p className="field-hint">{t('testerMap.medalCount', {earned, total: medals.length})}</p>
      <ul className="tester-medals">{medals.map(medal => <li key={medal.id} className={`tester-medal${medal.earned ? ' is-earned' : ''}`} data-medal-id={medal.id}>
        <span className="tester-medal-mark" aria-hidden="true">{medal.earned ? '★' : '☆'}</span>
        <span><strong>{pick(medal.name)}</strong><span className="tester-medal-rule">{medal.stage ? t('testerMap.medalStage', {stage: pick(medal.stage.name)}) : medal.rule ? pick(medal.rule) : ''}</span></span>
        <span className="tester-medal-state">{medal.earned ? t('testerMap.medalEarned') : t('testerMap.medalLocked')}</span>
      </li>)}</ul>

      <div className="actions">{confirmReset ? <>
        <span role="alert">{client ? pick(accountText.clearAsk) : t('testerMap.resetAsk')}</span>
        <button type="button" className="btn btn-ghost btn-small" disabled={account.busy} onClick={reset}>{t('testerMap.resetConfirm')}</button>
        <button ref={cancelReset} type="button" className="btn btn-ghost btn-small" onClick={() => { setConfirmReset(false); requestAnimationFrame(() => resetButton.current?.focus()); }}>{t('testerMap.resetCancel')}</button>
      </> : <button ref={resetButton} type="button" className="btn btn-ghost btn-small" disabled={account.busy} onClick={() => setConfirmReset(true)}>{client ? pick(accountText.clear) : t('testerMap.reset')}</button>}</div>
    </section>

    <div className="tester-map-howto">
      <section className="card stack" aria-labelledby="tester-map-join">
        <h2 id="tester-map-join">{t('testerMap.join')}</h2>
        <p>{t('testerMap.joinBody')}</p>
        <div className="actions"><a className="btn btn-ghost btn-small" href={`#guilds/${TESTER_GUILD.key}`}>{t('testerMap.guildPage')}</a><a className="btn btn-ghost btn-small" href="#community">{t('testerMap.communityPage')}</a></div>
      </section>
      <section className="card stack" aria-labelledby="tester-map-report">
        <h2 id="tester-map-report">{t('testerMap.report')}</h2>
        <ol className="tester-map-steps"><li>{t('testerMap.reportSearch')}</li><li>{t('testerMap.reportTool')}</li><li>{t('testerMap.reportWhat')}</li><li>{t('testerMap.reportPrivacy')}</li></ol>
        <p className="banner banner-info">{t('testerMap.reportNoReporting')}</p>
        <div className="actions"><a className="btn btn-ghost btn-small" href={ISSUES_URL} target="_blank" rel="noopener noreferrer">{t('testerMap.issues')} <span aria-hidden="true">↗</span><span className="sr-only">{t('testerMap.newTab')}</span></a></div>
      </section>
    </div>

    <section className="stack" aria-labelledby="tester-map-inventory">
      <h2 id="tester-map-inventory">{t('testerMap.inventory')}</h2>
      <p className="field-hint">{t('testerMap.inventoryIntro')}</p>
      <p className="field-hint">{t('testerMap.flagsNote', {date: TESTER_FLAGS_OBSERVED_AT})}</p>
      <section className="card stack" aria-labelledby="tester-map-progress">
        <h3 id="tester-map-progress">{t('testerMap.progress')}</h3>
        <ul className="tester-map-summary">{COVERAGE_STATUSES.map(status => <li key={status}><span className={`tester-map-status ${statusClass[status]}`}>{t(statusKey[status])}</span> <strong>{summary[status]}</strong></li>)}</ul>
        <p className="field-hint">{t('testerMap.updated', {date: TESTER_COVERAGE_UPDATED_AT})}</p>
      </section>
      <div className="tester-map-filters">
        <span className="tester-map-select"><label htmlFor="tester-map-group-filter">{t('testerMap.filterGroup')}</label><select id="tester-map-group-filter" value={inventoryGroup} onChange={event => setInventoryGroup(event.target.value as TesterGroupId | 'all')}>
          <option value="all">{t('testerMap.allGroups')}</option>
          {TESTER_GROUP_IDS.map(id => <option key={id} value={id}>{id} · {pick(TESTER_GROUPS[id].name)}</option>)}
        </select></span>
        <label className="tester-map-check"><input type="checkbox" checked={priorityOnly} onChange={event => setPriorityOnly(event.target.checked)}/>{t('testerMap.priorityOnly')}</label>
      </div>
      {areas.length === 0 && <p role="status">{t('testerMap.empty')}</p>}
      {areas.map(area => <section key={area.id} className="card stack tester-map-area" aria-labelledby={`tester-map-area-${area.id}`} data-area-id={area.id}>
        <header className="tester-map-area-head">
          <h3 id={`tester-map-area-${area.id}`}>{pick(area.name)}</h3>
          <p className="tester-map-owners"><span>{t('testerMap.owners')}</span> {area.owners.map(owner => <span key={owner} className="chip">{owner} · {pick(TESTER_GROUPS[owner].name)}</span>)}</p>
        </header>
        <p className="field-hint">{pick(area.summary)}</p>
        <ul className="tester-map-features">{area.features.map(feature => <FeatureRow key={feature.id} feature={feature} pick={pick}/>)}</ul>
      </section>)}
    </section>
  </section></TesterAccountContext.Provider>;
}
