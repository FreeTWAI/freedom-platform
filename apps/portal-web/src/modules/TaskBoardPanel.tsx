import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {requireCursorPage,requireItems,type PortalClient} from '../api';
import type { TabId, WorkItem } from '../types';
import { formatIsoLocal } from '../format';
import { CommunityHistory } from './CommunityHistory';
import {MemberContributionOutcomes,WorkContributionRoles} from './ContributionOutcomes';
import {appendTaskItems,createTaskRead} from './task-board-loading';
import './MemberExperience.css';

type Project = {project_id:string;title:string;goal:string;repository_url:string;repository_full_name:string};
type Issue = {number:number;title:string;url:string;labels:string[];assignees:string[]};
type Activity = {issues:Issue[];checked_at:string;truncated:boolean;stale_reason?:'github_rate_limited';unavailable_reason?:'github_sync_pending'|'github_unreadable'};
type WorkPage = {filterKey:string;items:WorkItem[];next_cursor:string|null};
type Props = {client:PortalClient;onNavigate:(tab:TabId)=>void};
const safeGitHub=(url:string)=>{try{const parsed=new URL(url);return parsed.protocol==='https:'&&parsed.hostname==='github.com'&&!parsed.username&&!parsed.password?url:null;}catch{return null;}};

export function TaskBoardPanel(props: Props) {
  // Reset private projections and search/selection when the member lifetime changes.
  return <TaskBoardContent key={props.client.sessionGeneration} {...props}/>;
}

