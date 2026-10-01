import { useEffect, useRef, useState } from 'react'

/* ============================================================
   FeatureSection — "TIMETABLE PAGE"
   ============================================================
   Replaces the AI-generic image-card feature grid on the homepage.

   WHERE TO PASTE (app/src/pages/Home.jsx):
     1. Delete the FEATURES array (top of file).
     2. Delete the whole section between <VideoScrub /> and
        <StatsStrip /> — the block commented
        "FEATURE CARDS — printed timetable panels".
     3. Copy this file to app/src/components/FeatureSection.jsx,
        import it, and render it in that slot:

          import FeatureSection from '../components/FeatureSection'
          ...
          <FeatureSection />

        To feed it live numbers from the existing getStats():
          <FeatureSection
            active={s.active_buses}
            routes={s.routes_running}
            avgDelay={s.avg_delay_min}
          />

   PROPS SIGNATURE:
     FeatureSection({ active = undefined, routes = undefined, avgDelay = undefined })
       active   : number — buses moving now          (fallback 4)
       routes   : number — routes currently running   (fallback 4)
       avgDelay : number — average delay in minutes   (fallback 3.8)
     All props optional; omitted props fall back to the same demo
     numbers the rest of the page uses, so demo state stays coherent.

   NO images in this section — type, hairline rules and zebra
   paper-tone rows carry it. Zodiak (Fontshare, free license) is
   @imported here for the serif register; falls back to Georgia.
   ============================================================ */

const DEMO = { active: 4, routes: 4, avgDelay: 3.8 }

const css = `
@import url('https://api.fontshare.com/v2/css?f[]=zodiak@400,401,700&display=swap');

.rp-tt {
  --rp-paper: #F4EFE4;
  --rp-paper-deep: #EAE3D3;
  --rp-ink: #211D16;
  --rp-mute: #6E6656;
  --rp-line: #D9D1BE;
  --rp-signal: #E4572E;
  --rp-live: #2E7D4F;
  --rp-ease: cubic-bezier(0.19, 1, 0.22, 1);
  --rp-serif: 'Zodiak', Georgia, 'Times New Roman', serif;
  --rp-mono-face: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--rp-paper);
  color: var(--rp-ink);
  border-top: 1px solid var(--rp-line);
  border-bottom: 1px solid var(--rp-line);
}
.rp-tt .rp-tt-mono {
  font-family: var(--rp-mono-face);
  font-size: 0.65rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--rp-mute);
}
.rp-tt .rp-tt-serif { font-family: var(--rp-serif); }

/* ---------- masthead (print rules: thick over thin) ---------- */
.rp-tt-mast {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  padding-bottom: 1.4rem;
  border-bottom: 2px solid var(--rp-ink);
}
.rp-tt-mast h2 {
  font-family: var(--rp-serif);
  font-size: clamp(2.1rem, 4.5vw, 3.4rem);
  line-height: 1.02;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin-top: 0.9rem;
}
.rp-tt-mast h2 em { font-style: italic; color: var(--rp-signal); }
.rp-tt-folio { white-space: nowrap; }

/* ---------- column heads, aligned to the row grid ---------- */
.rp-tt-head {
  display: grid;
  grid-template-columns: 5rem minmax(11rem, 15rem) 1fr minmax(9.5rem, 11rem);
  gap: 1.5rem;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--rp-ink);
}

/* ---------- rows: zebra paper, hover lift + signal rule ---------- */
.rp-tt-table { list-style: none; margin: 0; padding: 0; }
.rp-tt-row {
  position: relative;
  display: grid;
  align-items: center;
  gap: 1.5rem;
  grid-template-areas: 'idx name line data';
  grid-template-columns: 5rem minmax(11rem, 15rem) 1fr minmax(9.5rem, 11rem);
  padding: 1.6rem 1.25rem;
  background: var(--rp-paper);
  transition: transform 0.4s var(--rp-ease), box-shadow 0.4s var(--rp-ease);
}
.rp-tt-row:nth-child(even) { background: var(--rp-paper-deep); }
.rp-tt-row::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--rp-signal);
  transform: translateX(-100%);
  transition: transform 0.4s var(--rp-ease);
}
.rp-tt-row:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(33, 29, 22, 0.1);
  z-index: 1;
}
.rp-tt-row:hover::before { transform: translateX(0); }
.rp-tt-row:hover .rp-tt-idx { color: var(--rp-signal); }

.rp-tt-idx { grid-area: idx; transition: color 0.4s var(--rp-ease); }
.rp-tt-name {
  grid-area: name;
  font-family: var(--rp-serif);
  font-size: clamp(1.5rem, 2.4vw, 2rem);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 0.65rem;
}
.rp-tt-line {
  grid-area: line;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--rp-mute);
  max-width: 52ch;
}
.rp-tt-data {
  grid-area: data;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.4rem;
  text-align: right;
  border-left: 1px solid var(--rp-line);
  padding-left: 1.25rem;
}
.rp-tt-value {
  font-family: var(--rp-serif);
  font-size: clamp(1.7rem, 2.6vw, 2.3rem);
  font-weight: 700;
  line-height: 1;
}
.rp-tt-value small { font-size: 0.5em; font-weight: 400; letter-spacing: 0; }
.rp-tt-data .rp-tt-mono { font-size: 0.6rem; letter-spacing: 0.22em; }

/* ---------- live dot (heartbeat, matches the hero) ---------- */
.rp-tt-dot {
  width: 0.55rem; height: 0.55rem;
  border-radius: 9999px;
  background: var(--rp-live);
  position: relative;
  flex: none;
}
.rp-tt-dot::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 9999px;
  border: 1.5px solid var(--rp-live);
  animation: rp-tt-ping 2s var(--rp-ease) infinite;
}
@keyframes rp-tt-ping {
  0% { transform: scale(0.6); opacity: 0.8; }
  70%, 100% { transform: scale(1.9); opacity: 0; }
}

/* ---------- entrance: rows rise + fade, staggered 60ms ---------- */
.rp-tt-row.is-in {
  animation: rp-tt-rise 0.7s var(--rp-ease) backwards;
  animation-delay: calc(var(--i) * 60ms);
}
@keyframes rp-tt-rise {
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ---------- footnote ---------- */
.rp-tt-foot { margin-top: 1.1rem; }

/* ---------- mobile: stack each row like a printed entry ---------- */
@media (max-width: 767px) {
  .rp-tt-head { display: none; }
  .rp-tt-folio { display: none; }
  .rp-tt-row {
    grid-template-areas:
      'idx name'
      'line line'
      'data data';
    grid-template-columns: 4.5rem 1fr;
    row-gap: 0.8rem;
    padding: 1.35rem 1rem;
  }
  .rp-tt-data {
    border-left: 0;
    border-top: 1px solid var(--rp-line);
    padding: 0.8rem 0 0;
    flex-direction: row;
    align-items: baseline;
    justify-content: space-between;
    width: 100%;
  }
}

/* ---------- reduced motion: fully static ---------- */
@media (prefers-reduced-motion: reduce) {
  .rp-tt-row,
  .rp-tt-row.is-in {
    animation: none;
    opacity: 1;
    transform: none;
    transition: none;
  }
  .rp-tt-row::before { transition: none; }
  .rp-tt-dot::after { animation: none; }
}
`

