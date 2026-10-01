import { useEffect, useRef, useState } from 'react'
import { endTrip, getDrivers, getNetwork, getRoute, ingestGps, startTrip, updateTrip } from '../api'
import { ROUTES, ALL_BUS_IDS, routeNumber } from '../mock'
import { usePoll } from '../hooks'
import { useDemo } from '../App'
import { ErrorBanner, MapView, Mono, Skeleton, StatusChip } from '../components'
import { VIDEOS } from '../media'

const btn =
  'rounded-lg border px-4 py-3 font-mono text-xs font-bold tracking-widest transition disabled:opacity-40'

export default function Driver() {
  const { demo } = useDemo()
  const [drivers, setDrivers] = useState(null)
  const [err, setErr] = useState(null)
  const [driverId, setDriverId] = useState('')
  const [busId, setBusId] = useState('')
  const [routeId, setRouteId] = useState('')
  const [trip, setTrip] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState(null)
  const [gpsOn, setGpsOn] = useState(false)
  const [gpsPos, setGpsPos] = useState(null)
  const watchRef = useRef(null)
  const gpsPosRef = useRef(null)

  // Seed data gives some drivers mock-style route ids ('R7'); live routes are
  // '7'. Normalize on intake so lookups never 404 and the preview map renders.
  const normRoute = (r) => (r ? String(r).replace(/^R/i, '') : r)

  // Live route/bus options (mock ids never match the deployed database).
  const net = usePoll(() => getNetwork(demo), 60000, [demo])
  const ROUTE_SET = net.data?.routes?.length ? net.data.routes : ROUTES
  const liveBusIds = [...new Set((drivers || []).map((d) => d.assigned_bus).filter(Boolean))]
  const BUS_IDS = liveBusIds.length ? liveBusIds : ALL_BUS_IDS

  useEffect(() => {
    getDrivers(demo)
      .then((d) => {
        setDrivers(d.drivers)
        if (d.drivers[0]) {
          setDriverId(d.drivers[0].driver_id)
          if (d.drivers[0].assigned_bus) setBusId(d.drivers[0].assigned_bus)
          if (d.drivers[0].route_id) setRouteId(normRoute(d.drivers[0].route_id))
        }
      })
      .catch((e) => setErr(e))
  }, [demo])

  const start = async () => {
    if (!busId || !routeId || !driverId) return
    setBusy(true)
    setActionMsg(null)
    try {
      const res = await startTrip({ bus_id: busId, driver_id: driverId, route_id: routeId }, demo)
      setTrip(res.trip)
      setActionMsg({ ok: true, text: `TRIP ${res.trip.trip_id} STARTED` })
    } catch (e) {
      setActionMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const update = async (body, label) => {
    if (!trip) return
    setBusy(true)
    setActionMsg(null)
    try {
      const res = await updateTrip(trip.trip_id, body, demo)
      const next = res.trip || { ...trip, ...body }
      // Cancel/complete set end_time server-side — the trip is over, so drop
      // back to the start panel instead of a dead active-trip screen.
      if (next.end_time || next.trip_status === 'Cancelled' || next.trip_status === 'Completed') {
        setTrip(null)
        stopGps()
      } else {
        setTrip(next)
      }
      setActionMsg({ ok: true, text: label })
    } catch (e) {
      setActionMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    if (!trip) return
    setBusy(true)
    try {
      await endTrip(trip.trip_id, demo)
      setActionMsg({ ok: true, text: 'TRIP COMPLETED' })
      setTrip(null)
      stopGps()
    } catch (e) {
      // A cancel can beat us to it — the client surfaces that as 'API 409
      // …/end' (server text 'trip already ended'), which is success here.
      if (e.message.includes('already ended') || e.message.includes('API 409')) {
        setActionMsg({ ok: true, text: 'TRIP COMPLETED' })
        setTrip(null)
        stopGps()
      } else {
        setActionMsg({ ok: false, text: e.message })
      }
    } finally {
      setBusy(false)
    }
  }

  const stopGps = () => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
    setGpsOn(false)
    setGpsPos(null)
  }

  const toggleGps = () => {
    if (gpsOn) {
      stopGps()
      return
    }
    if (!busId) return
    if (!navigator.geolocation) {
      setActionMsg({ ok: false, text: 'GEOLOCATION NOT SUPPORTED' })
      return
    }
    setGpsOn(true)
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const body = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed || 0,
        }
        gpsPosRef.current = body
        setGpsPos(body)
        ingestGps(busId, body, demo).catch(() => {})
      },
      (e) => {
        setActionMsg({ ok: false, text: `GPS ERROR: ${e.message}` })
        stopGps()
      },
      { enableHighAccuracy: true, maximumAge: 2000 }
    )
  }

  useEffect(() => () => stopGps(), [])

  const driver = drivers?.find((d) => d.driver_id === driverId)

  if (err)
    return <ErrorBanner error={err} onRetry={() => window.location.reload()} />

  return (
    <div className="space-y-6">
      <div>
        <Mono className="text-xs font-bold tracking-[0.3em] text-fog">
          DRIVER CONSOLE
        </Mono>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
          Start your trip
        </h1>
      </div>

      {/* ---------- CAB AMBIENCE ---------- */}
      {VIDEOS[0] && (
        <figure className="relative h-44 overflow-hidden rounded-2xl border border-edge sm:h-56">
          <video
            src={VIDEOS[0].url}
            autoPlay
            muted
            loop
            playsInline
            className="h-full w-full object-cover opacity-80 saturate-[0.85]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-ink/80 via-ink/30 to-transparent" />
          <figcaption className="absolute bottom-3 left-4 max-w-[70%]">
            <Mono className="block text-[10px] tracking-[0.3em] text-snow/80">
              CAB VIEW — STREAMED TO THE CONTROL ROOM
            </Mono>
            <span className="mt-1 block font-mono text-xs text-fog">
              © {VIDEOS[0].by} · Pexels
            </span>
          </figcaption>
        </figure>
      )}

      {!trip ? (
        /* ---------- start trip panel ---------- */
        <section className="w-full rounded-2xl border border-edge bg-panel p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-fog">
                Driver
              </span>
              {!drivers ? (
                <Skeleton className="h-11 w-full" />
              ) : (
                <select
                  value={driverId}
                  onChange={(e) => {
                    setDriverId(e.target.value)
                    const d = drivers.find((x) => x.driver_id === e.target.value)
                    if (d?.assigned_bus) setBusId(d.assigned_bus)
                    if (d?.route_id) setRouteId(normRoute(d.route_id))
                  }}
                  className="min-h-11 w-full rounded-lg border border-edge bg-ink px-3 py-3 font-mono text-sm text-snow outline-none focus:border-phos/60"
                >
                  {drivers.map((d) => (
                    <option key={d.driver_id} value={d.driver_id}>
                      {d.name} ({d.driver_id})
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-fog">
                Bus
              </span>
              <select
                value={busId}
                onChange={(e) => setBusId(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-edge bg-ink px-3 py-3 font-mono text-sm text-snow outline-none focus:border-phos/60"
              >
                <option value="">— select bus —</option>
                {BUS_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-fog">
                Route
              </span>
              <select
                value={routeId}
                onChange={(e) => setRouteId(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-edge bg-ink px-3 py-3 font-mono text-sm text-snow outline-none focus:border-phos/60"
              >
                <option value="">— select route —</option>
                {ROUTE_SET.map((r) => (
                  <option key={r.route_id} value={r.route_id}>
                    {routeNumber(r)} · {r.route_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            onClick={start}
            disabled={!busId || !routeId || busy}
            className="mt-5 w-full rounded-lg bg-phos py-4 font-mono text-sm font-extrabold tracking-[0.25em] text-ink transition hover:bg-[#34d97a] disabled:opacity-40"
          >
            ▶ START TRIP
          </button>
          {driver && (
            <p className="mt-3 font-mono text-xs text-fog">
              ASSIGNED: {driver.assigned_bus || 'SPARE'} · STATUS {driver.status}
            </p>
          )}
        </section>
      ) : (
        /* ---------- active trip panel ---------- */
        <section className="w-full space-y-4">
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-phos/40 bg-phos/5 p-5">
            <div>
              <Mono className="text-xs tracking-[0.3em] text-phos">
                TRIP {trip.trip_id} ACTIVE
              </Mono>
              <div className="mt-1 font-mono text-2xl font-extrabold text-snow">
                BUS {trip.bus_id} · ROUTE {String(trip.route_id).replace('R', '')}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <StatusChip status={trip.trip_status} />
              {trip.delay_minutes > 0 && (
                <span className="font-mono text-sm font-bold text-amber">
                  +{trip.delay_minutes} MIN DELAY
                </span>
              )}
            </div>
          </div>

          {/* status buttons — grid grows to 5 columns while a delay is clearable */}
          <div
            className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${
              trip.delay_minutes > 0 || trip.trip_status === 'Delayed' ? 'lg:grid-cols-5' : 'lg:grid-cols-4'
            }`}
          >
            <button
              onClick={() => update({ trip_status: 'Delayed', delay_minutes: (trip.delay_minutes || 0) + 10, note: 'traffic delay' }, 'TRAFFIC DELAY +10 MIN')}
              disabled={busy}
              className={`${btn} min-h-12 w-full border-amber/50 bg-amber/10 text-amber hover:bg-amber/20`}
            >
              ⚠ TRAFFIC DELAY
            </button>
            <button
              onClick={() => update({ trip_status: 'Delayed', delay_minutes: (trip.delay_minutes || 0) + 20, note: 'vehicle issue' }, 'VEHICLE ISSUE +20 MIN')}
              disabled={busy}
              className={`${btn} min-h-12 w-full border-alert/50 bg-alert/10 text-alert hover:bg-alert/20`}
            >
              ✖ VEHICLE ISSUE
            </button>
            {(trip.delay_minutes > 0 || trip.trip_status === 'Delayed') && (
              <button
                onClick={() => update({ trip_status: 'On Route', delay_minutes: 0 }, 'DELAY CLEARED — BACK ON ROUTE')}
                disabled={busy}
                className={`${btn} min-h-12 w-full border-phos/50 bg-panel text-phos hover:bg-phos/20`}
              >
                ✓ BACK ON ROUTE
              </button>
            )}
            <button
              onClick={() => update({ trip_status: 'Cancelled', note: 'route blocked' }, 'ROUTE BLOCKED — TRIP CANCELLED')}
              disabled={busy}
              className={`${btn} min-h-12 w-full border-fog/50 bg-panel text-fog hover:bg-panel2`}
            >
              ⛔ ROUTE BLOCKED
            </button>
            <button
              onClick={finish}
              disabled={busy}
              className={`${btn} min-h-12 w-full border-phos/50 bg-phos/10 text-phos hover:bg-phos/20`}
            >
              ■ END TRIP
            </button>
          </div>

          {/* GPS toggle */}
          <div className="flex flex-col gap-3 rounded-2xl border border-edge bg-panel p-5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <button
              onClick={toggleGps}
              className={`inline-flex min-h-12 w-full items-center justify-center rounded-lg px-5 py-3 font-mono text-xs font-extrabold tracking-widest transition sm:w-auto ${
                gpsOn
                  ? 'bg-phos text-ink hover:bg-[#34d97a]'
                  : 'border border-edge bg-panel2 text-fog hover:text-snow'
              }`}
            >
              {gpsOn ? '◉ MY GPS: ON' : '◎ ENABLE MY GPS'}
            </button>
            <div className="min-w-0 break-words font-mono text-xs leading-relaxed text-fog">
              {gpsPos ? (
                <span className="text-phos">
                  {gpsPos.lat.toFixed(5)}, {gpsPos.lng.toFixed(5)} · {Math.round(gpsPos.speed || 0)} km/h → POSTING /api/ingest/{busId}
                </span>
              ) : gpsOn ? (
                'ACQUIRING SATELLITES…'
              ) : (
                'phone GPS is the second location source (rule: simulator + driver app)'
              )}
            </div>
          </div>

          {/* simulator note */}
          <p className="rounded-lg border border-cyan/30 bg-cyan/5 px-4 py-3 font-mono text-xs leading-relaxed text-cyan">
            NOTE — BUS MOTION IS DRIVEN BY THE GPS SIMULATOR SERVICE (MOVES ALONG THE
            ROUTE POLYLINE, POSTS EVERY 2s). "ENABLE MY GPS" ADDS REAL PHONE
            COORDINATES AS A SECOND SOURCE. THIS BUILD IS SIMULATED FOR THE DEMO.
          </p>
        </section>
      )}

      {actionMsg && (
        <div
          className={`w-full rounded-lg border px-4 py-2.5 font-mono text-xs font-bold ${
            actionMsg.ok
              ? 'border-phos/40 bg-phos/10 text-phos'
              : 'border-alert/40 bg-alert/10 text-alert'
          }`}
        >
          {actionMsg.ok ? '✓ ' : '✗ '}
          {actionMsg.text}
        </div>
      )}

      {/* small context map of the selected route */}
      <RouteMiniMap routeId={routeId || trip?.route_id} demo={demo} />
    </div>
  )
}

function RouteMiniMap({ routeId, demo }) {
  const [route, setRoute] = useState(null)
  useEffect(() => {
    if (!routeId) return
    let live = true
    getRoute(routeId, demo)
      .then((r) => live && setRoute(r))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [routeId, demo])
  if (!route) return null
  return (
    <MapView
      polylines={[
        {
          // road-snapped geometry, same as the operator/track maps — fall back
          // to stop-to-stop only if the API returned no road polyline
          coords: route.road_polyline?.length
            ? route.road_polyline
            : route.stops.map((s) => [s.lat, s.lng]),
          opacity: 0.5,
        },
      ]}
      stops={route.stops}
      fitKey={route.route_id + String(demo)}
      className="h-72 w-full opacity-80"
    />
  )
}
