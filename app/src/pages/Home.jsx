import { useEffect, useRef, useState } from 'react'
import VideoScrollSection from '../components/VideoScrollSection.jsx';
import { Link } from 'react-router-dom'
import { getStats } from '../api'

// Pexels hotlinks — free license, credited in the footer below.

const FEATURES = [
  {
    idx: '01',
    img: 'https://images.pexels.com/photos/14471680/pexels-photo-14471680.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    title: 'Live tracking',
    line: 'Every bus on the city map, its position refreshed every two seconds.',
    to: '/search',
  },
  {
    idx: '02',
    img: 'https://images.pexels.com/photos/33892983/pexels-photo-33892983.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    title: 'Smart ETA',
    line: 'Per-stop arrivals computed from distance along route, rolling average speed and live delay.',
    to: '/search',
  },
  {
    idx: '03',
    img: 'https://images.pexels.com/photos/30405834/pexels-photo-30405834.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
    title: 'Operator analytics',
    line: 'Fleet KPIs, delay hotspots and instant service alerts in one control room.',
    to: '/operator',
  },
]

// overlay copy steps over the scrubbed video (progress windows)
const STEPS = [
  { label: 'Search your route', a: 0.02, b: 0.32 },
  { label: 'Watch it move', a: 0.36, b: 0.64 },
  { label: 'Catch your bus', a: 0.68, b: 0.94 },
]

const ROLL_ROUTES = [
  ['7', 'City Center', 'University Gate'],
  ['5', 'Central Station', 'Bus Terminal'],
  ['3', 'Airport', 'City Center'],
  ['9', 'City Center', 'University Gate'],
]

const DEMO_STATS = {
  active_buses: 4,
  delayed_buses: 1,
  routes_running: 4,
  trips_today: 12,
  avg_delay_min: 3.8,
}

