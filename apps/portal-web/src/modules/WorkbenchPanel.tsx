import './WorkbenchPanel.css'
import React, { useCallback, useEffect, useState } from 'react'
import { requireCursorPage, requireDashboard } from '../api'
import { client, usePortal, describeError, type ActionError } from '../portal-session'
import { Section, ErrorPanel } from '../portal-feedback'
import { ModuleBanner } from './ModuleBanner'
import { CreateWorkForm } from './workbench/CreateWorkForm'
import { Outcomes } from './workbench/Outcomes'
import { ReviewQueue } from './workbench/ReviewQueue'
import { WorkItemCard, WorkItemList } from './workbench/WorkItems'
import type { Dashboard, WorkItem } from '../types'

type WorkbenchView = 'mine' | 'community' | 'review' | 'outcomes'

export function WorkbenchPanel({selectedId}:{selectedId?:string}) {
  const { session, pending, mutate } = usePortal()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<ActionError | null>(null)
  const [pageError, setPageError] = useState('')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [items, setItems] = useState<WorkItem[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [view, setView] = useState<WorkbenchView>('mine')
  const [createdStatus, setCreatedStatus] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setPageError('')
    try {
      const [dashPayload, itemsPayload] = await Promise.all([
        client.get<unknown>('/dashboard'),
        client.get<unknown>('/work-items/page'),
      ])
      let page=requireCursorPage<WorkItem>(itemsPayload,'工作列表')
      if(selectedId){
        const seen=new Set<string>();
        while(!page.items.some(item=>item.work_item_id===selectedId)&&page.next_cursor&&!seen.has(page.next_cursor)){
          seen.add(page.next_cursor);
          const next=requireCursorPage<WorkItem>(await client.get<unknown>(`/work-items/page?cursor=${encodeURIComponent(page.next_cursor)}`),'工作列表');
          page={...next,items:[...page.items,...next.items]};
        }
      }
      setDashboard(requireDashboard<Dashboard>(dashPayload))
      setItems(page.items)
      setNextCursor(page.next_cursor)
    } catch (err) {
      setDashboard(null)
      setItems(null)
      setNextCursor(null)
      setLoadError(describeError(err))
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  async function loadMore() {
    if(!nextCursor||loadingMore)return
    setLoadingMore(true)
    setPageError('')
    try {
      const page=requireCursorPage<WorkItem>(await client.get<unknown>(`/work-items/page?cursor=${encodeURIComponent(nextCursor)}`),'工作列表')
      setItems(current=>{
        if(!current)return page.items
        const known=new Set(current.map(item=>item.work_item_id))
        return [...current,...page.items.filter(item=>!known.has(item.work_item_id))]
      })
      setNextCursor(page.next_cursor)
    } catch {
      setPageError('較早的社群工作暫時無法載入。')
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load, session.user.user_id])

  useEffect(() => {
    if (dashboard && dashboard.review_queue.length === 0 && view === 'review') {
      setView('mine')
    }
  }, [dashboard, view])

  if (loading && !dashboard) {
    return <p className="muted" role="status">載入工作台…</p>
  }
  if (loadError || !dashboard || !items) {
    return <ErrorPanel error={loadError ?? { message: '無法顯示工作台', network: false, conflict: false }} onReload={() => void load()} />
  }

  if(selectedId){
    const selected=[...dashboard.now,...dashboard.next,...items].find(item=>item.work_item_id===selectedId);
    return selected?<WorkItemCard key={selected.work_item_id} item={selected} pending={pending} mutate={mutate} onChanged={load}/>:<p role="status">找不到這項工作。</p>;
  }
  const seen = new Set([...dashboard.now, ...dashboard.next].map((item) => item.work_item_id))
  const catalog = items.filter((item) => !item.my_claim && !seen.has(item.work_item_id))
  const reviewCount = dashboard.review_queue.length
  const activeView: WorkbenchView = view === 'review' && reviewCount === 0 ? 'mine' : view

  async function handleCreated(title: string) {
    await load()
    setView('community')
    setCreatedStatus(`已新增工作卡「${title}」`)
  }

  return (
    <div className="panels">
      <ModuleBanner eyebrow="協作任務" title="認領與交付" description="" art="/art/rpg/cooperation-forge.webp"/>

      <CreateWorkForm pending={pending} mutate={mutate} onCreated={handleCreated} />
      {createdStatus && <p className="banner banner-info" role="status">{createdStatus}</p>}

      <label className="field place-view-picker">
        檢視
        <select aria-label="工作檢視" value={activeView} onChange={(event) => { setView(event.target.value as WorkbenchView); setCreatedStatus('') }}>
          <option value="mine">我的工作</option>
          <option value="community">社群工作</option>
          {reviewCount > 0 && <option value="review">{`待你回饋（${reviewCount}）`}</option>}
          <option value="outcomes">我的成果</option>
        </select>
      </label>

      {activeView === 'mine' && (
        <>
          <Section data-guide-anchor="workbench:current-work" title="現在進行" description="">
            <WorkItemList
              items={dashboard.now}
              empty="目前沒有進行中的工作。"
              pending={pending}
              mutate={mutate}
              onChanged={load}
            />
          </Section>

          <Section title="接下來" description="">
            <WorkItemList items={dashboard.next} empty="接下來沒有待辦。" pending={pending} mutate={mutate} onChanged={load} />
          </Section>

          {dashboard.now.length === 0 && dashboard.next.length === 0 && (
            <div className="actions">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setView('community')}>
                看社群工作
              </button>
            </div>
          )}
        </>
      )}

      {activeView === 'community' && (
        <Section title="其他社群工作" description="">
          <WorkItemList items={catalog} empty="目前沒有其他社群工作。" pending={pending} mutate={mutate} onChanged={load} />
          {pageError&&<p role="alert" className="banner banner-error">{pageError}</p>}
          {nextCursor&&<div className="actions"><button type="button" className="btn btn-secondary btn-small workbench-load-more" disabled={loadingMore} onClick={()=>void loadMore()}>{loadingMore?'正在載入…':'載入較早的社群工作'}</button></div>}
        </Section>
      )}

      {activeView === 'review' && (
        <ReviewQueue entries={dashboard.review_queue} pending={pending} mutate={mutate} onChanged={load} />
      )}

      {activeView === 'outcomes' && (
        <Outcomes acceptedCount={dashboard.summary.accepted_count} gained={dashboard.gained} />
      )}
    </div>
  )
}
