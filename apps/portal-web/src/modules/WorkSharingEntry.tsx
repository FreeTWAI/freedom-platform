import './WorkSharing.css';

export function WorkSharingEntry({ current }: { current: 'showcase' | 'opensource' | 'engagement' }) {
  return <nav className="work-sharing-entry" aria-label="作品與合作">
    <a href="#showcase" aria-current={current === 'showcase' ? 'page' : undefined}>展示作品</a>
    <a href="#opensource" aria-current={current === 'opensource' ? 'page' : undefined}>投稿開源工具</a>
    <a href="#engagement" aria-current={current === 'engagement' ? 'page' : undefined}>合作紀錄</a>
  </nav>;
}
