import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getStats } from '../api'

// Pexels hotlinks — free license, credited in the footer below.
const VIDEO_POSTER =
  'https://images.pexels.com/photos/4774659/pexels-photo-4774659.jpeg?auto=compress&cs=tinysrgb&h=650&w=940'

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
      <div className="rp-roll-window font-display">
        <div
          className="rp-roll-strip"
          style={{ transform: `translateY(-${(i % ROLL_ROUTES.length) * 2.4}rem)` }}
        >
          {rows.map(([num, from, to], k) => (
            <div key={k} className="rp-roll-row">
              <span className="font-mono text-xs font-medium text-signal">{num}</span>
              <span className="text-xl font-semibold tracking-tight text-snow sm:text-2xl">
                {from}
              </span>
              <span className="text-fog">⟶</span>
              <span className="text-xl font-semibold tracking-tight text-snow sm:text-2xl">
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
function VideoScrub() {
  const sectionRef = useRef(null)
  const videoRef = useRef(null)
  const rafRef = useRef(0)

  useEffect(() => {
    const section = sectionRef.current
    const video = videoRef.current
    if (!section || !video) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let inView = false

    // self-healing playback: (re)attempt whenever the clip gains data
    const syncPlay = () => {
      if (reduced || !inView) {
        video.pause()
        return
      }
      video.play().catch(() => {})
    }
    const onData = () => syncPlay()
    video.addEventListener('canplay', onData)
    video.addEventListener('loadeddata', onData)

    // play on enter, pause on exit
    let io
    if (!reduced) {
      io = new IntersectionObserver(
        ([e]) => {
          inView = e.isIntersecting
          syncPlay()
        },
        { threshold: 0.25 }
      )
      io.observe(section)
    }

    const apply = () => {
      rafRef.current = 0
      const total = section.offsetHeight - window.innerHeight
      if (total <= 0) return
      const progress = Math.min(1, Math.max(0, -section.getBoundingClientRect().top / total))
      section.style.setProperty('--p', progress.toFixed(4))
    }
    const onScroll = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(apply)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    apply()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      video.removeEventListener('canplay', onData)
      video.removeEventListener('loadeddata', onData)
      if (io) io.disconnect()
      video.pause()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <section ref={sectionRef} style={{ '--p': 0 }} className="relative h-[350vh]">
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden bg-paper-deep">
        <video
          ref={videoRef}
          className="rp-warm absolute inset-0 h-full w-full object-cover"
          poster={VIDEO_POSTER}
          muted
          loop
          playsInline
          preload="metadata"
        >
          <source
            src="https://videos.pexels.com/video-files/38876115/16528969_640_360_24fps.mp4"
            type="video/mp4"
          />
          <source
            src="https://videos.pexels.com/video-files/2282019/2282019-sd_426_240_24fps.mp4"
            type="video/mp4"
          />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-ink via-transparent to-ink" />

        {STEPS.map((s) => (
          <div
            key={s.label}
            className="absolute inset-0 flex items-center justify-center px-6"
            style={{
              opacity: `calc(clamp(0, (var(--p) - ${s.a}) / 0.08, 1) * clamp(0, (${s.b} - var(--p)) / 0.08, 1))`,
            }}
          >
            <h3 className="text-center font-display text-4xl font-bold tracking-tight text-snow drop-shadow-[0_1px_14px_rgba(244,239,228,0.55)] sm:text-6xl">
              {s.label.split(' ')[0]}{' '}
              <em className="text-signal">{s.label.split(' ').slice(1).join(' ')}</em>
            </h3>
          </div>
        ))}

        <div className="absolute bottom-8 left-1/2 h-px w-56 -translate-x-1/2 bg-edge">
          <div
            className="h-full bg-signal"
            style={{ width: 'calc(var(--p) * 100%)' }}
          />
        </div>
      </div>
    </section>
  )
}

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
        <div className="mb-8 flex items-center gap-3 font-mono text-[10px] tracking-[0.25em] text-fog">
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-live rp-blink' : 'bg-signal'}`} />
          {live ? '[ LIVE NETWORK ]' : '[ DEMO DATA — API OFFLINE ]'}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map(([label, value]) => (
            <div key={label} className="border-l-2 border-ink/15 pl-4">
              <div className="font-mono text-[10px] tracking-[0.2em] text-fog">{label}</div>
              <div className="mt-2 font-display text-4xl font-bold text-snow">{value}</div>
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
      <section className="rp-grid-bg relative flex min-h-[92vh] flex-col justify-center overflow-hidden border-b border-edge">
        <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6">
          <div className="mb-7 flex items-center gap-3 font-mono text-[10px] tracking-[0.3em] text-fog">
            <span className="h-2 w-2 rounded-full bg-live rp-blink" />
            [ LIVE NETWORK — LAHORE ]
          </div>
          <h1 className="font-display text-[clamp(2.6rem,7vw,5rem)] font-bold leading-[1.02] tracking-tight text-snow">
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
          <div className="mt-10 flex flex-wrap items-center gap-6">
            <Link
              to="/search"
              className="rounded-md bg-snow px-7 py-3.5 font-mono text-xs font-bold tracking-[0.2em] text-ink transition-colors hover:bg-signal hover:text-ink"
            >
              TRACK YOUR BUS →
            </Link>
            <Link
              to="/operator"
              className="font-mono text-xs font-medium tracking-[0.2em] text-fog underline-offset-4 transition-colors hover:text-signal hover:underline"
            >
              OPERATOR DASHBOARD
            </Link>
          </div>
        </div>
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.3em] text-fog">
          SCROLL ↓
        </div>
      </section>

      {/* ---------- VIDEO ON SCROLL ---------- */}
      <VideoScrub />

      {/* ---------- FEATURE CARDS — printed timetable panels ---------- */}
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="mb-10 font-mono text-[10px] tracking-[0.3em] text-fog">
          [ WHAT THE TIMETABLE KNOWS ]
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
                <div className="font-mono text-[10px] tracking-[0.25em] text-fog">
                  [ {f.idx} ]
                </div>
                <h3 className="mt-2 font-display text-2xl font-bold tracking-tight text-snow">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-fog">{f.line}</p>
                <div className="mt-4 font-mono text-[10px] tracking-[0.25em] text-signal transition-transform duration-300 group-hover:translate-x-1">
                  [ LEARN MORE ]
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
        <p className="font-mono text-[10px] tracking-[0.18em] text-fog">
          Data &amp; media: Pexels · Maps © OpenStreetMap contributors · Carbograph
          tiles by CARTO · Built in one day at a hackathon.
        </p>
      </footer>
    </div>
  )
}
