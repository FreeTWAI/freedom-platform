import {useEffect, useState} from 'react';
import type {PortalClient} from '../api';
import {useLocalAction} from '../useLocalAction';
import {MemberAvatar} from './MemberAvatar';
import {promotionLink, ShareButton} from '../share/ShareButton';
import './PromotionBoards.css';

type Period = 'week' | 'month' | 'all';
type BoardKind = 'all' | 'repository' | 'link' | 'event' | 'work' | 'post' | 'service';
type LinkKind = 'member_card' | 'platform' | 'skill_book' | 'social_post' | 'member_service' | 'event' | 'share';
type Item = {rank: number; user_id: string; display_name: string; avatar_url: string | null; points: number};
type Board = {kind: BoardKind; items: Item[]; me: {rank: number; points: number} | null};
type Boards = {period: Period; since: string | null; boards: Board[]};
type Mine = {period: Period; items: {kind: LinkKind; target: string; code: string; path: string; title: string; period_points: number; available: boolean}[]};

const PERIODS: {id: Period; label: string}[] = [{id: 'week', label: '本週'}, {id: 'month', label: '本月'}, {id: 'all', label: '累計'}];
const BOARD_COPY: Record<BoardKind, {title: string; how: string}> = {
  all: {title: '全部', how: '加總各類分享、點擊、加星與報名的淨計入分數。'},
  repository: {title: '開源專案', how: '分享開源專案、有人點進來或加星。'},
  link: {title: '連結', how: '分享連結（含平台與名片），或有人透過你的連結點進來。'},
  event: {title: '活動', how: '主辦或分享活動，或有人點進來或報名。'},
  work: {title: '作品', how: '發表或分享作品，或有人透過你的連結點進來。'},
  post: {title: '貼文', how: '發表或分享貼文，或有人透過你的連結點進來。'},
  service: {title: '服務', how: '發佈或分享社員服務，或有人透過你的連結點進來。'},
};
const LINK_LABELS: Record<LinkKind, string> = {
  share: '分享', member_card: '名片', platform: '平台', skill_book: '技能',
  social_post: '社群', member_service: '業務', event: '活動',
};
const SINCE_FORMAT = new Intl.DateTimeFormat('zh-TW', {timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short'});
function periodNote(period: Period, since: string | null): string {
  if (period === 'all' || !since) return '累計：開站以來的全部點擊。';
  return `${period === 'week' ? '本週' : '本月'}：從 ${SINCE_FORMAT.format(new Date(since))} 00:00（台北時間）起算。`;
}
const WORKSHOP_TEXT = '自由工坊：加入公會、領取 Repo 技能書，和夥伴一起供貨、開店與做開源作品。';

export function PromotionBoards({client,resultsOnly=false,boardsOnly=false}: {client: PortalClient;resultsOnly?:boolean;boardsOnly?:boolean}) {
  const [period, setPeriod] = useState<Period>('week');
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [range, setRange] = useState<{period: Period; since: string | null}>({period: 'week', since: null});
  const [mine, setMine] = useState<Mine['items']>([]);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const [copyNotice, setCopyNotice] = useState<{client: PortalClient; session: number; period: Period; attempt: number; text: string} | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const session = client.sessionGeneration;
  const copyAction = useLocalAction([client, session, period, attempt]);
  const notice = copyNotice?.client === client && copyNotice.session === session && copyNotice.period === period && copyNotice.attempt === attempt ? copyNotice.text : '';
  useEffect(() => {
    let live = true;
    setError(''); setLoading(true); setBoards(null); setMine([]); setCopyNotice(null);
    void Promise.all([
      client.get<Boards>(`/promotion/leaderboards?period=${period}`),
      boardsOnly ? Promise.resolve<Mine>({period, items: []}) : client.get<Mine>(`/promotion/links/mine?period=${period}`),
    ]).then(([board, links]) => { if (live) { setBoards(board.boards); setRange({period: board.period, since: board.since}); setMine(links.items); } })
      .catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : '分享紀錄暫時無法載入。'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [client, period, attempt, boardsOnly]);
  const shown = expanded ? mine : mine.slice(0, 10);
  async function copy(path: string) {
    const url = `${window.location.origin}${path}`;
    const result = await copyAction.run(path, () => { setCopyNotice(null); return navigator.clipboard.writeText(url); });
    if (result.status === 'done' || result.status === 'failed') {
      setCopyNotice({client, session, period, attempt, text: result.status === 'done' ? '已複製連結' : url});
    }
  }
  return <section className="promotion-page stack" aria-label="推廣排行榜">
    {resultsOnly||boardsOnly?<h2>{boardsOnly?'推廣排行榜':'分享成效'}</h2>:<section className="card promotion-start" aria-label="選擇分享內容">
      <h2>把用得上的內容分享給需要的人</h2>
      <div className="promotion-destinations">
        <a className="btn btn-ghost" href="#skills">找一本技能書</a>
        <a className="btn btn-ghost" href="#services">查看社員服務</a>
        <a className="btn btn-ghost" href="#events">找一場活動</a>
        <a className="btn btn-ghost" href="#social">閱讀社群分享</a>
      </div>
      <ShareButton title="自由工坊" fallbackUrl="/" makeLink={promotionLink(client, 'platform', 'workshop')} text={WORKSHOP_TEXT} label="分享自由工坊"/>
      <details className="promotion-help"><summary>說明</summary>
        <p>看到適合朋友的內容再分享；分享完全自願，不需要為了排名大量傳送。</p>
        <p className="promotion-howto">在支援的內容旁選擇「分享」或「推廣原文」，先查看介紹與連結，再由你選擇對象送出。社員服務是找服務的目錄，不是推廣任務。</p>
      </details>
    </section>}
    <header className="promotion-head">
      <div className="promotion-periods" data-guide-anchor="promotion:period" role="group" aria-label="統計期間">
        {PERIODS.map(item => <button key={item.id} type="button" className="btn btn-ghost promotion-period" aria-pressed={period === item.id} onClick={() => { setExpanded(false); setPeriod(item.id); }}>{item.label}</button>)}
      </div>
    </header>
    {boards && <p className="promotion-period-note">{periodNote(range.period, range.since)}每塊榜列出前 10 名，同分同名次。</p>}
    {notice && <p className="banner banner-info" role="status">{notice}</p>}
    {error && <div className="banner banner-error" role="alert"><p>{error}</p><button type="button" className="btn btn-ghost" onClick={() => setAttempt(value => value + 1)}>重新載入分享紀錄</button></div>}
    {loading && <p role="status">正在載入分享紀錄…</p>}
    {!boardsOnly && <section className="card promotion-mine" aria-label="我的推廣連結">
      <h2>我的推廣連結</h2>
      <p className="promotion-howto">右側數字是{PERIODS.find(item => item.id === range.period)!.label}的點擊次數，同一位訪客一天只算一次；排行榜分數另依計分規則。</p>
      {loading ? <p className="promotion-empty">正在讀取你的連結…</p> : error ? <p className="promotion-empty">尚未取得連結紀錄，請重新載入。</p> : shown.length === 0 ? <p className="promotion-empty">還沒有建立分享連結。</p> : <ul>
        {shown.map(item => <li key={item.code} className={item.available ? undefined : 'is-unavailable'}><span className="promotion-kind">{LINK_LABELS[item.kind]}</span><span className="promotion-link-title">{item.available ? item.title : '已無法開啟'}</span>{item.available && <button type="button" className="btn btn-ghost" disabled={copyAction.pending !== null} aria-busy={copyAction.pending === item.path} onClick={() => void copy(item.path)}>複製</button>}<strong>{item.period_points}</strong></li>)}
      </ul>}
      {mine.length > 10 && <button type="button" className="btn btn-ghost" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收合' : '顯示全部'}</button>}
    </section>}
    <details className="promotion-rankings">
      <summary>查看推廣排行榜</summary>
      <p className="promotion-howto">感謝每一次出於需要的分享。點擊不代表閱讀完成、採用或成交，也不衡量一個人的貢獻。</p>
    {boards && <div className="promotion-boards">
      {boards.map(board => <article className="card promotion-board" key={board.kind} aria-label={BOARD_COPY[board.kind].title}>
        <h2>{BOARD_COPY[board.kind].title}</h2>
        <p className="promotion-howto">{BOARD_COPY[board.kind].how}</p>
        {board.items.length === 0 ? <p className="promotion-empty">這段期間還沒有計入的分數。</p> : <ol>
          {board.items.map(item => <li key={item.user_id}><span className="promotion-person"><span className="promotion-rank"><span className="sr-only">第 </span>{item.rank}<span className="sr-only"> 名</span></span><MemberAvatar nickname={item.display_name} avatarUrl={item.avatar_url} className="promotion-avatar"/> <span>{item.display_name}</span></span><strong>{item.points}</strong></li>)}
        </ol>}
        <p className="promotion-me">{board.me ? `我的名次：第 ${board.me.rank} 名・${board.me.points} 分` : '你在這個排行榜還沒有分數。'}</p>
      </article>)}
    </div>}
    </details>
    <details className="promotion-rules">
      <summary>計分規則</summary>
      <p>分享原創或別人的作品、有人加星或報名，各計 1 分；有人透過你的分享點進來，每份分享每天最多 1 分。本人點擊、機器人與測試帳號不計分，撤回或確認檢舉會扣回。分數只顯示在排行榜，不計入會員經驗、獎勵或驗收。</p>
    </details>
  </section>;
}
