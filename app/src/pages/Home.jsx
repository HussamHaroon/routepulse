import { useEffect, useRef, useState } from 'react'
import VideoScrollSection from '../components/VideoScrollSection.jsx';
import FeatureSection from '../components/FeatureSection.jsx';
import { Link } from 'react-router-dom'
import { getStats } from '../api'

// Pexels hotlinks — free license, credited in the footer below.
// All URLs curl-verified HTTP 200 (video/mp4 · image/jpeg).

// Hero footage: Lahore street traffic (differs from VideoScrollSection's clip).
const HERO_VIDEO =
  'https://videos.pexels.com/video-files/17814090/17814090-hd_1920_1080_30fps.mp4'
const HERO_VIDEO_FALLBACK =
  'https://videos.pexels.com/video-files/17814090/17814090-hd_1280_720_30fps.mp4'
const HERO_VIDEO_ALT =
  'https://videos.pexels.com/video-files/16385744/16385744-hd_1920_1080_30fps.mp4'
const HERO_POSTER =
  'https://images.pexels.com/photos/31715009/pexels-photo-31715009.jpeg?auto=compress&cs=tinysrgb&w=1600'

const ROLL_ROUTES = [
  ['1', 'Shahdara', 'Kalma Chowk'],
  ['3', 'Railway Station', 'Liberty Market'],
  ['6', 'Thokar Niaz Baig', 'Model Town'],
  ['8', 'Airport', 'Gulberg Main Blvd'],
]

const DEMO_STATS = {
  active_buses: 4,
  delayed_buses: 1,
  routes_running: 4,
  trips_today: 12,
  avg_delay_min: 3.8,
}

