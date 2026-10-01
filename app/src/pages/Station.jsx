import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getDepartures } from '../api'
import { usePoll } from '../hooks'
import { useDemo } from '../App'
import { Mono } from '../components'

// Split-flap flip-in. Defined here (not index.css) so this page owns its own
// animation; house easing per the design language.
const FLAP_CSS = `
  @keyframes rp-flap-in {
    0%   { transform: perspective(700px) rotateX(-88deg) translateY(-8px); opacity: 0; }
    55%  { transform: perspective(700px) rotateX(10deg) translateY(0); opacity: 1; }
    100% { transform: perspective(700px) rotateX(0deg) translateY(0); opacity: 1; }
  }
  .rp-flap {
    animation: rp-flap-in 0.55s cubic-bezier(0.19, 1, 0.22, 1) both;
    transform-origin: 50% 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .rp-flap { animation: none; }
  }
`

// ink #211D16 board constants (the semantic tokens are paper-side; the board
// is deliberately the dark object in the paper page)
const BOARD_BG = '#211D16'
const BOARD_LINE = '#3A3428'
const BOARD_TEXT = '#F4EFE4'
const BOARD_MUTE = '#8A8070'
const SIGNAL = '#E4572E'
const LIVE_GREEN = '#2E9E5B'
const CONF_COLOR = { high: LIVE_GREEN, medium: SIGNAL, low: BOARD_MUTE }

const routeNum = (routeId) => String(routeId ?? '').replace(/^R/i, '') || '—'
const GRID =
  'grid grid-cols-[2.9rem_minmax(0,1fr)_5.6rem_6.2rem] gap-x-3 sm:grid-cols-[4rem_minmax(0,1fr)_6.8rem_8rem]'

function DepartureRow({ d, delayMs }) {
  const due = d.eta_min != null && d.eta_min <= 1
  const delayed = d.trip_status === 'Delayed' || (d.delay_minutes || 0) > 0
  return (
    <div
      className={`rp-flap ${GRID} items-center border-b border-[#3A3428] px-4 py-3 last:border-b-0 sm:px-5`}
      style={{ animationDelay: `${delayMs}ms`, backgroundColor: BOARD_BG }}
    >
      <span
        title={d.route_name ?? ''}
        className="rounded-[4px] py-1 text-center font-mono text-sm font-extrabold"
        style={{ backgroundColor: SIGNAL, color: BOARD_BG }}
      >
        {routeNum(d.route_id)}
      </span>
      <span className="truncate font-mono text-sm" style={{ color: BOARD_TEXT }} title={d.headsign ?? d.route_name ?? ''}>
        {d.headsign ?? d.route_name ?? '—'}
      </span>
      <span className="flex items-baseline gap-1.5 font-mono text-xl font-extrabold leading-none tabular-nums" style={{ color: BOARD_TEXT }}>
        {due ? (
          <span className="rp-blink" style={{ color: SIGNAL }}>DUE</span>
        ) : (
          <>
            {Number(d.eta_min).toFixed(1)}
            <span className="text-[10px] font-bold tracking-[0.2em]" style={{ color: BOARD_MUTE }}>MIN</span>
          </>
        )}
        <span
          title={`ETA confidence: ${String(d.confidence ?? 'low').toUpperCase()}`}
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: CONF_COLOR[d.confidence] ?? BOARD_MUTE }}
        />
      </span>
      <span
        className="font-mono text-[11px] font-bold tracking-widest"
        style={{ color: delayed ? SIGNAL : LIVE_GREEN }}
      >
        {String(d.trip_status ?? '—').toUpperCase()}
        {delayed && d.delay_minutes > 0 ? ` +${d.delay_minutes}M` : ''}
      </span>
    </div>
  )
}

