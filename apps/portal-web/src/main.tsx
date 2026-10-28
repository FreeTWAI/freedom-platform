import './zod-csp'
import React, {Component, type ReactNode} from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './rpg-theme.css'
import './LayoutDesign.css'
import '../../../modules/portal-shell/commerce-navigation.css'
import './GameConsole.css'
import './light-theme.css'
import './versefolk-theme.css'
import './module-light-theme.css'
import './GameConsoleThemes.css'
import './CalmExperience.css'

import {initializeExperienceProfile} from './experience-profiles'
import './dragon-theme.css'
import './WorkspaceCompanionLayout.css'
// The deferred composer optimizer relies on its styles in the initial CSS graph.
import './modules/SocialPostOptimizer.css'

initializeExperienceProfile()

const root = document.getElementById('root')
if (!root) {
  throw new Error('找不到根節點')
}

// AD-6: the public arcade and Three.js are absent from the member startup path.
function StartupFailure(){return <main className="card stack" role="alert"><h1>頁面暫時無法開啟</h1><p>請重新載入，或回自由工坊。</p><button className="btn btn-primary" onClick={()=>location.reload()}>重新載入</button><a href="/">回自由工坊</a></main>}
class StartupBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed
    ? <StartupFailure/>
    : this.props.children}
}
const arcade=location.pathname==='/play'||location.pathname==='/play/'
const appRoot=createRoot(root)
const show=(content:ReactNode)=>appRoot.render(<React.StrictMode><StartupBoundary>{content}</StartupBoundary></React.StrictMode>)
show(<main className="card" role="status">正在開啟{arcade?'遊樂場':'自由工坊'}…</main>)
// Resolve the entry before rendering it. An initial Suspense reveal depends on
// a timer even after its import resolves, and froze clock-controlled journeys.
const entry=arcade
  ? import('./games/AbsurdDaily').then(({AbsurdDaily})=><AbsurdDaily/>)
  : import('./App').then(({App})=><App/>)
void entry.then(show).catch(()=>show(<StartupFailure/>))