export default function FeatureSection({ active, routes, avgDelay }) {
  const v = {
    active: active ?? DEMO.active,
    routes: routes ?? DEMO.routes,
    avgDelay: avgDelay ?? DEMO.avgDelay,
  }

  // entrance trigger — one observer on the section, stagger handled in CSS
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true)
          io.disconnect()
        }
      },
      { threshold: 0.2 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const rows = [
    {
      i: '01',
      name: 'Live network',
      line: 'Every bus on the city map, its position refreshed every two seconds.',
      value: v.active,
      unit: '',
      label: 'Buses moving',
    },
    {
      i: '02',
      name: 'Honest ETAs',
      line: 'Arrivals computed from distance along the route, rolling average speed and live delay — never a guess.',
      value: v.routes,
      unit: '',
      label: 'Routes running',
    },
    {
      i: '03',
      name: 'Control room',
      line: 'Fleet KPIs, delay hotspots and instant service alerts — the operator’s page of the same timetable.',
      value: v.avgDelay,
      unit: ' min',
      label: 'Avg delay',
    },
    {
      i: '04',
      name: 'Two-second alerts',
      line: 'Operator speaks, every passenger hears.',
      value: '2s',
      unit: '',
      label: 'Alert latency',
      live: true,
    },
  ]

  return (
    <section ref={ref} className="rp-tt py-20 sm:py-28" aria-labelledby="rp-tt-title">
      <style>{css}</style>
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        {/* masthead */}
        <div className="rp-tt-mast">
          <div>
            <p className="rp-tt-mono">[ Routepulse — Service Guide ]</p>
            <h2 id="rp-tt-title">
              What the timetable <em>knows</em>.
            </h2>
          </div>
          <p className="rp-tt-mono rp-tt-folio">Page 03</p>
        </div>

        {/* column heads (desktop only) */}
        <div className="rp-tt-head rp-tt-mono" aria-hidden="true">
          <span>No.</span>
          <span>Service</span>
          <span>Description</span>
          <span style={{ textAlign: 'right' }}>Readout</span>
        </div>

        {/* the timetable rows — each row IS a capability */}
        <ul className="rp-tt-table">
          {rows.map((r, k) => (
            <li
              key={r.i}
              className={`rp-tt-row${inView ? ' is-in' : ''}`}
              style={{ '--i': k }}
            >
              <span className="rp-tt-idx rp-tt-mono">[ {r.i} ]</span>
              <h3 className="rp-tt-name">
                {r.name}
                {r.live && <span className="rp-tt-dot" aria-hidden="true" />}
              </h3>
              <p className="rp-tt-line">{r.line}</p>
              <div className="rp-tt-data">
                <span className="rp-tt-value">
                  {r.value}
                  {r.unit && <small>{r.unit}</small>}
                </span>
                <span className="rp-tt-mono">{r.label}</span>
              </div>
            </li>
          ))}
        </ul>

        <p className="rp-tt-foot rp-tt-mono">
          Timetable valid today · Readouts refresh every 2 seconds · Printed in Lahore
        </p>
      </div>
    </section>
  )
}
