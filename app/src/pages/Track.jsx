import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getAlerts, getCrowd, getEtas, getRoute, reportCrowd } from '../api'
import { useLiveLocations, usePoll, useSmoothedLocations, useTick } from '../hooks'
import { useDemo } from '../App'
import { agoMin, ErrorBanner, LiveBadge, MapView, Mono, RouteChip, Skeleton, StatusChip } from '../components'

// backend crowd levels: 'empty' | 'seats' | 'packed'
const CROWD_LEVELS = [
  { label: 'EMPTY', value: 'empty' },
  { label: 'SEATS FULL', value: 'seats' },
  { label: 'PACKED', value: 'packed' },
]

// ETA confidence chip — the novelty twist.
// high: "±1 · HIGH", medium: "±3 · MEDIUM", low/missing → "ESTIMATING…"
function ConfidenceChip({ confidence, range }) {
  if (confidence === 'low') {
    return (
      <span className="rp-blink inline-block whitespace-nowrap rounded border border-fog/40 bg-fog/10 px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider text-fog">
        ESTIMATING…
      </span>
    )
  }
  const high = confidence === 'high'
  const color = high ? '#2E7D4F' : '#E4572E'
  return (
    <span
      className="inline-block whitespace-nowrap rounded border px-1 py-0.5 font-mono text-xs font-bold tracking-wider"
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
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-xs text-fog">
          <span>{eta?.distance_km != null ? `${eta.distance_km} KM` : '—'}</span>
          <span className="text-edge">·</span>
          <span>{eta?.speed_kmh != null ? `${eta.speed_kmh} KM/H` : '—'}</span>
        </div>
      </div>
      <div className="shrink-0 pl-1 text-right">
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
  const { locations, source, lastAlert, crowdUpdates } = useLiveLocations(demo)
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

  // WS-pushed alerts land in <2s (no waiting for the poll) — the magic moment
  const [wsAlerts, setWsAlerts] = useState([])
  useEffect(() => {
    setWsAlerts([])
  }, [routeId, demo])
  useEffect(() => {
    if (!lastAlert) return
    if (lastAlert.route_id && String(lastAlert.route_id) !== String(routeId)) return
    setWsAlerts((list) =>
      list.some((a) => a.alert_id === lastAlert.alert_id)
        ? list
        : [...list, { ...lastAlert, viaWs: true }]
    )
  }, [lastAlert, routeId])

  // WS crowd frames update the chip instantly
  useEffect(() => {
    const f = crowdUpdates?.[routeId]
    if (f) setCrowd({ level: f.level, updated_at: f.updated_at })
  }, [crowdUpdates, routeId])

  const allAlerts = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const a of [...wsAlerts, ...(alerts.data?.alerts ?? [])]) {
      if (seen.has(a.alert_id)) continue
      seen.add(a.alert_id)
      out.push(a)
    }
    return out
  }, [wsAlerts, alerts.data])

  // ETAs — poll every 6s; tick down locally between fetches
  const [etas, setEtas] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(0)
  const [etaErr, setEtaErr] = useState(null)
  const [etaRetry, setEtaRetry] = useState(0)
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
  }, [routeId, demo, etaRetry])

  const routeBuses = useMemo(
    () => locations.filter((b) => b.route_id === routeId),
    [locations, routeId]
  )
  const leadBus = routeBuses[0]
  const { smooth, trails } = useSmoothedLocations(routeBuses)

  // Alert transmission ping — an expanding radar ring fires at the route's
  // first stop when a fresh alert lands (WS or poll), making the two-second
  // round trip visible regardless of transport.
  const [ping, setPing] = useState(null)
  const pingedAlerts = useRef(new Set())
  useEffect(() => {
    const fresh = allAlerts.filter(
      (a) =>
        !pingedAlerts.current.has(a.alert_id) &&
        Date.now() - new Date(a.created_at).getTime() < 15000
    )
    if (!fresh.length) return
    const a = fresh[fresh.length - 1]
    fresh.forEach((x) => pingedAlerts.current.add(x.alert_id))
    if (a.route_id && String(a.route_id) !== String(routeId)) return
    const at = route?.stops?.[0]
    if (!at) return
    setPing({ lat: at.lat, lng: at.lng, key: `ping-${a.alert_id}` })
    const id = setTimeout(() => setPing(null), 7000)
    return () => clearTimeout(id)
  }, [allAlerts, routeId, route])

  // crowd report (P1): latest level + send a new one
  const [crowd, setCrowd] = useState(null)
  const [crowdSent, setCrowdSent] = useState(false)
  useEffect(() => {
    let on = true
    setCrowdSent(false)
    getCrowd(routeId, demo)
      .then((c) => on && setCrowd(c))
      .catch(() => {})
    return () => {
      on = false
    }
  }, [routeId, demo])
  const sendCrowd = (level) => {
    setCrowdSent(true)
    return reportCrowd(routeId, level, demo)
      .then((r) => setCrowd({ level: r.level, updated_at: r.updated_at }))
      .catch(() => {})
  }

  const coords = useMemo(
    () => route?.stops?.map((s) => [s.lat, s.lng]) ?? [],
    [route]
  )

  const etaFor = (stopId) => etas?.find((e) => e.stop_id === stopId)

  // ---- BOARDING ALARM ------------------------------------------------------
  // Pick a stop; when its live ETA crosses the threshold, fire a browser
  // notification + in-page banner. Uses the same confidence-rated ETAs the
  // sidebar ticks — no extra backend.
  const [alarmStop, setAlarmStop] = useState('')
  const [alarmArmed, setAlarmArmed] = useState(false)
  const [alarmFired, setAlarmFired] = useState(null) // { stop_name, eta_min }
  const [alarmDenied, setAlarmDenied] = useState(false)
  const [voiceOn, setVoiceOn] = useState(true)
  const firedRef = useRef(false)

  const armAlarm = async () => {
    if (!alarmStop) return
    if (!('Notification' in window)) return setAlarmDenied(true)
    let perm = Notification.permission
    if (perm === 'default') perm = await Notification.requestPermission()
    if (perm !== 'granted') return setAlarmDenied(true)
    setAlarmDenied(false)
    firedRef.current = false
    setAlarmFired(null)
    setAlarmArmed(true)
  }

  useEffect(() => {
    if (!alarmArmed || !alarmStop || !etas || firedRef.current) return
    const stop = route?.stops?.find((s) => String(s.stop_id) === String(alarmStop))
    const eta = etaFor(alarmStop)
    const etaMin = eta?.eta_min
    if (!stop || etaMin == null) return
    if (etaMin <= 2) {
      firedRef.current = true
      const hit = { stop_name: stop.stop_name, eta_min: Math.max(1, Math.round(etaMin)) }
      setAlarmFired(hit)
      try {
        new Notification('Your bus is almost here', {
          body: `${hit.stop_name} in ~${hit.eta_min} min — time to head out.`,
          tag: 'routepulse-alarm',
        })
      } catch { /* some browsers require SW; banner already shows */ }
      if (voiceOn) {
        try {
          const u = new SpeechSynthesisUtterance(
            `Attention: your bus arrives at ${hit.stop_name} in about ${hit.eta_min} minutes.`
          )
          u.rate = 1.05
          window.speechSynthesis.speak(u)
        } catch { /* speech is optional — banner + notification still fire */ }
      }
    }
  }, [alarmArmed, alarmStop, etas, route, now, voiceOn])

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
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Link
          to="/search"
          className="inline-flex min-h-11 items-center rounded-md border border-edge bg-panel px-3.5 font-mono text-xs font-bold text-fog transition hover:border-phos/50 hover:text-phos"
        >
          ← BACK
        </Link>
        <RouteChip route={route} big />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {route.fare_pkr != null && (
            <span className="whitespace-nowrap rounded-md border border-edge bg-panel px-2 py-1 font-mono text-xs font-bold tracking-widest text-fog">
              PKR {route.fare_pkr}
            </span>
          )}
          <LiveBadge source={demo ? 'demo' : source} />
          {leadBus && <StatusChip status={leadBus.trip_status} />}
        </div>
        <h1 className="w-full min-w-0 truncate text-lg font-bold tracking-tight sm:w-auto sm:flex-1 sm:text-2xl">
          {route.route_name}
        </h1>
      </div>

      {/* alert banners */}
      {allAlerts.length > 0 && (
        <div className="space-y-2">
          {allAlerts.map((a) => (
            <div
              key={`${a.alert_id}-${a.viaWs ? 'ws' : 'poll'}`}
              className={`flex flex-col gap-1.5 rounded-lg border-l-4 border-amber bg-amber/10 px-4 py-3 sm:flex-row sm:items-start sm:gap-3 ${
                a.viaWs ? 'rp-flash' : ''
              }`}
            >
              <Mono className="shrink-0 text-xs font-extrabold tracking-widest text-amber">
                {a.viaWs ? 'JUST NOW · LIVE' : 'SERVICE ALERT'}
              </Mono>
              <p className="min-w-0 flex-1 text-sm leading-snug text-snow">{a.message}</p>
              <Mono className="shrink-0 text-xs text-fog">
                {a.route_id ? `ROUTE ${String(a.route_id).replace('R', '')} · ` : 'ALL ROUTES · '}
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
                color: leadBus?.trip_status === 'Delayed' ? '#FF4757' : '#2ECC71',
              },
            ]}
            stops={route.stops}
            buses={smooth}
            trails={trails}
            ping={ping}
            drawIn
            fitKey={routeId}
            className="rp-map45"
          />

          {/* live input readout — shows the ETA inputs (distance, speed, delay) */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'BUS', value: leadBus ? leadBus.bus_id : '—', color: '#2E7D4F' },
              { label: 'SPEED', value: leadBus ? `${leadBus.speed} KM/H` : '—', color: '#E6EDF3' },
              { label: 'DELAY', value: leadBus ? `${leadBus.delay_minutes} MIN` : '—', color: leadBus?.delay_minutes > 0 ? '#E4572E' : '#8B98A5' },
              { label: 'NEXT STOP', value: leadBus?.next_stop || '—', color: '#E6EDF3', small: true },
            ].map((c) => (
              <div key={c.label} className="min-w-0 rounded-lg border border-edge bg-panel px-3 py-2.5">
                <div className="font-mono text-xs uppercase tracking-[0.2em] text-fog">
                  {c.label}
                </div>
                <div
                  className={`truncate font-mono font-extrabold ${c.small ? 'text-xs' : 'text-base sm:text-lg'}`}
                  style={{ color: c.color }}
                >
                  {c.value}
                </div>
              </div>
            ))}
          </div>
          {/* crowd report (P1) */}
          <div className="rounded-xl border border-edge bg-panel px-4 py-3">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              <Mono className="text-xs font-bold tracking-[0.3em] text-fog">
                HOW CROWDED?
              </Mono>
              <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-2">
                {CROWD_LEVELS.map(({ label, value }) => (
                  <button
                    key={value}
                    onClick={() => sendCrowd(value)}
                    className={`inline-flex min-h-11 items-center justify-center rounded-md border px-2 font-mono text-xs font-bold tracking-wide transition ${
                      crowd?.level === value
                        ? 'border-signal/60 bg-signal/10 text-signal'
                        : 'border-edge bg-panel2 text-fog hover:border-signal/50 hover:text-signal'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <Mono className="text-xs text-fog sm:ml-auto">
                {crowd?.level
                  ? `LATEST · ${crowd.level.toUpperCase()}${crowd.updated_at ? ` · ${agoMin(crowd.updated_at)} MIN AGO` : ''}`
                  : crowdSent
                    ? 'SENDING…'
                    : 'NO REPORTS YET'}
              </Mono>
            </div>
          </div>
        </div>

        {/* ETA sidebar */}
        <aside className="rounded-xl border border-edge bg-panel">
          <div className="flex items-center justify-between border-b border-edge px-4 py-3">
            <Mono className="text-xs font-bold tracking-[0.3em] text-fog">
              STOP ETAS
            </Mono>
            <Mono className="text-xs text-fog">
              {etas ? 'TICKING' : 'LOADING…'}
            </Mono>
          </div>
          {(() => {
            const up = etas?.find((e) => (e.distance_km ?? 0) > 0.05)
            if (!up) return null
            const walkMin = Math.max(1, Math.ceil((up.distance_km / 5) * 60))
            return (
              <div className="border-b border-edge px-4 py-2 font-mono text-xs tracking-widest text-fog">
                WALK TO {String(up.stop_name).toUpperCase()} ≈{' '}
                <span className="font-bold text-snow">{walkMin} MIN</span> (5 KM/H)
              </div>
            )
          })()}
          {etaErr && (
            <div className="p-3">
              <ErrorBanner error={etaErr} onRetry={() => setEtaRetry((n) => n + 1)} />
            </div>
          )}
          {route.stops.map((stop) => {
            const eta = etaFor(stop.stop_id)
            const base = eta?.eta_min != null ? eta.eta_min * 60 : null
            const remainSec = base == null ? null : base - (now - fetchedAt) / 1000
            return <EtaRow key={stop.stop_id} stop={stop} eta={eta} remainSec={remainSec} />
          })}
          {/* ---- BOARDING ALARM ---- */}
          <div className="border-t border-edge px-4 py-3">
            {alarmFired ? (
              <div className="rounded-lg border border-live/50 bg-live/10 px-3 py-2.5">
                <Mono className="text-xs font-bold tracking-widest text-live">
                  ⏰ ALARM — {String(alarmFired.stop_name).toUpperCase()} IN ~{alarmFired.eta_min} MIN
                </Mono>
                <Mono className="mt-1 block text-xs text-fog">Time to head out. Bus is nearly at your stop.</Mono>
                <button
                  onClick={() => { setAlarmFired(null); setAlarmArmed(false); firedRef.current = false }}
                  className="mt-2 min-h-9 rounded-md border border-edge px-3 py-1.5 font-mono text-xs font-bold tracking-widest text-fog hover:text-snow"
                >
                  SET ANOTHER
                </button>
              </div>
            ) : (
              <>
                <Mono className="block text-xs font-bold tracking-[0.25em] text-fog">BOARDING ALARM</Mono>
                <div className="mt-2 flex gap-2">
                  <select
                    value={alarmStop}
                    onChange={(e) => setAlarmStop(e.target.value)}
                    className="min-h-11 w-full rounded-lg border border-edge bg-panel2 px-2 py-2.5 font-mono text-xs text-snow outline-none focus:border-live/60"
                  >
                    <option value="">— pick my stop —</option>
                    {route.stops.map((s) => (
                      <option key={s.stop_id} value={s.stop_id}>{s.stop_name}</option>
                    ))}
                  </select>
                  <button
                    onClick={alarmArmed ? () => { setAlarmArmed(false); firedRef.current = false } : armAlarm}
                    disabled={!alarmStop}
                    className={`min-h-11 shrink-0 rounded-lg border px-3 font-mono text-xs font-bold tracking-widest transition disabled:opacity-40 ${
                      alarmArmed ? 'border-live/60 bg-live/15 text-live' : 'border-edge bg-panel2 text-fog hover:text-snow'
                    }`}
                  >
                    {alarmArmed ? 'ARMED ✓' : 'ARM'}
                  </button>
                  <button
                    onClick={() => setVoiceOn((v) => !v)}
                    title="Spoken announcement when the alarm fires"
                    className={`min-h-11 shrink-0 rounded-lg border px-2.5 font-mono text-xs font-bold tracking-widest transition ${
                      voiceOn ? 'border-edge bg-panel2 text-fog hover:text-snow' : 'border-edge bg-panel2 text-fog/50 hover:text-fog'
                    }`}
                  >
                    {voiceOn ? 'VOX' : 'MUTE'}
                  </button>
                </div>
                <Mono className="mt-1.5 block text-xs text-fog">
                  {alarmDenied
                    ? 'Notifications blocked — enable them for this site.'
                    : alarmArmed
                      ? 'Watching the live ETA — we will ping you ~2 min before it reaches your stop.'
                      : 'Get a notification when your bus is 2 minutes away.'}
                </Mono>
              </>
            )}
          </div>
          <div className="border-t border-edge px-4 py-2.5">
            <Mono className="text-xs leading-relaxed text-fog">
              ETA = DISTANCE TO STOP ÷ ROLLING AVG SPEED + DELAY · CONFIDENCE FROM SPEED
              VARIANCE + POSITION FRESHNESS
            </Mono>
          </div>
        </aside>
      </div>
    </div>
  )
}