function TaskBoardContent({client,onNavigate}: Props) {
  const generation = client.sessionGeneration;
  const reads = useMemo(() => ({
    work: createTaskRead<WorkPage>(() => client.sessionGeneration),
    projects: createTaskRead<Project[]>(() => client.sessionGeneration),
    activity: createTaskRead<Activity>(() => client.sessionGeneration),
  }), [client,generation]);
  const work = useSyncExternalStore(reads.work.subscribe,reads.work.getSnapshot,reads.work.getSnapshot);
  const projectRead = useSyncExternalStore(reads.projects.subscribe,reads.projects.getSnapshot,reads.projects.getSnapshot);
  const activityRead = useSyncExternalStore(reads.activity.subscribe,reads.activity.getSnapshot,reads.activity.getSnapshot);
  const [outcomeRevision,setOutcomeRevision]=useState(0);
  const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[scope,setScope]=useState<'open'|'all'>('open');
  const [selected,setSelected]=useState(''),[composing,setComposing]=useState(false);
  const composition = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterKey = JSON.stringify([scope,search]);
  const page = work.value?.filterKey === filterKey ? work.value : null;
  const projects = projectRead.value ?? [];
  const selectedProject = projects.find(project=>project.project_id===selected);
  const activity = activityRead.key === selected ? activityRead.value : null;
  const loadingMore = work.status === 'loading' && work.key !== filterKey && page !== null;
  const sameFilter = work.key === filterKey || work.key?.startsWith(`["more",${JSON.stringify(filterKey)},`) === true;
  const error = work.status === 'error' && sameFilter && (!page || work.key === filterKey) ? '社群工作暫時無法載入。' : '';
  const pageError = work.status === 'error' && work.key !== filterKey && page ? '較早的工坊工作暫時無法載入。' : '';
  const loading = !composing && ((work.status === 'loading' && work.key === filterKey) || (!page && !error));
  const visibleWorks = page?.items ?? [];
  const nextCursor = page?.next_cursor ?? null;
  const projectLoading = projectRead.status === 'idle' || projectRead.status === 'loading';
  const activityLoading = Boolean(selected && selectedProject && (activityRead.key !== selected || activityRead.status === 'loading'));
  const activityError = activityRead.key === selected && activityRead.status === 'error'
    ? (activityRead.error instanceof Error ? activityRead.error.message : 'Issue 暫時無法載入。') : '';
  const stopSearchTimer = useCallback(() => {
    if (searchTimer.current !== null) clearTimeout(searchTimer.current);
    searchTimer.current = null;
  }, []);

  const loadWorks = useCallback(() => reads.work.run(filterKey,async signal => {
    const params = new URLSearchParams({scope,search});
    const value = requireCursorPage<WorkItem>(await client.get<unknown>(`/work-items/page?${params}`,{signal}),'工作列表');
    return {filterKey,...value};
  }, {retain: reads.work.getSnapshot().value?.filterKey === filterKey}), [client,reads,filterKey,scope,search]);

  // Project choices do not depend on the work filter. Search must not re-fetch them.
  const loadProjects = useCallback(() => reads.projects.run('projects',async signal =>
    requireItems<Project>(await client.get<unknown>('/co-creation/projects',{signal}),'共創專案'),
  {retain:true,retainOnError:true}), [client,reads]);
  const loadActivity = useCallback((id:string) => reads.activity.run(id,async signal => {
    const value = await client.get<Activity>(`/co-creation/projects/${encodeURIComponent(id)}/activity`,{signal});
    if (!Array.isArray(value?.issues)) throw new Error('Issue 回應格式不正確，請重新讀取。');
    return value;
  }, {retain:reads.activity.getSnapshot().key===id}), [client,reads]);

  useEffect(() => {
    searchTimer.current = setTimeout(() => {searchTimer.current=null;void loadWorks();},search?250:0);
    return () => {stopSearchTimer();reads.work.cancel();};
  }, [loadWorks,search,reads,stopSearchTimer]);
  useEffect(() => {
    void loadProjects();
    return () => {reads.projects.reset();};
  }, [loadProjects,reads]);
  useEffect(() => {
    if (!selectedProject) {reads.activity.reset();return;}
    void loadActivity(selectedProject.project_id);
    return () => {reads.activity.cancel();};
  }, [selectedProject?.project_id,loadActivity,reads]);
  useEffect(() => {
    if (projectRead.status==='ready' && selected && !selectedProject) setSelected('');
  }, [projectRead.status,selected,selectedProject]);
  useEffect(() => () => {stopSearchTimer();reads.work.reset();reads.activity.reset();},[reads,stopSearchTimer]);

  function loadMore() {
    // Use the lane snapshot, not only React state, to close rapid-click races.
    const snapshot = reads.work.getSnapshot();
    const previous = snapshot.value;
    if (composing || snapshot.status==='loading' || previous?.filterKey!==filterKey || !previous.next_cursor) return;
    const cursor = previous.next_cursor;
    void reads.work.run(JSON.stringify(['more',filterKey,cursor]),async signal => {
      const params = new URLSearchParams({scope,search,cursor});
      const next = requireCursorPage<WorkItem>(await client.get<unknown>(`/work-items/page?${params}`,{signal}),'工作列表');
      if (next.next_cursor===cursor) throw new Error('工作列表分頁未前進。');
      return {filterKey,items:appendTaskItems(previous.items,next.items),next_cursor:next.next_cursor};
    },{retain:true,retainOnError:true});
  }
  function changeQuery(value:string) {
    setQuery(value);
    if (composition.current) return;
    if (value.trim()!==search) {stopSearchTimer();reads.work.cancel();setSearch(value.trim());}
  }
  function refresh() {
    if (composition.current) return;
    stopSearchTimer();
    void loadWorks();void loadProjects();
    if (selectedProject) void loadActivity(selectedProject.project_id);
  }
  const term=search.toLocaleLowerCase();
  const visibleIssues=(activity?.issues??[]).filter(issue=>!term||[issue.title,...issue.labels].join(' ').toLocaleLowerCase().includes(term));
  const repositoryUrl=safeGitHub(selectedProject?.repository_url??'');
  return <section className="experience-panel stack" aria-label="社群任務">
    <div className="experience-intro"><div><p className="eyebrow">COMMUNITY TASKS</p><h2>從一件做得到的事開始共創。</h2><p>社群工作在工坊認領與驗收；GitHub Issue 依專案原始紀錄協作。兩種來源各自保留實際狀態。</p></div></div>
    <div className="card"><MemberContributionOutcomes client={client} revision={outcomeRevision}/></div>
    <form className="experience-filters" onSubmit={event=>{event.preventDefault();if(!composition.current){stopSearchTimer();void loadWorks();}}}>
      <label className="field">搜尋任務<input data-guide-anchor="tasks:search" type="search" maxLength={2000} value={query}
        onChange={event=>changeQuery(event.target.value)}
        onCompositionStart={()=>{composition.current=true;setComposing(true);}}
        onCompositionEnd={event=>{composition.current=false;setComposing(false);changeQuery(event.currentTarget.value);}}
        onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||composition.current))event.preventDefault();}}
        placeholder="例如：設計、文件、開發"/></label>
      <label className="field">工坊工作狀態<select value={scope} onChange={event=>{const value=event.target.value as 'open'|'all';if(value!==scope){stopSearchTimer();reads.work.cancel();setScope(value);}}}><option value="open">可認領</option><option value="all">全部</option></select></label>
      <button type="button" className="btn btn-ghost" disabled={composing} onClick={refresh}>重新整理</button>
      {query&&<button type="button" className="btn btn-ghost btn-small" disabled={composing} onClick={()=>changeQuery('')}>清除搜尋</button>}
    </form>
    {composing&&<p className="field-hint" role="status">輸入完成後會自動搜尋。</p>}
    <section className="stack" aria-label="工坊工作列表" aria-busy={loading||loadingMore}>
      {error&&<div role="alert" className="banner banner-error"><p>{error}</p><button type="button" className="btn btn-ghost btn-small" onClick={()=>{stopSearchTimer();void loadWorks();}}>重新載入工坊工作</button></div>}
      {loading&&<p role="status">{page?'正在更新任務，以下為上次載入的資料…':'正在載入任務…'}</p>}
      <div className="experience-heading"><h2>工坊工作</h2><span>{page?`${visibleWorks.length} 件`:(loading?'讀取中':error?'暫時無法讀取':'—')}</span></div>
      {visibleWorks.length?<div className="experience-grid">{visibleWorks.map(item=><article className="card experience-card" key={item.work_item_id}><div className="experience-card-head"><div><span className="experience-kicker">{item.state==='open'?'開放認領':item.state==='accepted'?'已驗收':'認領中'}</span><h3>{item.title}</h3></div></div><p className="multiline-text">{item.objective}</p><p><strong>參與收穫：</strong><span className="multiline-text">{item.gain}</span></p><p className="muted">認領期限：{formatIsoLocal(item.claim_window_expires_at)}</p><WorkContributionRoles client={client} workItemId={item.work_item_id} onChanged={()=>setOutcomeRevision(value=>value+1)}/><div className="experience-actions"><button className="btn btn-primary" type="button" onClick={()=>onNavigate('workbench')}>{item.state==='open'?'查看並認領':'查看工作紀錄'}</button></div></article>)}</div>:page&&!loading&&!error&&!pageError&&!composing&&<p className="empty">目前沒有符合條件的工坊工作。</p>}
      {pageError&&<p role="alert" className="banner banner-error">{pageError}已載入的工作仍保留，可以重試。</p>}
      {nextCursor&&<div className="actions"><button type="button" className="btn btn-secondary btn-small" disabled={loading||loadingMore||composing} onClick={loadMore}>{loadingMore?'正在載入…':pageError?'重試載入較早的工坊工作':'載入較早的工坊工作'}</button></div>}
    </section>
    <section className="stack" aria-label="GitHub 共創專案" aria-busy={projectLoading}>
      <div className="experience-heading"><h2>GitHub 共創 Issue</h2><span>以原專案為準</span></div>
      {projectLoading&&<p role="status">正在載入共創專案…</p>}
      {projectRead.status==='error'&&<div role="alert" className="banner banner-error"><p>GitHub 共創專案暫時無法載入。</p><button type="button" className="btn btn-ghost btn-small" onClick={()=>void loadProjects()}>重新載入共創專案</button></div>}
      {projectRead.status==='ready'&&!projects.length&&<p className="empty">目前沒有共創專案。</p>}
      <label className="field experience-project-picker">選擇共創專案<select data-guide-anchor="tasks:project" disabled={!projects.length} value={selectedProject?selected:''} onChange={event=>{if(event.target.value!==selected){reads.activity.cancel();setSelected(event.target.value);}}}><option value="">選擇專案以查看 Issue</option>{projects.map(project=><option key={project.project_id} value={project.project_id}>{project.title}</option>)}</select></label>
      {selectedProject&&<><p className="muted multiline-text">{selectedProject.goal}</p>{activityLoading&&<p role="status">正在讀取 GitHub Issue…</p>}{activityError&&<div role="alert" className="banner banner-error"><p>{activityError}</p><button type="button" className="btn btn-ghost btn-small" onClick={()=>void loadActivity(selected)}>重新讀取 Issue</button></div>}{activity?.unavailable_reason&&<p role="status" className="banner banner-info">{activity.unavailable_reason==='github_unreadable'?'目前無法同步這個 GitHub 儲存庫。請直接到 GitHub 查看。':'GitHub 資料同步中，這次還無法確認任務清單。請直接到 GitHub 查看，或稍後再回來。'}</p>}{activity&&!activity.unavailable_reason&&<>{activity.stale_reason==='github_rate_limited'&&<p role="status" className="banner banner-info">GitHub 暫時限制查詢；以下是 {formatIsoLocal(activity.checked_at)} 讀取的資料，可能已有變更。</p>}{activity.truncated&&<p className="banner banner-info">顯示部分 Issue；完整清單請開啟 GitHub 專案。</p>}{visibleIssues.length?<div className="experience-grid">{visibleIssues.map(issue=><article className="card experience-card" key={issue.number}><span className="experience-kicker">Issue #{issue.number} · {issue.assignees.length?'已有認領者':'尚無認領者'}</span><h3>{issue.title}</h3>{issue.labels.length>0&&<p className="muted">{issue.labels.join(' · ')}</p>}<div className="experience-actions">{safeGitHub(issue.url)&&<a className="btn btn-ghost" href={issue.url} target="_blank" rel="noopener noreferrer">到 GitHub 查看 ↗</a>}</div></article>)}</div>:!activityLoading&&<p className="empty">這個專案目前沒有符合搜尋的開放 Issue。</p>}</>}{repositoryUrl&&<a className="experience-source" href={repositoryUrl} target="_blank" rel="noopener noreferrer">查看完整 GitHub 專案 ↗</a>}</>}
    </section>
    <CommunityHistory client={client}/>
  </section>;
}
