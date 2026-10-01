import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getAlerts,
  getBunching,
  getDelayPatterns,
  getDrivers,
  getConditions,
  getEtaAccuracy,
  getNetwork,
  getReplay,
  getStats,
  publishAlert,
} from '../api'
import { ROUTES, routeNumber } from '../mock'
import { useLiveLocations, usePoll, useSmoothedLocations } from '../hooks'
import { useDemo } from '../App'
import {
  ErrorBanner,
  Kpi,
  LiveBadge,
  MapView,
  Mono,
  Skeleton,
  StatusChip,
  STATUS_COLORS,
  agoMin,
} from '../components'

// Vivid night-register palette, keyed by both mock (R#) and live (numeric) ids.
const ROUTE_COLORS = {
  R7: '#2ECC71',
  R5: '#FF6B35',
  R3: '#FF4757',
  R9: '#F1C40F',
  1: '#2ECC71',
  2: '#FF6B35',
  3: '#FF4757',
  4: '#F1C40F',
  5: '#1DD1A1',
  6: '#16C79A',
  7: '#FFA502',
  8: '#7D5FFF',
}

export default function Operator() {
  const { demo } = useDemo()
  const { locations, source } = useLiveLocations(demo)
  const stats = usePoll(() => getStats(demo), 5000, [demo])
  const drivers = usePoll(() => getDrivers(demo), 15000, [demo])
  const allAlerts = usePoll(() => getAlerts(null, demo), 8000, [demo])
  const net = usePoll(() => getNetwork(demo), 30000, [demo])
  const rhythm = usePoll(() => getDelayPatterns(demo), 60000, [demo])
  const accuracy = usePoll(() => getEtaAccuracy(demo), 60000, [demo])
  const conditions = usePoll(() => getConditions(demo), 600000, [demo])
  const bunching = usePoll(() => getBunching(demo), 6000, [demo])
  const ROUTE_SET = net.data?.routes?.length ? net.data.routes : ROUTES
  const { smooth, trails } = useSmoothedLocations(locations)

  // ---- TIME TRAVEL: fetch + play back the fleet's recent past -------------
  const [replay, setReplay] = useState(null) // { frames, step_s, recorded_minutes }
  const [replayIdx, setReplayIdx] = useState(0)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replayLoading, setReplayLoading] = useState(false)
  const replayRef = useRef(null)

  const loadReplay = async () => {
    setReplayLoading(true)
    try {
      const data = await getReplay(60)
      setReplay(data)
      setReplayIdx(Math.max(0, data.frames.length - 1))
      setReplayPlaying(true)
    } catch {
      setReplay({ frames: [], step_s: 10, recorded_minutes: 0 })
    } finally {
      setReplayLoading(false)
    }
  }

  useEffect(() => {
    if (!replayPlaying || !replay?.frames?.length) return
    replayRef.current = setInterval(() => {
      setReplayIdx((i) => {
        if (i + 1 >= replay.frames.length) {
          setReplayPlaying(false)
          return i
        }
        return i + 1
      })
    }, 240) // ~40× faster than wall clock at 10s steps
    return () => clearInterval(replayRef.current)
  }, [replayPlaying, replay])

  const replayFrame = replay?.frames?.[replayIdx]
  const replayBuses = replayFrame
    ? replayFrame.buses.map((b) => ({
        bus_id: b.bus_id,
        route_id: b.route_id,
        lat: b.lat,
        lng: b.lng,
        speed: b.speed,
        delay_minutes: b.delay_minutes,
        trip_status: b.trip_status,
        next_stop: null,
      }))
    : []
  const replayAt = replayFrame ? new Date(replayFrame.at).toLocaleTimeString() : null

  // Delay heat: any route whose worst bus runs ≥5 min late glows on the map.
  const hotRoutes = useMemo(() => {
    const worst = {}
    for (const b of locations) {
      if (b.route_id && b.delay_minutes > 0)
        worst[b.route_id] = Math.max(worst[b.route_id] || 0, b.delay_minutes)
    }
    return new Set(
      Object.keys(worst).filter((r) => worst[r] >= 5).map(String)
    )
  }, [locations])

  // alert publisher state
  const [alertRoute, setAlertRoute] = useState('ALL')
  const [alertMsg, setAlertMsg] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [pubMsg, setPubMsg] = useState(null)

  const publish = async () => {
    if (!alertMsg.trim()) return
    setPublishing(true)
    setPubMsg(null)
    try {
      await publishAlert(alertRoute === 'ALL' ? null : alertRoute, alertMsg.trim(), demo)
      setPubMsg({ ok: true, text: 'ALERT PUBLISHED — PASSENGERS SEE IT LIVE' })
      setAlertMsg('')
      allAlerts.reload()
    } catch (e) {
      setPubMsg({ ok: false, text: e.message })
    } finally {
      setPublishing(false)
    }
  }

  const driverFor = (loc) => {
    const ds = drivers.data?.drivers || []
    const d =
      ds.find((x) => x.assigned_bus === loc.bus_id) ||
      (loc.trip_id ? ds.find((x) => x.current_trip === loc.trip_id) : null)
    return d?.name || '—'
  }

  const allCoords = ROUTE_SET.map((r) => {
    const hot = hotRoutes.has(String(r.route_id))
    return {
      coords: r.road_polyline?.length
        ? r.road_polyline
        : r.stops.map((s) => [s.lat, s.lng]),
      color: ROUTE_COLORS[r.route_id] || '#2E7D4F',
      weight: hot ? 5 : 2,
      opacity: hot ? 0.95 : 0.35,
      hot,
    }
  })
  const allStops = ROUTE_SET.flatMap((r) =>
    r.stops.map((s) => ({ ...s, stop_name: `${routeNumber(r)}·${s.stop_name}` }))
  )

  const s = stats.data

  return (
    <div className="night -mx-4 -my-6 space-y-6 px-4 py-6 sm:-mx-6 sm:px-6">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <Mono className="text-xs font-bold tracking-[0.3em] text-fog">
            OPERATOR DASHBOARD
          </Mono>
          <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
            Network control
          </h1>
        </div>
        <div className="ml-auto">
          <LiveBadge source={demo ? 'demo' : source} />
        </div>
      </div>

      {stats.error && <ErrorBanner error={stats.error} onRetry={stats.reload} />}

      {/* KPI row — scroll-snap rail on phones, grid from sm up */}
      <section className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-7">
        <Kpi label="Total buses" value={s?.total_buses ?? '—'} loading={stats.loading} className="w-[46%] max-w-[230px] shrink-0 snap-start sm:w-auto sm:max-w-none" />
        <Kpi label="Active" value={s?.active_buses ?? '—'} color="#2E7D4F" loading={stats.loading} className="w-[46%] max-w-[230px] shrink-0 snap-start sm:w-auto sm:max-w-none" />
        <Kpi label="Delayed" value={s?.delayed_buses ?? '—'} color="#E4572E" loading={stats.loading} className="w-[46%] max-w-[230px] shrink-0 snap-start sm:w-auto sm:max-w-none" />
        <Kpi label="Offline" value={s?.offline_buses ?? '—'} color="#EF4444" loading={stats.loading} className="w-[46%] max-w-[230px] shrink-0 snap-start sm:w-auto sm:max-w-none" />
        <Kpi label="Routes running" value={s?.routes_running ?? '—'} color="#E4572E" loading={stats.loading} className="w-[46%] max-w-[230px] shrink-0 snap-start sm:w-auto sm:max-w-none" />
        <Kpi label="Trips today" value={s?.trips_today ?? '—'} loading={stats.loading} className="w-[46%] max-w-[230px] shrink-0 snap-start sm:w-auto sm:max-w-none" />
        <Kpi
          label="Avg delay"
          value={s?.avg_delay_min ?? '—'}
          suffix="min"
          color="#E4572E"
          loading={stats.loading}
          className="w-[46%] max-w-[230px] shrink-0 snap-start sm:w-auto sm:max-w-none"
        />
      </section>

      {/* fleet map + alert publisher */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
        <MapView
          night
          polylines={allCoords}
          stops={allStops}
          buses={smooth}
          trails={trails}
          drawIn
          fitKey={`fleet-${demo}-${ROUTE_SET.map((r) => r.route_id).join('_')}`}
          className="rp-map45"
        />

        {/* ---- TIME TRAVEL ---- */}
        <section className="rounded-xl border border-edge bg-panel">
          <div className="flex flex-wrap items-center gap-3 border-b border-edge px-4 py-3">
            <Mono className="text-xs font-bold tracking-[0.3em] text-fog">TIME TRAVEL</Mono>
            <Mono className="text-[10px] text-fog">REPLAY THE NETWORK'S RECENT PAST</Mono>
            <div className="ml-auto flex items-center gap-2">
              {!replay ? (
                <button
                  onClick={loadReplay}
                  disabled={replayLoading}
                  className="min-h-9 rounded-md border border-edge bg-panel2 px-3 font-mono text-xs font-bold tracking-widest text-fog transition hover:text-snow disabled:opacity-40"
                >
                  {replayLoading ? 'FETCHING FOOTAGE…' : '▶ REPLAY LAST 60 MIN'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setReplayPlaying((v) => !v)}
                    disabled={!replay?.frames?.length}
                    className="min-h-9 rounded-md border border-phos/50 bg-phos/10 px-3 font-mono text-xs font-bold tracking-widest text-phos disabled:opacity-40"
                  >
                    {replayPlaying ? '❚❚ PAUSE' : '▶ PLAY'}
                  </button>
                  <button
                    onClick={() => { setReplay(null); setReplayPlaying(false) }}
                    className="min-h-9 rounded-md border border-edge bg-panel2 px-3 font-mono text-xs font-bold tracking-widest text-fog hover:text-snow"
                  >
                    EXIT
                  </button>
                </>
              )}
            </div>
          </div>
          {replay && (
            <div className="px-4 py-3">
              {replay.frames?.length < 2 ? (
                <Mono className="text-xs text-fog">
                  COLLECTING FOOTAGE — THE BUFFER HAS ONLY {replay.frames?.length ?? 0} SNAPSHOT(S).
                  THE SERVER RECORDS EVERY 10s; COME BACK IN A MINUTE.
                </Mono>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={replay.frames.length - 1}
                      value={replayIdx}
                      onChange={(e) => { setReplayPlaying(false); setReplayIdx(Number(e.target.value)) }}
                      className="h-1.5 w-full accent-[#4C9E6D]"
                    />
                    <Mono className="w-40 shrink-0 text-right text-xs text-fog">
                      {replayAt} · T−{Math.max(0, Math.round(((replay.frames[replay.frames.length - 1].at - replayFrame.at) / 60000) * 10) / 10)}m
                    </Mono>
                  </div>
                  <div className="mt-3">
                    <MapView
                      night
                      polylines={allCoords}
                      buses={replayBuses}
                      fitKey={`replay-${replayIdx === replay.frames.length - 1}`}
                      className="h-[300px]"
                    />
                  </div>
                  <Mono className="mt-2 block text-[10px] text-fog">
                    FRAME {replayIdx + 1}/{replay.frames.length} · RECORDED {replay.recorded_minutes} MIN ·
                    WATCH B-14's DELAY BLOOM AND THE LOOP WRAP AROUND MIDNIGHT BUS STOPS
                  </Mono>
                </>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {/* publisher */}
          <div className="rounded-xl border border-edge bg-panel p-5">
            <Mono className="text-xs font-bold tracking-[0.3em] text-fog">
              PUBLISH SERVICE ALERT
            </Mono>
            <div className="mt-3 space-y-3">
              <select
                value={alertRoute}
                onChange={(e) => setAlertRoute(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-edge bg-ink px-3 py-3 font-mono text-sm text-snow outline-none focus:border-phos/60"
              >
                <option value="ALL">ALL ROUTES (network-wide)</option>
                {ROUTE_SET.map((r) => (
                  <option key={r.route_id} value={r.route_id}>
                    {routeNumber(r)} · {r.route_name}
                  </option>
                ))}
              </select>
              <textarea
                value={alertMsg}
                onChange={(e) => setAlertMsg(e.target.value)}
                rows={3}
                placeholder="e.g. Route 5 delayed ~15 min — accident near Main Market"
                className="w-full resize-none rounded-lg border border-edge bg-ink px-3 py-3 font-mono text-sm text-snow placeholder:text-fog/50 outline-none focus:border-phos/60"
              />
              <button
                onClick={publish}
                disabled={publishing || !alertMsg.trim()}
                className="min-h-12 w-full rounded-lg bg-amber py-3 font-mono text-xs font-extrabold tracking-[0.25em] text-ink transition hover:bg-[#fbbf24] disabled:opacity-40"
              >
                {publishing ? 'PUBLISHING…' : '▲ PUBLISH ALERT'}
              </button>
              {pubMsg && (
                <div
                  className={`rounded-lg border px-3 py-2 font-mono text-xs font-bold ${
                    pubMsg.ok
                      ? 'border-phos/40 bg-phos/10 text-phos'
                      : 'border-alert/40 bg-alert/10 text-alert'
                  }`}
                >
                  {pubMsg.ok ? '✓ ' : '✗ '}
                  {pubMsg.text}
                </div>
              )}
            </div>
          </div>

          {/* recent alerts */}
          <div className="rounded-xl border border-edge bg-panel">
            <div className="border-b border-edge px-4 py-3 font-mono text-xs font-bold tracking-[0.3em] text-fog">
              ACTIVE ALERTS
            </div>
            <div className="max-h-56 overflow-y-auto">
              {(allAlerts.data?.alerts || []).map((a) => (
                <div
                  key={a.alert_id}
                  className="flex items-start gap-2 border-b border-edge/50 px-4 py-2.5 last:border-0"
                >
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
                  <div className="min-w-0">
                    <div className="text-xs leading-snug text-snow">{a.message}</div>
                    <div className="mt-0.5 font-mono text-xs text-fog">
                      {a.route_id ? `ROUTE ${String(a.route_id).replace('R', '')}` : 'ALL ROUTES'} ·{' '}
                      {agoMin(a.created_at)} MIN AGO
                    </div>
                  </div>
                </div>
              ))}
              {allAlerts.loading && (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* delay rhythm + ETA accuracy — mined from completed-trip history (WP3) */}
      {(rhythm.data?.patterns?.length || accuracy.data) && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <div className="overflow-hidden rounded-xl border border-edge bg-panel">
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
              <Mono className="text-xs font-bold tracking-[0.3em] text-fog">DELAY RHYTHM</Mono>
              <Mono className="text-xs text-fog">MINED FROM COMPLETED TRIPS</Mono>
            </div>
            <div>
              {(rhythm.data?.patterns || []).slice(0, 4).map((p) => (
                <div
                  key={p.route_id}
                  className="flex items-start gap-3 border-b border-edge/40 px-4 py-3 last:border-0"
                >
                  <span
                    className="w-10 shrink-0 pt-0.5 font-mono text-xs font-bold"
                    style={{ color: ROUTE_COLORS[p.route_id] || '#8B98A5' }}
                  >
                    {String(p.route_id).replace('R', '')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="truncate text-xs text-snow">{p.route_name}</span>
                      <span className="font-mono text-xs font-bold text-amber">
                        WORST {String(p.worst_hour).padStart(2, '0')}:00 · +{p.worst_avg_delay_min}{' '}
                        MIN AVG
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs leading-snug text-fog">
                      {p.verdict}
                    </div>
                  </div>
                </div>
              ))}
              {rhythm.loading && !rhythm.data && (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-full" />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-edge bg-panel p-5">
            <Mono className="text-xs font-bold tracking-[0.3em] text-fog">ETA ACCURACY</Mono>
            {accuracy.data ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-phos">
                    {accuracy.data.within_2min_pct}%
                  </span>
                  <span className="font-mono text-xs text-fog">OF ETAS WITHIN 2 MIN</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink">
                  <div
                    className="h-full rounded-full bg-phos/70"
                    style={{ width: `${accuracy.data.within_2min_pct}%` }}
                  />
                </div>
                <div className="font-mono text-xs text-fog">
                  {accuracy.data.samples} SAMPLES · MEDIAN ERROR{' '}
                  {accuracy.data.median_error_min} MIN
                </div>
              </div>
            ) : (
              <Skeleton className="mt-3 h-16 w-full" />
            )}
          </div>

          <div className="rounded-xl border border-edge bg-panel p-5">
            <div className="flex items-center justify-between">
              <Mono className="text-xs font-bold tracking-[0.3em] text-fog">CITY CONDITIONS</Mono>
              <Mono className="text-[10px] text-fog">LIVE · OPEN-METEO</Mono>
            </div>
            {conditions.data ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-baseline gap-3">
                  <span className="text-3xl font-bold text-snow">
                    {conditions.data.temperature_c}°C
                  </span>
                  <span className="font-mono text-xs text-fog">
                    HUM {conditions.data.humidity}% · WIND {conditions.data.wind_kmh} KM/H
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-2xl font-bold ${
                      conditions.data.us_aqi != null && conditions.data.us_aqi >= 151
                        ? 'text-amber'
                        : 'text-phos'
                    }`}
                  >
                    AQI {conditions.data.us_aqi ?? '—'}
                  </span>
                  {conditions.data.verdict && (
                    <span className="font-mono text-[10px] font-bold tracking-widest text-amber">
                      {conditions.data.verdict.band}
                    </span>
                  )}
                </div>
                {conditions.data.verdict && (
                  <div className="font-mono text-xs leading-snug text-fog">
                    {conditions.data.verdict.note}
                  </div>
                )}
              </div>
            ) : (
              <Skeleton className="mt-3 h-16 w-full" />
            )}
          </div>

          <div className="rounded-xl border border-edge bg-panel p-5">
            <div className="flex items-center justify-between">
              <Mono className="text-xs font-bold tracking-[0.3em] text-fog">BUNCHING RADAR</Mono>
              <Mono className="text-[10px] text-fog">PAIRS &lt; {bunching.data?.threshold_m ?? 400} M</Mono>
            </div>
            {bunching.data ? (
              bunching.data.pairs.length ? (
                <div className="mt-3 space-y-2">
                  {bunching.data.pairs.map((p, i) => (
                    <div key={i} className="rounded-lg border border-amber/40 bg-amber/5 px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <Mono className="text-xs font-bold text-amber">
                          {p.bus_a} + {p.bus_b}
                        </Mono>
                        <Mono className="text-xs text-fog">{p.gap_m} M APART</Mono>
                      </div>
                      <Mono className="mt-0.5 block text-[10px] leading-snug text-fog">
                        ROUTE {String(p.route_id).replace('R', '')} · {p.avg_speed_kmh} KM/H TOGETHER —
                        HOLD {p.bus_b} AT ITS NEXT STOP ~2 MIN TO RE-SPREAD THE LINE
                      </Mono>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-phos">SPREAD</span>
                    <Mono className="text-xs text-fog">
                      {bunching.data.buses_scanned} BUSES · {bunching.data.routes_scanned} ROUTES
                    </Mono>
                  </div>
                  <div className="font-mono text-xs leading-snug text-fog">
                    no same-route pairs within {bunching.data.threshold_m} m — headways healthy
                  </div>
                </div>
              )
            ) : (
              <Skeleton className="mt-3 h-16 w-full" />
            )}
          </div>
        </section>
      )}

      {/* fleet table */}
      <section className="overflow-hidden rounded-xl border border-edge bg-panel">
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <Mono className="text-xs font-bold tracking-[0.3em] text-fog">
            LIVE FLEET
          </Mono>
          <Mono className="text-xs text-fog">
            {locations.length} BUSES REPORTING
          </Mono>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="border-b border-edge font-mono text-xs uppercase tracking-[0.2em] text-fog">
                <th className="sticky left-0 z-10 border-r border-edge/60 bg-panel px-4 py-2.5 font-semibold">Bus</th>
                <th className="px-4 py-2.5 font-semibold">Route</th>
                <th className="px-4 py-2.5 font-semibold">Driver</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Delay</th>
                <th className="px-4 py-2.5 font-semibold">Speed</th>
                <th className="px-4 py-2.5 font-semibold">Next stop</th>
                <th className="px-4 py-2.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {locations.map((b) => (
                <tr
                  key={b.bus_id}
                  className="group border-b border-edge/40 transition last:border-0 hover:bg-panel2"
                >
                  <td className="sticky left-0 z-10 border-r border-edge/60 bg-panel px-4 py-3 font-bold text-snow transition group-hover:bg-panel2">
                    {b.bus_id}
                  </td>
                  <td className="px-4 py-3" style={{ color: ROUTE_COLORS[b.route_id] || '#8B98A5' }}>
                    {b.route_id ? `ROUTE ${routeNumber({ route_id: b.route_id })}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-fog">{driverFor(b)}</td>
                  <td className="px-4 py-3">
                    <StatusChip status={b.trip_status} />
                  </td>
                  <td
                    className="px-4 py-3 font-bold"
                    style={{ color: b.delay_minutes > 0 ? '#E4572E' : '#8B98A5' }}
                  >
                    {b.delay_minutes > 0 ? `+${b.delay_minutes}m` : '0m'}
                  </td>
                  <td className="px-4 py-3 text-fog">
                    {b.speed != null ? `${Number(b.speed).toFixed(1)} km/h` : '—'}
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-fog">
                    {b.next_stop || '—'}
                  </td>
                  <td className="px-4 py-3">
                    {b.route_id && (
                      <Link
                        to={`/track/${b.route_id}`}
                        className="inline-flex min-h-11 items-center whitespace-nowrap rounded border border-phos/40 bg-phos/10 px-2.5 font-bold text-phos hover:bg-phos/20"
                      >
                        TRACK →
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {locations.length === 0 &&
                [0, 1, 2, 3].map((i) => (
                  <tr key={i}>
                    <td colSpan={8} className="px-4 py-3">
                      <Skeleton className="h-6 w-full" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* status legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(STATUS_COLORS)
          .filter(([k]) => !['Completed', 'Cancelled'].includes(k))
          .map(([k, c]) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-fog"
            >
              <span className="h-2 w-2 rounded-full" style={{ background: c }} />
              {k}
            </span>
          ))}
      </div>
    </div>
  )
}
