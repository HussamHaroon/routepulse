import { HashRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { createContext, useContext, useEffect, useState } from 'react'
import Home from './pages/Home'
import Search from './pages/Search'
import Track from './pages/Track'
import Driver from './pages/Driver'
import Operator from './pages/Operator'
import NotFound from './pages/NotFound'
import Station from './pages/Station'

// ---------- DEMO DATA toggle context (mock mode switch) ----------
const DemoCtx = createContext({ demo: true, setDemo: () => {} })
export const useDemo = () => useContext(DemoCtx)

const navItems = [
  { to: '/', label: 'HOME' },
  { to: '/search', label: 'SEARCH' },
  { to: '/driver', label: 'DRIVER' },
  { to: '/operator', label: 'OPERATOR' },
]

function Header() {
  const { demo, setDemo } = useDemo()
  const { pathname } = useLocation()
  return (
    <header
      className="sticky top-0 z-[1000] border-b border-edge bg-ink/90 backdrop-blur"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* row 1 — brand + (desktop) links + feed toggle */}
      <div className="mx-auto flex max-w-7xl items-center gap-x-6 px-4 py-2 sm:px-6">
        <NavLink to="/" className="flex min-w-0 items-center gap-2.5">
          <img
            src="/logo-mark.png"
            alt="Routepulse logo"
            className="h-8 w-8 shrink-0"
          />
          <span className="whitespace-nowrap font-mono text-base font-extrabold tracking-[0.12em] text-snow sm:text-lg sm:tracking-[0.18em]">
            ROUTE<span className="text-phos">PULSE</span>
          </span>
        </NavLink>

        <nav className="hidden items-center gap-1 md:flex">
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
                className={`flex min-h-11 items-center rounded-md px-3 py-1.5 font-mono text-xs font-bold tracking-widest transition ${
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

        <div className="ml-auto flex items-center">
          <button
            onClick={() => setDemo(!demo)}
            title={demo ? 'Watching the offline demo simulator — click to go live' : 'Watching the live GPS feed — click to switch to the offline demo simulator'}
            className={`flex min-h-11 items-center gap-2 rounded-full border px-2.5 font-mono text-xs font-bold tracking-widest transition sm:px-3 ${
              demo
                ? 'border-amber/50 bg-amber/10 text-amber'
                : 'border-live/50 bg-live/10 text-live'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full rp-blink ${demo ? 'bg-amber' : 'bg-live'}`}
            />
            <span className="hidden sm:inline">{demo ? 'DEMO DATA' : 'LIVE FEED'}</span>
            <span className="sm:hidden">{demo ? 'DEMO' : 'LIVE'}</span>
          </button>
        </div>
      </div>

      {/* row 2 (touch only) — horizontally scrollable link rail, snap + fade edge */}
      <nav
        aria-label="Primary"
        className="no-scrollbar rp-rail flex snap-x snap-mandatory gap-1 overflow-x-auto border-t border-edge/60 px-4 py-1 md:hidden"
      >
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
              className={`flex min-h-11 shrink-0 snap-start items-center rounded-md px-3.5 py-2 font-mono text-xs font-bold tracking-widest transition ${
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
    </header>
  )
}

function Footer() {
  return (
    <footer
      className="border-t border-edge py-6"
      style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 font-mono text-xs uppercase tracking-[0.2em] text-fog sm:px-6">
        <span>routepulse · live transit tracking · hackathon build</span>
        <span>map tiles © carto · map data © openstreetmap contributors</span>
      </div>
    </footer>
  )
}

export default function App() {
  // LIVE-first, always: on boot probe /api/health — success boots the live
  // feed (WS badge, real positions, numeric ETAs). Mock appears only when
  // the API is unreachable (retried briefly) or the user toggles DEMO DATA
  // for this session. Nothing is persisted — a stale saved toggle can never
  // force a mock-first default across reloads.
  const [demo, setDemoState] = useState(true) // first paint: skeletons while probing
  useEffect(() => {
    let on = true
    let tries = 0
    const probe = () =>
      fetch(`${import.meta.env.VITE_API_URL || ''}/api/health`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    const attempt = () => {
      tries += 1
      probe().then((h) => {
        if (!on) return
        if (h?.ok) {
          setDemoState(false) // API is up → LIVE wins, unconditionally
        } else if (tries < 3) {
          setTimeout(attempt, 2000) // API warming up — keep trying
        } // else: stay on mock fallback
      })
    }
    attempt()
    return () => {
      on = false
    }
  }, [])
  const setDemo = setDemoState // session-only toggle (deliberately not persisted)

  // PWA: register the service worker. Browsers only allow SW over http(s) —
  // file:// and other schemes are skipped.
  useEffect(() => {
    if (!location.protocol.startsWith('http')) return
    try {
      navigator.serviceWorker?.register('/sw.js').catch(() => {})
    } catch {
      /* SW is a progressive enhancement — never blocks the app */
    }
  }, [])

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
          <Route path="/station/:stopName" element={<Station />} />
          <Route path="/driver" element={<Driver />} />
          <Route path="/operator" element={<Operator />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
