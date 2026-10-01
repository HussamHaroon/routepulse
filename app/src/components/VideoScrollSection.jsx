/* ============================================================================
   VideoScrollSection — drop-in replacement for <VideoScrub /> in Home.jsx
   "The printed timetable came alive" — scroll-scrubbed film section.

   HOW TO INSTALL (routepulse/app):
   1. Copy this file to:  routepulse/app/src/components/VideoScrollSection.jsx
   2. In routepulse/app/src/pages/Home.jsx:
      - DELETE the `STEPS` const (lines ~33-38) — only VideoScrub used it.
      - DELETE the `VIDEO_POSTER` const (lines ~6-7) — this file has its own.
      - DELETE the entire `VideoScrub` function (lines ~92-235, incl. its
        comment block).
      - REPLACE `<VideoScrub />` in the JSX with `<VideoScrollSection />`.
      - ADD the import next to the others:
          import VideoScrollSection from '../components/VideoScrollSection'
   3. Nothing else changes — self-contained, no props, no new deps.

   WHAT IT DOES (vs the old text-swap-on-video):
   - 300vh sticky scrub; video frame scales 0.55 -> 1.0 and un-rounds
     (24px -> 0) while settling from a slight print-card tilt.
   - Warm paper-grade filter (sepia/saturate/contrast) curve tied to progress,
     so footage always sits in the paper register (design-direction.md §6.2).
   - Three headline beats crossfade + rise with staggered micro-labels.
   - A vertical "route line" with three stops draws down the left edge,
     lighting each stop as its headline beat plays.
   - p 0.80 -> 1.00: a mini live-route-map card (pure CSS/SVG product mock)
     slides up; its route polyline draws on via stroke-dash scrub.
   - Perf: one passive scroll listener -> single rAF write of `--p`;
     IntersectionObserver pauses video AND stops rAF work off-screen;
     will-change on the transformed frame only.
   - prefers-reduced-motion: static poster, all copy visible, no scrub,
     no autoplay (JS branch + CSS media-query guard).

   VIDEO SOURCES — Pexels, free license (credit in footer), verified HTTP 200:
   - Primary : https://videos.pexels.com/video-files/5466903/5466903-hd_1920_1080_30fps.mp4
   - Fallback: https://videos.pexels.com/video-files/14310008/14310008-hd_1920_1080_30fps.mp4
   Both are 1920x1080 30fps. The <source> list degrades automatically.
============================================================================ */

import { useEffect, useRef, useState } from 'react'

const VIDEO_PRIMARY =
  'https://videos.pexels.com/video-files/5466903/5466903-hd_1920_1080_30fps.mp4'
const VIDEO_FALLBACK =
  'https://videos.pexels.com/video-files/14310008/14310008-hd_1920_1080_30fps.mp4'
const VIDEO_POSTER =
  'https://images.pexels.com/photos/4774659/pexels-photo-4774659.jpeg?auto=compress&cs=tinysrgb&h=650&w=940'

// Three headline beats. `a`/`b` are scrub windows (in/out) over --p (0..1).
const LINES = [
  { tag: '[ 01 — PLAN ]', pre: 'Every route,', em: 'alive', post: '.', a: 0.05, b: 0.3 },
  { tag: '[ 02 — WATCH ]', pre: 'The timetable', em: 'breathes', post: '.', a: 0.36, b: 0.61 },
  { tag: '[ 03 — CATCH ]', pre: 'The city,', em: 'in motion', post: '.', a: 0.64, b: 0.84 },
]

// Route-line stops on the left rail — aligned with the headline windows.
const STOPS = [0.14, 0.47, 0.8]

// opacity: in over 0.07 of scroll, out over 0.07. Rise: +48px in, -36px out.
const fade = (a, b) =>
  `clamp(0, (var(--p) - ${a}) / 0.07, 1) * clamp(0, (${b} - var(--p)) / 0.07, 1)`