// ---------------------------------------------------------------
// Destination roll — the headline element. A paper strip with
// bracket notches; the slot rolls through live route names.
// ---------------------------------------------------------------
function DestinationRoll() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((v) => v + 1), 2600)
    return () => clearInterval(id)
  }, [])
  const rows = [...ROLL_ROUTES, ROLL_ROUTES[0]] // seamless loop
  return (
    <div className="rp-roll bg-panel">
      <span className="rp-bus" aria-hidden="true" />
      <div className="rp-roll-window font-display uppercase">
        <div
          className="rp-roll-strip"
          style={{ transform: `translateY(-${(i % ROLL_ROUTES.length) * 2.4}rem)` }}
        >
          {rows.map(([num, from, to], k) => (
            <div key={k} className="rp-roll-row">
              <span className="font-mono text-xs font-medium text-signal">{num}</span>
              <span className="text-lg font-semibold uppercase tracking-tight text-snow sm:text-2xl">
                {from}
              </span>
              <span className="text-fog">⟶</span>
              <span className="text-lg font-semibold uppercase tracking-tight text-snow sm:text-2xl">
                {to}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// Video-on-scroll — hybrid pattern: the clip plays (muted, loop)
// while the section is in the viewport; scroll drives the progress
// bar and the overlay copy steps (CSS var, no re-renders). This
// always shows moving footage — CDN seek-scrubbing stuttered.
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// Live stats strip — real /api/stats numbers, DEMO DATA fallback.
// ---------------------------------------------------------------
function StatsStrip() {
  const [stats, setStats] = useState(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    let on = true
    const load = async () => {
      try {
        const s = await getStats(false)
        if (on) {
          setStats(s)
          setLive(true)
        }
      } catch {
        if (on) {
          setStats((d) => d || DEMO_STATS)
          setLive(false)
        }
      }
    }
    load()
    const id = setInterval(load, 6000)
    return () => {
      on = false
      clearInterval(id)
    }
  }, [])

  const s = stats || DEMO_STATS
  const tiles = [
    ['ACTIVE BUSES', s.active_buses],
    ['DELAYED', s.delayed_buses],
    ['ROUTES RUNNING', s.routes_running],
    ['TRIPS TODAY', s.trips_today],
    ['AVG DELAY', `${s.avg_delay_min} min`],
  ]
  return (
    <section className="border-y border-edge bg-paper-deep">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="mb-8 flex items-center gap-3 font-mono text-xs tracking-[0.25em] text-fog">
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-live rp-blink' : 'bg-signal'}`} />
          {live ? 'LIVE NETWORK' : 'DEMO DATA — API OFFLINE'}
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-5">
          {tiles.map(([label, value], i) => (
            <div
              key={label}
              className={`min-w-0 border-l-2 border-ink/15 pl-4 ${
                i === tiles.length - 1 ? 'col-span-2 sm:col-span-1' : ''
              }`}
            >
              <div className="font-mono text-xs tracking-[0.2em] text-fog">{label}</div>
              <div className="mt-2 break-words font-display text-3xl font-semibold text-snow sm:text-4xl">
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------
export default function Home() {
  return (
    <div>
      {/* ---------- HERO — the printed timetable came alive ---------- */}
      <section className="rp-grid-bg rp-hero relative flex flex-col justify-center overflow-hidden border-b border-edge">
        <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="mb-7 flex items-center gap-3 font-mono text-xs tracking-[0.3em] text-fog">
            <span className="h-2 w-2 rounded-full bg-live rp-blink" />
            LIVE NETWORK — LAHORE
          </div>
          <h1 className="font-display text-[clamp(2.6rem,7vw,5rem)] font-semibold leading-[1.02] tracking-tight text-snow">
            <span className="rp-split">
              <span style={{ animationDelay: '0.05s' }}>The timetable</span>
            </span>
            <span className="rp-split">
              <span style={{ animationDelay: '0.22s' }}>
                came <em className="text-signal">alive</em>.
              </span>
            </span>
          </h1>
          <p className="mt-7 max-w-[65ch] text-base leading-relaxed text-fog sm:text-lg">
            Routepulse turns a city fleet into a living timetable — real-time bus
            positions, per-stop arrival predictions and instant service alerts for
            passengers, drivers and operators.
          </p>
          <div className="mt-9">
            <DestinationRoll />
          </div>
          <div className="mt-7">
            <DestinationRoll />
          </div>
          <div className="mt-9 flex flex-col gap-4 sm:mt-10 sm:flex-row sm:items-center sm:gap-6">
            <Link
              to="/search"
              className="flex min-h-12 w-full items-center justify-center rounded-md bg-snow px-7 py-3.5 text-center font-mono text-xs font-bold tracking-[0.2em] text-ink transition-colors hover:bg-signal hover:text-ink sm:w-auto"
            >
              TRACK YOUR BUS →
            </Link>
            <Link
              to="/operator"
              className="flex min-h-11 items-center justify-center text-center font-mono text-xs font-medium tracking-[0.2em] text-fog underline-offset-4 transition-colors hover:text-signal hover:underline"
            >
              OPERATOR DASHBOARD
            </Link>
          </div>
        </div>
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-xs tracking-[0.3em] text-fog">
          SCROLL ↓
        </div>
      </section>

      {/* ---------- VIDEO ON SCROLL ---------- */}
      <VideoScrollSection />

      {/* ---------- FEATURE CARDS — printed timetable panels ---------- */}
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="mb-10 font-mono text-xs tracking-[0.3em] text-fog">
          WHAT THE TIMETABLE KNOWS
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {FEATURES.map((f) => (
            <Link
              key={f.idx}
              to={f.to}
              className="group overflow-hidden rounded-lg border border-edge bg-paper-deep transition-colors hover:border-signal/50"
            >
              <div className="relative h-48 overflow-hidden">
                <img
                  src={f.img}
                  alt={f.title}
                  loading="lazy"
                  className="rp-warm h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
              </div>
              <div className="p-6">
                <div className="font-mono text-xs tracking-[0.25em] text-fog">
                  {f.idx}
                </div>
                <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-snow">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-fog">{f.line}</p>
                <div className="mt-4 font-mono text-xs tracking-[0.25em] text-signal transition-transform duration-300 group-hover:translate-x-1">
                  LEARN MORE
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- LIVE STATS STRIP ---------- */}
      <StatsStrip />

      {/* ---------- FOOTER / CREDITS ---------- */}
      <footer className="mx-auto max-w-7xl px-4 py-12 text-center sm:px-6">
        <p className="font-mono text-xs tracking-[0.18em] text-fog">
          Data &amp; media: Pexels · Maps © OpenStreetMap contributors · Basemaps
          © CARTO · Built in one day at a hackathon.
        </p>
      </footer>
    </div>
  )
}
