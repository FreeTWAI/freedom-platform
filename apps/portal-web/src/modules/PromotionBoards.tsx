import {useEffect, useState} from 'react';
import type {PortalClient} from '../api';
import {MemberAvatar} from './MemberAvatar';
import {PromotionShare} from './PromotionShare';
import './PromotionBoards.css';

type Period = 'week' | 'month' | 'all';
type Kind = 'member_card' | 'platform' | 'skill_book' | 'social_post' | 'member_service' | 'event';
type Item = {rank: number; user_id: string; display_name: string; avatar_url: string | null; points: number};
type Board = {kind: Kind; items: Item[]; me: {rank: number; points: number} | null};
type Boards = {period: Period; since: string | null; boards: Board[]};
type Mine = {period: Period; items: {kind: Kind; target: string; code: string; path: string; title: string; period_points: number; available: boolean}[]};

const PERIODS: {id: Period; label: string}[] = [{id: 'week', label: '本週'}, {id: 'month', label: '本月'}, {id: 'all', label: '累計'}];
const COPY: Record<Kind, {title: string; how: string; label: string}> = {
  member_card: {title: '名片點擊排行榜', label: '名片', how: '在我的名片分享名片連結，每次點擊 +1。'},
  platform: {title: '平台推廣排行榜', label: '平台', how: '分享自由工坊連結，每次點擊 +1。'},
  skill_book: {title: '技能推廣排行榜', label: '技能', how: '從技能書架分享技能書，每次點擊 +1。'},
  social_post: {title: '社群推廣排行榜', label: '社群', how: '在社群分享專區分享貼文，每次點擊 +1。'},
  member_service: {title: '業務推廣排行榜', label: '業務', how: '在社員服務分享區分享社員的服務，每次點擊 +1。'},
  event: {title: '活動推廣排行榜', label: '活動', how: '分享社群活動，每次點擊 +1。'},
};
const SINCE_FORMAT = new Intl.DateTimeFormat('zh-TW', {timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short'});
function periodNote(period: Period, since: string | null): string {
  if (period === 'all' || !since) return '累計：開站以來的全部點擊。';
  return `${period === 'week' ? '本週' : '本月'}：從 ${SINCE_FORMAT.format(new Date(since))} 00:00（台北時間）起算。`;
}
const WORKSHOP_TEXT = '自由工坊：加入公會、領取 Repo 技能書，和夥伴一起供貨、開店與做開源作品。';

export function PromotionBoards({client}: {client: PortalClient}) {
  const [period, setPeriod] = useState<Period>('week');
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [range, setRange] = useState<{period: Period; since: string | null}>({period: 'week', since: null});
  const [mine, setMine] = useState<Mine['items']>([]);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setError(''); setLoading(true); setBoards(null); setMine([]); setNotice('');
    void Promise.all([
      client.get<Boards>(`/promotion/leaderboards?period=${period}`),
      client.get<Mine>(`/promotion/links/mine?period=${period}`),
    ]).then(([board, links]) => { if (live) { setBoards(board.boards); setRange({period: board.period, since: board.since}); setMine(links.items); } })
      .catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : '分享紀錄暫時無法載入。'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [client, period, attempt]);
  const shown = expanded ? mine : mine.slice(0, 10);
  async function copy(path: string) {
    const url = `${window.location.origin}${path}`;
    try { await navigator.clipboard.writeText(url); setNotice('已複製連結'); }
    catch { setNotice(url); }
  }
  return <section className="promotion-page stack" aria-label="推廣排行榜">
    <section className="card promotion-start" aria-label="選擇分享內容">
      <h2>把用得上的內容分享給需要的人</h2>
      <p>看到適合朋友的內容再分享；分享完全自願，不需要為了排名大量傳送。</p>
      <div className="promotion-destinations">
        <a className="btn btn-ghost" href="#skills">找一本技能書</a>
        <a className="btn btn-ghost" href="#services">查看社員服務</a>
        <a className="btn btn-ghost" href="#events">找一場活動</a>
        <a className="btn btn-ghost" href="#social">閱讀社群分享</a>
      </div>
      <p className="promotion-howto">在支援的內容旁選擇「分享」或「推廣原文」，先查看介紹與連結，再由你選擇對象送出。社員服務是找服務的目錄，不是推廣任務。</p>
      <PromotionShare client={client} kind="platform" target="workshop" title="自由工坊" text={WORKSHOP_TEXT} label="分享自由工坊"/>
    </section>
    <header className="promotion-head">
      <div className="promotion-periods" data-guide-anchor="promotion:period" role="group" aria-label="統計期間">
        {PERIODS.map(item => <button key={item.id} type="button" className="btn btn-ghost promotion-period" aria-pressed={period === item.id} onClick={() => { setExpanded(false); setPeriod(item.id); }}>{item.label}</button>)}
      </div>
    </header>
    {boards && <p className="promotion-period-note">{periodNote(range.period, range.since)}每塊榜列出前 10 名，同分同名次。</p>}
    {notice && <p className="banner banner-info" role="status">{notice}</p>}
    {error && <div className="banner banner-error" role="alert"><p>{error}</p><button type="button" className="btn btn-ghost" onClick={() => setAttempt(value => value + 1)}>重新載入分享紀錄</button></div>}
    {loading && <p role="status">正在載入分享紀錄…</p>}
    <section className="card promotion-mine" aria-label="我的推廣連結">
      <h2>我的推廣連結</h2>
      <p className="promotion-howto">右側數字是{PERIODS.find(item => item.id === range.period)!.label}的點擊分數。</p>
      {loading ? <p className="promotion-empty">正在讀取你的連結…</p> : error ? <p className="promotion-empty">尚未取得連結紀錄，請重新載入。</p> : shown.length === 0 ? <p className="promotion-empty">還沒有建立分享連結。可以先從上方選一項你覺得有用的內容。</p> : <ul>
        {shown.map(item => <li key={item.code} className={item.available ? undefined : 'is-unavailable'}><span className="promotion-kind">{COPY[item.kind].label}</span><span className="promotion-link-title">{item.available ? item.title : '已無法開啟'}</span>{item.available && <button type="button" className="btn btn-ghost" onClick={() => void copy(item.path)}>複製</button>}<strong>{item.period_points}</strong></li>)}
      </ul>}
      {mine.length > 10 && <button type="button" className="btn btn-ghost" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收合' : '顯示全部'}</button>}
    </section>
    <details className="promotion-rankings">
      <summary>查看推廣排行榜</summary>
      <p className="promotion-howto">感謝每一次出於需要的分享。點擊不代表閱讀完成、採用或成交，也不衡量一個人的貢獻。</p>
    {boards && <div className="promotion-boards">
      {boards.map(board => <article className="card promotion-board" key={board.kind} aria-label={COPY[board.kind].title}>
        <h2>{COPY[board.kind].title}</h2>
        <p className="promotion-howto">{COPY[board.kind].how}</p>
        {board.items.length === 0 ? <p className="promotion-empty">這段期間還沒有計入的點擊。</p> : <ol>
          {board.items.map(item => <li key={item.user_id}><span className="promotion-person"><span className="promotion-rank"><span className="sr-only">第 </span>{item.rank}<span className="sr-only"> 名</span></span><MemberAvatar nickname={item.display_name} avatarUrl={item.avatar_url} className="promotion-avatar"/> <span>{item.display_name}</span></span><strong>{item.points}</strong></li>)}
        </ol>}
        <p className="promotion-me">{board.me ? `我的名次：第 ${board.me.rank} 名・${board.me.points} 分` : '你在這個排行榜還沒有分數。'}</p>
      </article>)}
    </div>}
    </details>
    <details className="promotion-rules">
      <summary>計分規則</summary>
      <p>同一位訪客每天點同一個連結只算 1 分；本人點擊、連結預覽機器人不計分；分數只顯示在排行榜，不計入會員經驗、獎勵或驗收。</p>
    </details>
  </section>;
}