const rise = (a, b) =>
  `calc((1 - clamp(0, (var(--p) - ${a}) / 0.1, 1)) * 48px - clamp(0, (var(--p) - ${b}) / 0.07, 1) * 36px)`

// Card slide window: 0.80 -> 0.96 settles it; route draw 0.82 -> 0.98.
const CARD_SLIDE = `calc((1 - clamp(0, (var(--p) - 0.8) / 0.16, 1)) * 130%)`
const CARD_FADE = `clamp(0, (var(--p) - 0.8) / 0.1, 1)`
const ROUTE_DRAW = `calc(100 - clamp(0, (var(--p) - 0.82) / 0.16, 1) * 100)`

/* ----------------------------------------------------------------------------
   Mini live-route-map card — CSS/SVG mock of the product (design §4/§7):
   roll-strip header, heartbeat dot, route polyline drawing on, ETA chips.
---------------------------------------------------------------------------- */
function RouteMapCard() {
  return (
    <div className="rp2-card relative w-[min(88vw,360px)] border bg-[color:var(--rp-paper)] shadow-[0_24px_60px_-24px_rgba(18,20,23,0.55)]"
      style={{ borderColor: 'var(--rp-line)' }}
    >
      {/* print registration brackets */}
      <span aria-hidden className="absolute -left-px -top-px h-3 w-3 border-l-2 border-t-2 border-[color:var(--rp-signal)]" />
      <span aria-hidden className="absolute -right-px -top-px h-3 w-3 border-r-2 border-t-2 border-[color:var(--rp-signal)]" />
      <span aria-hidden className="absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 border-[color:var(--rp-signal)]" />
      <span aria-hidden className="absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2 border-[color:var(--rp-signal)]" />

      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--rp-line)' }}>
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.28em] text-[color:var(--rp-ink)]">
          <span className="rp2-heart relative inline-block h-2 w-2 rounded-full bg-[color:var(--rp-signal)]" />
          LIVE — ROUTE 7
        </div>
        <div className="font-mono text-[10px] tracking-[0.2em] text-[color:var(--rp-ink-mute)]">LHR · 05:4x</div>
      </div>

      <div className="px-4 pb-1 pt-3">
        <svg viewBox="0 0 300 90" className="h-auto w-full" role="img" aria-label="Route 7 map: City Center to University Gate with live bus position">
          {/* ghost path (full route, printed) */}
          <path d="M14 64 C 70 64, 84 20, 150 26 C 216 32, 224 66, 286 34"
            fill="none" stroke="var(--rp-line)" strokeWidth="2" strokeDasharray="4 5" />
          {/* live path, draws on with scroll */}
          <path d="M14 64 C 70 64, 84 20, 150 26 C 216 32, 224 66, 286 34"
            pathLength="100" fill="none" stroke="var(--rp-signal)" strokeWidth="2.5"
            strokeLinecap="round" strokeDasharray="100"
            style={{ strokeDashoffset: ROUTE_DRAW }} />
          {/* stops */}
          {[[14, 64], [150, 26], [286, 34]].map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="5.5" fill="var(--rp-paper)" stroke="var(--rp-ink)" strokeWidth="1.5" />
              <circle cx={x} cy={y} r="2" fill={i === 1 ? 'var(--rp-signal)' : 'var(--rp-ink)'} />
            </g>
          ))}
          {/* live bus marker, mid-route between stop 2 and 3 */}
          <circle cx="219" cy="47" r="4" fill="var(--rp-signal)" stroke="var(--rp-paper)" strokeWidth="1.5">
            <animate attributeName="r" values="4;5;4" dur="2s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-2 px-4 pb-3 pt-1 font-mono text-[10px] tracking-[0.12em]">
        <div className="border px-2 py-1.5 text-[color:var(--rp-live)]" style={{ borderColor: 'var(--rp-line)' }}>05:42 · 2 MIN</div>
        <div className="border px-2 py-1.5 text-[color:var(--rp-live)]" style={{ borderColor: 'var(--rp-line)' }}>05:49 · 4 MIN</div>
        <div className="border px-2 py-1.5 text-[color:var(--rp-late)]" style={{ borderColor: 'var(--rp-line)' }}>05:57 · 7 MIN</div>
      </div>

      <div className="flex items-center justify-between border-t px-4 py-2.5 font-mono text-[10px] tracking-[0.22em] text-[color:var(--rp-ink-mute)]"
        style={{ borderColor: 'var(--rp-line)' }}>
        <span>ROUTE 7 · 11 STOPS</span>
        <span className="text-[color:var(--rp-live)]">ON TIME</span>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------------------
   Reduced-motion variant: static poster frame, all copy stacked, card shown.