// ---------------------------------------------------------------
// Route postcards — eight Lahore lines, each with a Pexels photo.
// `tag` states what the photo actually shows (honest labeling where
// an exact landmark shot wasn't available on Pexels).
// ---------------------------------------------------------------
const px = (id, w = 800) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`

const ROUTE_CARDS = [
  { n: '1', name: 'Minar-e-Pakistan', line: 'Shahdara → Kalma Chowk', img: 11784631, tag: 'MINAR-E-PAKISTAN', fare: 40, color: '#E4572E' },
  { n: '2', name: 'Badshahi Mosque', line: 'Old City → Mosque Road', img: 31715009, tag: 'BADSHAHI MOSQUE', fare: 30, color: '#211D16' },
  { n: '3', name: 'Liberty Market', line: 'Railway Station → Liberty Market', img: 14933965, tag: 'CITY BAZAAR — EN ROUTE', fare: 40, color: '#2E9E5B' },
  { n: '4', name: 'Mughal Lahore', line: 'Fort Road corridor', img: 36185197, tag: 'LAHORE FORT — ALAMGIRI GATE', fare: 30, color: '#B3402E' },
  { n: '5', name: 'Data Darbar', line: 'Bhati Chowk corridor', img: 20215427, tag: 'WALLED CITY MOSQUE — EN ROUTE', fare: 35, color: '#E4572E' },
  { n: '6', name: 'Model Town', line: 'Thokar Niaz Baig → Model Town', img: 35402132, tag: 'STREET LEVEL — EN ROUTE', fare: 45, color: '#211D16' },
  { n: '7', name: 'Gulberg', line: 'Main Boulevard', img: 14933997, tag: 'MAIN BOULEVARD AT DUSK', fare: 50, color: '#2E9E5B' },
  { n: '8', name: 'Airport', line: 'Airport → Gulberg Main Blvd', img: 4914158, tag: 'EVENING TARMAC — AIRPORT-BOUND', fare: 60, color: '#B3402E' },
]

// ---------------------------------------------------------------
// Destination roll — the headline element. A paper strip with
// bracket notches; the slot rolls through live route names.
// ---------------------------------------------------------------
function DestinationRoll() {
  const [i, setI] = useState(0)
  useEffect(() => {
    // reduced motion: hold the first destination instead of rolling
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
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
// Cinematic hero — full-bleed Lahore street footage under an ink
// scrim. Degrades to the poster still on prefers-reduced-motion.
// ---------------------------------------------------------------
function Hero() {
  const [reduced, setReduced] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const videoRef = useRef(null)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // autoplay is best-effort: retry once the clip gains data
  useEffect(() => {
    if (reduced) return
    const v = videoRef.current
    if (!v) return
    v.play().catch(() => {})
    const onData = () => v.play().catch(() => {})
    v.addEventListener('loadeddata', onData)
    v.addEventListener('canplay', onData)
    return () => {
      v.removeEventListener('loadeddata', onData)
      v.removeEventListener('canplay', onData)
    }
  }, [reduced])

  return (
    <section className="rp-hero relative flex flex-col justify-center overflow-hidden border-b border-edge bg-night">
      {/* --- media layer --- */}
      {reduced ? (
        <img
          src={HERO_POSTER}
          alt="Badshahi Mosque rising over the Lahore skyline at dusk"
          className="rp-hero-grade absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <>
          <img
            src={HERO_POSTER}
            alt=""
            aria-hidden="true"
            className={`rp-hero-grade absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
              videoReady ? 'opacity-0' : 'opacity-100'
            }`}
          />
          <video
            ref={videoRef}
            className={`rp-hero-grade absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
              videoReady ? 'opacity-100' : 'opacity-0'
            }`}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            disablePictureInPicture
            onCanPlay={() => setVideoReady(true)}
            aria-hidden="true"
          >
            <source src={HERO_VIDEO} type="video/mp4" />
            <source src={HERO_VIDEO_FALLBACK} type="video/mp4" />
            <source src={HERO_VIDEO_ALT} type="video/mp4" />
          </video>
        </>
      )}

      {/* --- scrims: legibility gradient, vignette, print grain --- */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(18,20,23,0.66) 0%, rgba(18,20,23,0.30) 44%, rgba(18,20,23,0.78) 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden md:block"
        style={{
          background:
            'linear-gradient(to right, rgba(18,20,23,0.55) 0%, rgba(18,20,23,0.12) 55%, rgba(18,20,23,0) 100%)',
        }}
      />
      <div aria-hidden="true" className="rp-vignette pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="rp-grain-overlay pointer-events-none absolute inset-0" />

      {/* --- copy layer --- */}
      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 py-24 sm:px-6">
        <div className="mb-7 flex items-center gap-3 font-mono text-xs tracking-[0.3em] text-paper/80">
          <span className="h-2 w-2 rounded-full bg-live rp-blink" />
          LIVE NETWORK — LAHORE
        </div>
        <h1 className="font-display text-[clamp(2.6rem,7vw,5rem)] font-semibold leading-[1.02] tracking-tight text-paper">
          <span className="rp-split">
            <span style={{ animationDelay: '0.05s' }}>The timetable</span>
          </span>
          <span className="rp-split">
            <span style={{ animationDelay: '0.22s' }}>
              came <em className="text-signal">alive</em>.
            </span>
          </span>
        </h1>
        <p className="mt-7 max-w-[65ch] text-base leading-relaxed text-paper/75 sm:text-lg">
          Routepulse turns a city fleet into a living timetable — real-time bus
          positions, per-stop arrival predictions and instant service alerts for
          passengers, drivers and operators.
        </p>
        <div className="mt-9">
          <DestinationRoll />
        </div>
        <div className="mt-9 flex flex-col gap-4 sm:mt-10 sm:flex-row sm:items-center sm:gap-6">
          <Link
            to="/search"
            className="flex min-h-12 w-full items-center justify-center rounded-md bg-paper px-7 py-3.5 text-center font-mono text-xs font-bold tracking-[0.2em] text-snow transition-colors hover:bg-signal hover:text-snow sm:w-auto"
          >
            TRACK YOUR BUS →
          </Link>
          <Link
            to="/operator"
            className="flex min-h-11 items-center justify-center text-center font-mono text-xs font-medium tracking-[0.2em] text-paper/70 underline-offset-4 transition-colors hover:text-signal hover:underline"
          >
            OPERATOR DASHBOARD
          </Link>
        </div>
      </div>
      <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 font-mono text-xs tracking-[0.3em] text-paper/60">
        SCROLL ↓
      </div>
      <div className="absolute bottom-6 right-4 z-10 hidden font-mono text-[10px] tracking-[0.25em] text-paper/40 sm:right-6 sm:block">
        FOOTAGE — LAHORE STREETS · PEXELS
      </div>
    </section>
  )
}

// ---------------------------------------------------------------
// Route postcards — the services section as eight photo cards.
// ---------------------------------------------------------------
function RouteCards() {
  return (
    <section className="rp-grain border-b border-edge bg-paper py-20 sm:py-24" aria-labelledby="rp-cards-title">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        {/* masthead */}
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b-2 border-snow pb-5">
          <div>
            <p className="font-mono text-xs tracking-[0.28em] text-fog">
              SERVICE GUIDE — THE CITY IN EIGHT CARDS
            </p>
            <h2 id="rp-cards-title" className="mt-3 font-display text-[clamp(1.9rem,4vw,3rem)] font-semibold leading-tight tracking-tight text-snow">
              Pick a line. <em className="text-signal">The city does the rest.</em>
            </h2>
          </div>
          <p className="max-w-[38ch] font-mono text-[11px] leading-relaxed tracking-[0.14em] text-fog">
            EIGHT ROUTES · LIVE POSITIONS · HONEST ETAS
          </p>
        </div>

        {/* the postcards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ROUTE_CARDS.map((c) => (
            <article key={c.n} className="rp-card group relative overflow-hidden rounded-lg border border-edge bg-panel">
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={px(c.img)}
                  alt={c.tag.toLowerCase()}
                  loading="lazy"
                  decoding="async"
                  className="rp-card-img rp-warm h-full w-full object-cover"
                />
                <span
                  className="absolute left-3 top-3 rounded-md px-2.5 py-1 font-mono text-xs font-extrabold tracking-widest text-paper shadow-sm"
                  style={{ background: c.color }}
                >
                  ROUTE {c.n}
                </span>
                <span className="absolute bottom-2 left-3 right-3 font-mono text-[10px] font-semibold tracking-[0.18em] text-paper/95 [text-shadow:0_1px_6px_rgba(18,20,23,0.85)]">
                  {c.tag}
                </span>
              </div>
              <div className="p-4">
                <h3 className="font-display text-xl font-semibold tracking-tight text-snow">
                  {c.name}
                </h3>
                <p className="mt-1.5 font-mono text-[11px] tracking-[0.12em] text-fog">
                  {c.line.toUpperCase()}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-edge pt-3">
                  <span className="font-mono text-[11px] tracking-[0.16em] text-fog">
                    FARE <span className="font-bold text-snow">PKR {c.fare}</span>
                  </span>
                  <Link
                    to="/search"
                    className="font-mono text-xs font-bold tracking-[0.18em] text-signal transition-all duration-500 sm:translate-x-1 sm:opacity-0 sm:group-hover:translate-x-0 sm:group-hover:opacity-100"
                  >
                    TRACK →
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>

        <p className="mt-8 font-mono text-[11px] tracking-[0.18em] text-fog">
          FARES INDICATIVE · PHOTOGRAPHY PEXELS — SCENES LABELLED AS SHOT
        </p>
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
      {/* ---------- HERO — full-bleed film, the printed timetable came alive ---------- */}
      <Hero />

      {/* ---------- VIDEO ON SCROLL ---------- */}
      <VideoScrollSection />

      {/* ---------- ROUTE POSTCARDS — eight lines, eight frames ---------- */}
      <RouteCards />

      {/* ---------- FEATURE CARDS — printed timetable panels ---------- */}
      <FeatureSection />

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
