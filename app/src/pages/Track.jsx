import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAlerts, getEtas, getRoute } from '../api'
import { useLiveLocations, usePoll, useTick } from '../hooks'
import { useDemo } from '../App'
import { agoMin, ErrorBanner, LiveBadge, MapView, Mono, RouteChip, Skeleton, StatusChip } from '../components'

// ETA confidence chip — the novelty twist.
// high: "±1 · HIGH", medium: "±3 · MEDIUM", low/missing → "ESTIMATING…"
function ConfidenceChip({ confidence, range }) {
  if (confidence === 'low') {
    return (
      <span className="rp-blink inline-block rounded border border-fog/40 bg-fog/10 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-fog">
        ESTIMATING…
      </span>
    )
  }
  const high = confidence === 'high'
  const color = high ? '#22C55E' : '#F59E0B'
  return (
    <span
      className="inline-block rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider"
      style={{ color, borderColor: `${color}55`, background: `${color}12` }}
      title={high ? 'Stable speed + fresh position' : 'Speed varying — treat as rough'}
    >
      ±{range ?? (high ? 1 : 3)} · {high ? 'HIGH' : 'MED'}
    </span>
  )
}

function EtaRow({ stop, eta, remainSec }) {
  const m = Math.floor(Math.max(0, remainSec) / 60)
  const s = Math.floor(Math.max(0, remainSec) % 60)
  const due = remainSec <= 0
  return (
    <div className="flex items-center gap-3 border-b border-edge/60 px-4 py-3 last:border-0">
      <span className="w-6 shrink-0 text-center font-mono text-xs font-bold text-fog">
        {stop.stop_order}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-snow">{stop.stop_name}</div>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-fog">
          <span>{eta?.distance_km != null ? `${eta.distance_km} KM` : '—'}</span>
          <span className="text-edge">·</span>
          <span>{eta?.speed_kmh != null ? `${eta.speed_kmh} KM/H` : '—'}</span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        {eta == null || eta.eta_min == null ? (
          <Skeleton className="h-6 w-16" />
        ) : due ? (
          <span className="rp-blink font-mono text-lg font-extrabold text-phos">DUE</span>
        ) : (
          <span className="font-mono text-lg font-extrabold tabular-nums text-snow">
            {m}:{String(s).padStart(2, '0')}
          </span>
        )}
        <div className="mt-1">
          <ConfidenceChip confidence={eta?.confidence} range={eta?.eta_range_min} />
        </div>
      </div>
    </div>
  )
}

