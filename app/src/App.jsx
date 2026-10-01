import { HashRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { createContext, useContext, useEffect, useState } from 'react'
import Home from './pages/Home'
import Search from './pages/Search'
import Track from './pages/Track'
import Driver from './pages/Driver'
import Operator from './pages/Operator'

// ---------- DEMO DATA toggle context (mock mode switch) ----------
const DemoCtx = createContext({ demo: true, setDemo: () => {} })
export const useDemo = () => useContext(DemoCtx)

const navItems = [
  { to: '/', label: 'HOME' },
  { to: '/search', label: 'LIVE TRACKING' },
  { to: '/driver', label: 'DRIVER' },
  { to: '/operator', label: 'OPERATOR' },
]

function Header() {
  const { demo, setDemo } = useDemo()
  const { pathname } = useLocation()
  return (
    <header className="sticky top-0 z-[1000] border-b border-edge bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <NavLink to="/" className="flex items-center gap-2.5">
          <span className="relative flex h-3.5 w-3.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-phos opacity-60" />
            <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-phos" />
          </span>
          <span className="font-mono text-lg font-extrabold tracking-[0.18em] text-snow">
            ROUTE<span className="text-phos">PULSE</span>
          </span>
        </NavLink>

        <nav className="flex items-center gap-1">
          {navItems.map((n) => {
            const active =
              n.to === '/'
                ? pathname === '/'
                : pathname.startsWith(n.to) ||
                  (n.to === '/search' && pathname.startsWith('/track'))
            return (
              <NavLink
                key={n.to}
                to={n.to}
                className={`rounded-md px-3 py-1.5 font-mono text-xs font-bold tracking-widest transition ${
                  active
                    ? 'bg-phos/15 text-phos'
                    : 'text-fog hover:bg-panel2 hover:text-snow'
                }`}
              >
                {n.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-fog sm:inline">
            {demo ? 'mock feed' : 'api feed'}
          </span>
          <button
            onClick={() => setDemo(!demo)}
            title="Toggle between mock data and the live API"
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest transition ${
              demo
                ? 'border-cyan/50 bg-cyan/10 text-cyan'
                : 'border-edge bg-panel text-fog hover:text-snow'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${demo ? 'bg-cyan rp-blink' : 'bg-fog'}`}
            />
            DEMO DATA {demo ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-edge py-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 font-mono text-[10px] uppercase tracking-[0.2em] text-fog sm:px-6">
        <span>routepulse · live transit tracking · hackathon build</span>
        <span>map tiles © esri · map data © openstreetmap contributors</span>
      </div>
    </footer>
  )
}

export default function App() {
  const [demo, setDemo] = useState(() => localStorage.getItem('rp_demo') !== '0')
  useEffect(() => {
    localStorage.setItem('rp_demo', demo ? '1' : '0')
  }, [demo])

  return (
    <DemoCtx.Provider value={{ demo, setDemo }}>
      <HashRouter>
        <Shell />
      </HashRouter>
    </DemoCtx.Provider>
  )
}

// Inner shell — reads the location so the cinematic homepage renders
// full-bleed while the tool screens keep the centered container.
function Shell() {
  const { pathname } = useLocation()
  const home = pathname === '/'

  return (
    <div className="flex min-h-screen flex-col bg-ink text-snow">
      <Header />
      <main
        className={
          home ? 'w-full flex-1' : 'mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6'
        }
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/track/:routeId" element={<Track />} />
          <Route path="/driver" element={<Driver />} />
          <Route path="/operator" element={<Operator />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