export default function Station() {
  const { stopName: rawName } = useParams()
  const { demo } = useDemo()
  // router decodes %20 already; a defensive re-decode keeps direct links safe
  const stopName = useMemo(() => {
    try {
      return decodeURIComponent(rawName ?? '')
    } catch {
      return rawName ?? ''
    }
  }, [rawName])

  const board = usePoll(() => getDepartures(stopName, demo), 5000, [stopName, demo])
  const departures = board.data?.departures ?? []

  // increments on every successful fetch → row keys change → flaps re-flip
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (board.data) setTick((t) => t + 1)
  }, [board.data])

  useEffect(() => {
    document.title = `${stopName} · Station Board — Routepulse`
  }, [stopName])

  // QR points at this very URL — print it, post it at the stop
  const [qrSrc] = useState(
    () => `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(window.location.href)}`
  )

  const approaching = departures.filter((d) => d.eta_min != null && d.eta_min <= 2)
  const nextEta = departures[0]?.eta_min
  const routeCount = new Set(departures.map((d) => String(d.route_id))).size

  return (
    <div className="space-y-4">
      <style>{FLAP_CSS}</style>

      {/* paper masthead */}
      <section className="rounded-2xl border border-edge bg-paper px-5 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-col gap-7 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <Mono className="text-[11px] font-bold tracking-[0.3em] text-signal">
              EVERY BUS THAT PASSES
            </Mono>
            <h1 className="mt-3 break-words font-display text-[clamp(2.4rem,6vw,4.5rem)] font-semibold leading-[1.02] tracking-tight text-snow">
              {stopName}
            </h1>
            <Mono className="mt-3 block text-xs tracking-[0.18em] text-fog">
              {board.data
                ? `SERVED BY ${routeCount} ROUTE${routeCount === 1 ? '' : 'S'} · REFRESHED EVERY 5 SECONDS`
                : 'READING THE ROAD…'}
            </Mono>

            {/* approaching-now strip */}
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Mono className="text-[10px] font-bold tracking-[0.3em] text-fog">
                APPROACHING NOW
              </Mono>
              {approaching.length > 0 ? (
                approaching.map((d, i) => (
                  <span
                    key={`now-${tick}-${d.bus_id}-${d.route_id}`}
                    className="rp-flap flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-bold"
                    style={{ animationDelay: `${i * 70}ms`, backgroundColor: BOARD_BG, color: BOARD_TEXT }}
                  >
                    <span className="rp-blink inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SIGNAL }} />
                    {d.bus_id}
                  </span>
                ))
              ) : (
                <Mono className="text-[10px] tracking-[0.2em] text-fog">
                  {nextEta != null ? `NOTHING AT THE CURB — NEXT IN ~${Math.round(nextEta)} MIN` : '—'}
                </Mono>
              )}
            </div>
          </div>

          {/* QR block — the analog bridge */}
          <div className="shrink-0 self-start rounded-xl border border-edge bg-panel p-3 text-center">
            <img
              src={qrSrc}
              alt={`QR code linking to the live board for ${stopName}`}
              width={160}
              height={160}
              loading="lazy"
              className="mx-auto block h-[160px] w-[160px] rounded-md bg-white p-1.5"
            />
            <Mono className="mt-2.5 block text-[10px] font-bold tracking-[0.22em] text-fog">
              PRINT &amp; POST AT THE STOP
            </Mono>
          </div>
        </div>
      </section>

      {/* board / empty state */}
      {board.data && departures.length === 0 ? (
        <section className="rounded-2xl border border-edge bg-paper px-6 py-16 text-center sm:py-24">
          <Mono className="text-[11px] font-bold tracking-[0.3em] text-signal">STATION BOARD</Mono>
          <h2 className="mx-auto mt-4 max-w-xl font-display text-3xl font-semibold leading-tight tracking-tight text-snow sm:text-5xl">
            No buses pass here (yet).
          </h2>
          <p className="mx-auto mt-4 max-w-md font-mono text-xs leading-relaxed tracking-wider text-fog">
            NO ACTIVE TRIP SERVES “{stopName}”. CHECK THE SPELLING OR SEARCH YOUR
            ROUTE — THE BOARD FLIPS TO LIFE THE MOMENT A BUS IS ASSIGNED.
          </p>
          <Link
            to="/search"
            className="mt-7 inline-flex min-h-11 items-center rounded-md border border-edge bg-panel px-5 font-mono text-xs font-bold tracking-widest text-fog transition hover:border-signal/60 hover:text-signal"
          >
            SEARCH ROUTES
          </Link>
        </section>
      ) : (
        <section
          className="overflow-hidden rounded-xl shadow-[0_18px_50px_-24px_rgba(33,29,22,0.55)]"
          style={{ backgroundColor: BOARD_BG }}
        >
          {/* board top bar */}
          <div className="flex items-center justify-between border-b px-4 py-2.5 sm:px-5" style={{ borderColor: BOARD_LINE }}>
            <Mono className="text-[10px] font-bold tracking-[0.3em]" style={{ color: SIGNAL }}>
              STATION BOARD
            </Mono>
            <Mono className="text-[10px] tracking-[0.2em]" style={{ color: BOARD_MUTE }}>
              {demo ? 'DEMO DATA' : 'LIVE FEED'} · 5S REFRESH{board.error && board.data ? ' · RETRYING' : ''}
            </Mono>
          </div>

          {/* column header */}
          <div
            className={`${GRID} border-b px-4 py-2.5 font-mono text-[10px] font-bold tracking-[0.25em] sm:px-5`}
            style={{ borderColor: BOARD_LINE, color: BOARD_MUTE }}
          >
            <span>ROUTE</span>
            <span>TO</span>
            <span>ARRIVES</span>
            <span>STATUS</span>
          </div>

          {/* rows */}
          {board.data ? (
            departures.map((d, i) => (
              <DepartureRow key={`${tick}-${d.route_id}-${d.bus_id}`} d={d} delayMs={Math.min(i, 11) * 70} />
            ))
          ) : (
            [0, 1, 2, 3].map((i) => (
              <div key={i} className={`${GRID} items-center border-b px-4 py-3.5 sm:px-5`} style={{ borderColor: BOARD_LINE }}>
                <span className="h-6 animate-pulse rounded-[4px]" style={{ backgroundColor: '#2C271D' }} />
                <span className="h-4 w-3/4 animate-pulse rounded" style={{ backgroundColor: '#2C271D' }} />
                <span className="h-5 w-14 animate-pulse rounded" style={{ backgroundColor: '#2C271D' }} />
                <span className="h-3.5 w-16 animate-pulse rounded" style={{ backgroundColor: '#2C271D' }} />
              </div>
            ))
          )}

          {/* board footer note */}
          <div className="px-4 py-2.5 sm:px-5">
            <Mono className="text-[10px] leading-relaxed tracking-[0.14em]" style={{ color: BOARD_MUTE }}>
              ETA = POLYLINE DISTANCE TO STOP ÷ ROLLING AVG SPEED + REPORTED DELAY ·
              DOT COLOUR = CONFIDENCE
            </Mono>
          </div>
        </section>
      )}
    </div>
  )
}