export default function Track() {
  const { routeId } = useParams()
  const { demo } = useDemo()
  const { locations, source } = useLiveLocations(demo)
  const now = useTick(1000) // drives the visible countdown

  // route (static per page) — refetch if mock toggle flips
  const [route, setRoute] = useState(null)
  const [routeErr, setRouteErr] = useState(null)
  useEffect(() => {
    let live = true
    setRoute(null)
    setRouteErr(null)
    getRoute(routeId, demo)
      .then((r) => live && setRoute(r))
      .catch((e) => live && setRouteErr(e))
    return () => {
      live = false
    }
  }, [routeId, demo])

  // alerts — poll every 8s so operator publishes appear live
  const alerts = usePoll(() => getAlerts(routeId, demo), 8000, [routeId, demo])

  // ETAs — poll every 6s; tick down locally between fetches
  const [etas, setEtas] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(0)
  const [etaErr, setEtaErr] = useState(null)
  useEffect(() => {
    let live = true
    const load = () =>
      getEtas(routeId, demo)
        .then((d) => {
          if (!live) return
          setEtas(d.etas || [])
          setFetchedAt(Date.now())
          setEtaErr(null)
        })
        .catch((e) => live && setEtaErr(e))
    load()
    const id = setInterval(load, 6000)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [routeId, demo])

  const routeBuses = useMemo(
    () => locations.filter((b) => b.route_id === routeId),
    [locations, routeId]
  )
  const leadBus = routeBuses[0]

  const coords = useMemo(
    () => route?.stops?.map((s) => [s.lat, s.lng]) ?? [],
    [route]
  )

  const etaFor = (stopId) => etas?.find((e) => e.stop_id === stopId)

  if (routeErr)
    return (
      <div className="space-y-4">
        <ErrorBanner error={routeErr} onRetry={() => window.location.reload()} />
      </div>
    )
  if (!route)
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    )

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/"
          className="rounded-md border border-edge bg-panel px-3 py-1.5 font-mono text-xs font-bold text-fog transition hover:border-phos/50 hover:text-phos"
        >
          ← BACK
        </Link>
        <RouteChip route={route} big />
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          {route.route_name}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <LiveBadge source={demo ? 'demo' : source} />
          {leadBus && <StatusChip status={leadBus.trip_status} />}
        </div>
      </div>

      {/* alert banners */}
      {alerts.data?.alerts?.length > 0 && (
        <div className="space-y-2">
          {alerts.data.alerts.map((a) => (
            <div
              key={a.alert_id}
              className="flex items-start gap-3 rounded-lg border-l-4 border-amber bg-amber/10 px-4 py-3"
            >
              <Mono className="shrink-0 text-[10px] font-extrabold tracking-widest text-amber">
                [ SERVICE ALERT ]
              </Mono>
              <p className="flex-1 text-sm text-snow">{a.message}</p>
              <Mono className="shrink-0 text-[10px] text-fog">
                {a.route_id ? `ROUTE ${a.route_id.replace('R', '')} · ` : 'ALL ROUTES · '}
                {agoMin(a.created_at)} MIN AGO
              </Mono>
            </div>
          ))}
        </div>
      )}

      {/* main grid: map + ETA sidebar */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <MapView
            polylines={[
              {
                coords,
                color: leadBus?.trip_status === 'Delayed' ? '#F59E0B' : '#22C55E',
              },
            ]}
            stops={route.stops}
            buses={routeBuses}
            fitKey={routeId}
            className="h-[380px] sm:h-[480px]"
          />

          {/* live input readout — shows the ETA inputs (distance, speed, delay) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'BUS', value: leadBus ? leadBus.bus_id : '—', color: '#22C55E' },
              { label: 'SPEED', value: leadBus ? `${leadBus.speed} KM/H` : '—', color: '#E6EDF3' },
              { label: 'DELAY', value: leadBus ? `${leadBus.delay_minutes} MIN` : '—', color: leadBus?.delay_minutes > 0 ? '#F59E0B' : '#8B98A5' },
              { label: 'NEXT STOP', value: leadBus?.next_stop || '—', color: '#E6EDF3', small: true },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-edge bg-panel px-3 py-2.5">
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-fog">
                  {c.label}
                </div>
                <div
                  className={`truncate font-mono font-extrabold ${c.small ? 'text-xs' : 'text-lg'}`}
                  style={{ color: c.color }}
                >
                  {c.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ETA sidebar */}
        <aside className="rounded-xl border border-edge bg-panel">
          <div className="flex items-center justify-between border-b border-edge px-4 py-3">
            <Mono className="text-[10px] font-bold tracking-[0.3em] text-fog">
              [ STOP ETAS ]
            </Mono>
            <Mono className="text-[10px] text-fog">
              {etas ? 'TICKING' : 'LOADING…'}
            </Mono>
          </div>
          {etaErr && (
            <div className="p-3">
              <ErrorBanner error={etaErr} onRetry={() => setFetchedAt(0)} />
            </div>
          )}
          {route.stops.map((stop) => {
            const eta = etaFor(stop.stop_id)
            const base = eta?.eta_min != null ? eta.eta_min * 60 : null
            const remainSec = base == null ? null : base - (now - fetchedAt) / 1000
            return <EtaRow key={stop.stop_id} stop={stop} eta={eta} remainSec={remainSec} />
          })}
          <div className="border-t border-edge px-4 py-2.5">
            <Mono className="text-[9px] leading-relaxed text-fog">
              ETA = DISTANCE TO STOP ÷ ROLLING AVG SPEED + DELAY · CONFIDENCE FROM SPEED
              VARIANCE + POSITION FRESHNESS
            </Mono>
          </div>
        </aside>
      </div>
    </div>
  )
}
