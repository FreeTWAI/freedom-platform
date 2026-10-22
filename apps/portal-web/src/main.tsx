import React, {Component, Suspense, lazy, type ReactNode} from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './rpg-theme.css'
import './LayoutDesign.css'
import './GameConsole.css'
import './light-theme.css'
import './versefolk-theme.css'
import './module-light-theme.css'
import './GameConsoleThemes.css'
import './CalmExperience.css'

import {initializeExperienceProfile} from './experience-profiles'
import './dragon-theme.css'
import './WorkspaceCompanionLayout.css'

initializeExperienceProfile()

const root = document.getElementById('root')
if (!root) {
  throw new Error('找不到根節點')
}

// AD-6: the public arcade and Three.js are absent from the member startup path.
const Arcade = lazy(() => import('./games/AbsurdDaily').then(m => ({default:m.AbsurdDaily})))
const Portal = lazy(() => import('./App').then(m => ({default:m.App})))
class StartupBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed
    ? <main className="card stack" role="alert"><h1>頁面暫時無法開啟</h1><p>請重新載入，或回自由工坊。</p><button className="btn btn-primary" onClick={()=>location.reload()}>重新載入</button><a href="/">回自由工坊</a></main>
    : this.props.children}
}
const arcade=location.pathname==='/play'||location.pathname==='/play/'
createRoot(root).render(
  <React.StrictMode>
    <StartupBoundary><Suspense fallback={<main className="card" role="status">正在開啟{arcade?'遊樂場':'自由工坊'}…</main>}>
      {arcade?<Arcade/>:<Portal/>}
    </Suspense></StartupBoundary>
  </React.StrictMode>,
)