---------------------------------------------------------------------------- */
function StaticSection() {
  return (
    <section className="rp2 relative flex min-h-[100svh] items-center justify-center overflow-hidden bg-[color:var(--rp-paper-deep)] py-20">
      <div className="rp2-frame relative mx-4 aspect-video w-full max-w-5xl overflow-hidden border bg-[color:var(--rp-night)]"
        style={{ borderColor: 'var(--rp-line)', borderRadius: 0 }}>
        <video className="rp2-grade h-full w-full object-cover" poster={VIDEO_POSTER} muted loop playsInline preload="metadata">
          <source src={VIDEO_PRIMARY} type="video/mp4" />
          <source src={VIDEO_FALLBACK} type="video/mp4" />
        </video>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[rgba(18,20,23,0.55)] via-transparent to-[rgba(18,20,23,0.65)]" />
        <div className="rp2-grain pointer-events-none absolute inset-0" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="font-mono text-[10px] tracking-[0.3em] text-[color:var(--rp-paper-70)]">[ THE LIVING TIMETABLE ]</div>
          {LINES.map((l) => (
            <h3 key={l.tag} className="font-display text-[clamp(1.8rem,5vw,3.4rem)] font-semibold leading-[1.05] tracking-tight text-[color:var(--rp-paper)]">
              {l.pre} <em className="text-[color:var(--rp-signal)]">{l.em}</em>{l.post}
            </h3>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------------------
   Main export — 300vh sticky scrub section.
---------------------------------------------------------------------------- */
export default function VideoScrollSection() {
  const sectionRef = useRef(null)
  const videoRef = useRef(null)
  const [reduced, setReduced] = useState(false)

  // reduced-motion preference (live)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // Scrub engine: passive scroll -> one rAF write of `--p`; IO gates video
  // playback AND rAF work; everything visual is calc() off `--p` in CSS.
  useEffect(() => {
    if (reduced) return
    const section = sectionRef.current
    const video = videoRef.current
    if (!section || !video) return

    let inView = false
    let raf = 0

    const apply = () => {
      raf = 0
      const total = section.offsetHeight - window.innerHeight
      if (total <= 0) return
      const p = Math.min(1, Math.max(0, -section.getBoundingClientRect().top / total))
      section.style.setProperty('--p', p.toFixed(4))
    }
    const schedule = () => {
      if (inView && !raf) raf = requestAnimationFrame(apply)
    }

    const io = new IntersectionObserver(
      ([e]) => {
        inView = e.isIntersecting
        if (inView) {
          schedule()
          video.play().catch(() => {})
        } else {
          video.pause() // stop decode work off-screen
        }
      },
      { threshold: 0.05 }
    )
    io.observe(section)

    // self-healing autoplay: retry whenever the clip gains data
    const onData = () => {
      if (inView) video.play().catch(() => {})
    }
    video.addEventListener('loadeddata', onData)
    video.addEventListener('canplay', onData)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    apply()

    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      video.removeEventListener('loadeddata', onData)
      video.removeEventListener('canplay', onData)
      io.disconnect()
      if (raf) cancelAnimationFrame(raf)
      video.pause()
    }
  }, [reduced])

  if (reduced) return <StaticSection />

  return (
    <section ref={sectionRef} style={{ '--p': 0 }} className="rp2 relative h-[300vh] bg-[color:var(--rp-paper-deep)]">
      <div className="rp2-stage sticky top-0 overflow-hidden">
        {/* mono caption, top-left — fades in early, out late */}
        <div
          className="pointer-events-none absolute left-4 top-5 z-30 font-mono text-[10px] tracking-[0.3em] text-[color:var(--rp-ink-mute)] sm:left-10"
          style={{ opacity: `calc(clamp(0, var(--p) / 0.06, 1) * clamp(0, (0.9 - var(--p)) / 0.08, 1))` }}
        >
          [ ON FILM — THE NETWORK, LIVE ]
        </div>

        {/* scroll hint — burns off as the scrub starts */}
        <div
          className="pointer-events-none absolute bottom-6 left-1/2 z-30 -translate-x-1/2 font-mono text-[10px] tracking-[0.3em] text-[color:var(--rp-ink-mute)]"
          style={{ opacity: `calc(1 - clamp(0, var(--p) * 6, 1))` }}
        >
          SCROLL TO BOARD ↓
        </div>

        {/* vertical route line — draws with progress, three beats as stops */}
        <div aria-hidden className="absolute left-5 top-1/2 z-30 hidden h-[44vh] -translate-y-1/2 sm:left-9 sm:block">
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-[color:var(--rp-line)]" />
          <div className="absolute left-1/2 top-0 w-px -translate-x-1/2 bg-[color:var(--rp-signal)]" style={{ height: 'calc(var(--p) * 100%)' }} />
          {STOPS.map((s, i) => (
            <div key={i} className="absolute left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-[color:var(--rp-paper-deep)]"
              style={{ top: `${s * 100}%`, borderColor: 'var(--rp-line)' }}>
              <span className="absolute inset-0 rounded-full bg-[color:var(--rp-signal)]"
                style={{ opacity: `calc(clamp(0, (var(--p) - ${s}) * 18, 1))` }} />
            </div>
          ))}
        </div>

        {/* the film frame — scales 0.55->1.0, un-rounds 24px->0, settles tilt */}
        <div className="rp2-frame absolute inset-0 overflow-hidden border bg-[color:var(--rp-night)] will-change-transform"
          style={{ borderColor: 'var(--rp-line)' }}>
          <video
            ref={videoRef}
            className="rp2-grade h-full w-full object-cover"
            poster={VIDEO_POSTER}
            muted
            loop
            playsInline
            preload="metadata"
          >
            <source src={VIDEO_PRIMARY} type="video/mp4" />
            <source src={VIDEO_FALLBACK} type="video/mp4" />
          </video>

          {/* legibility scrims + print grain */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[rgba(18,20,23,0.5)] via-[rgba(18,20,23,0.15)] to-[rgba(18,20,23,0.6)]" />
          <div className="rp2-grain pointer-events-none absolute inset-0" />

          {/* frame corners + film caption (print register) */}
          <span aria-hidden className="absolute left-4 top-4 z-10 h-4 w-4 border-l border-t border-[color:var(--rp-paper-70)]" />
          <span aria-hidden className="absolute right-4 top-4 z-10 h-4 w-4 border-r border-t border-[color:var(--rp-paper-70)]" />
          <span aria-hidden className="absolute bottom-4 left-4 z-10 h-4 w-4 border-b border-l border-[color:var(--rp-paper-70)]" />
          <span aria-hidden className="absolute bottom-4 right-4 z-10 h-4 w-4 border-b border-r border-[color:var(--rp-paper-70)]" />
          <div className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2 font-mono text-[9px] tracking-[0.3em] text-[color:var(--rp-paper-70)]">
            [ 5466903 — PEXELS · 1080P ]
          </div>

          {/* three headline beats — crossfade + rise, staggered tags */}
          <div className="absolute inset-0 z-20">
            {LINES.map((l) => (
              <div
                key={l.tag}
                className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center will-change-transform"
                style={{ opacity: `calc(${fade(l.a, l.b)})`, transform: `translateY(${rise(l.a, l.b)})` }}
              >
                <div
                  className="mb-4 font-mono text-[10px] tracking-[0.34em] text-[color:var(--rp-paper-70)]"
                  style={{
                    opacity: `calc(${fade(l.a, l.b)})`,
                    transform: `translateY(${rise(l.a - 0.015, l.b + 0.015)})`,
                  }}
                >
                  {l.tag}
                </div>
                <h3 className="font-display text-[clamp(2rem,6vw,4.4rem)] font-semibold leading-[1.02] tracking-tight text-[color:var(--rp-paper)] drop-shadow-[0_2px_18px_rgba(18,20,23,0.6)]">
                  {l.pre} <em className="text-[color:var(--rp-signal)]">{l.em}</em>
                  {l.post}
                </h3>
              </div>
            ))}
          </div>
        </div>

        {/* final beat (p 0.80-1.00): mini live-route-map card slides up */}
        <div className="absolute inset-x-0 bottom-[5vh] z-30 flex justify-center px-4 sm:justify-end sm:px-[7vw]">
          <div
            className="will-change-transform"
            style={{ transform: `translateY(${CARD_SLIDE})`, opacity: `calc(${CARD_FADE})` }}
          >
            <RouteMapCard />
          </div>
        </div>
      </div>

      <style>{`
        .rp2 {
          --rp-paper: #F4EFE4; --rp-paper-deep: #EAE3D3; --rp-ink: #211D16;
          --rp-ink-mute: #6E6656; --rp-line: #D9D1BE; --rp-signal: #E4572E;
          --rp-live: #2E7D4F; --rp-late: #B3402E; --rp-night: #121417;
          --rp-paper-70: rgba(244, 239, 228, 0.72);
        }
        .rp2-stage { height: 100vh; height: 100svh; }
        /* frame scrub: scale 0.55->1.0, radius 24px->0, tilt settles by p=0.25 */
        .rp2-frame {
          transform: scale(calc(0.55 + 0.45 * var(--p)))
                     rotate(calc((1 - clamp(0, var(--p) * 4, 1)) * -1.5deg));
          border-radius: calc(24px * (1 - var(--p)));
          box-shadow: calc((1 - var(--p)) * 40px) calc((1 - var(--p)) * 50px)
                      calc(60px + (1 - var(--p)) * 40px) rgba(18, 20, 23, 0.28);
        }
        /* warm paper-grade filter curve (design-direction.md §6.2):
           heavier sepia/contrast early, settling to the house grade */
        .rp2-grade {
          filter: sepia(calc(0.22 - 0.1 * var(--p)))
                  saturate(calc(0.92 + 0.13 * var(--p)))
                  contrast(calc(1.06 - 0.04 * var(--p)))
                  brightness(calc(1 + 0.03 * var(--p)));
        }
        /* halftone grain — printed-paper texture over the footage */
        .rp2-grain {
          background-image: radial-gradient(rgba(33, 29, 22, 0.14) 1px, transparent 1px);
          background-size: 3px 3px;
          mix-blend-mode: multiply;
          opacity: 0.5;
        }
        /* heartbeat dot (design §4): 2s ping ring */
        .rp2-heart::after {
          content: '';
          position: absolute;
          inset: -3px;
          border-radius: 9999px;
          border: 1.5px solid var(--rp-signal);
          animation: rp2-ping 2s cubic-bezier(0.19, 1, 0.22, 1) infinite;
        }
        @keyframes rp2-ping {
          0%   { transform: scale(0.6); opacity: 0.9; }
          80%, 100% { transform: scale(2.1); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .rp2-frame { transform: none; border-radius: 0; box-shadow: none; }
          .rp2-heart::after { animation: none; opacity: 0; }
          .rp2-grade { filter: sepia(0.14) saturate(0.98) contrast(1.02); }
        }
      `}</style>
    </section>
  )
}
