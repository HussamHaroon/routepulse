import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCrowd, getNetwork, searchRoutes } from '../api'
import { getFavs, toggleFav } from '../favs'
import { ALL_STOP_NAMES, haversineKm, routeNumber } from '../mock'
import { useLiveLocations } from '../hooks'
import { useDemo } from '../App'
import { ErrorBanner, Mono, RouteChip, Skeleton } from '../components'
import { ROUTE_PHOTOS, GALLERY } from '../media'

function nextBusMinutes(locations, route, atStopName) {
  const stop = route.stops?.find((s) => s.stop_name === atStopName) || route.stops?.[0]
  if (!stop) return null
  const buses = locations.filter(
    (b) => b.route_id === route.route_id && b.trip_status !== 'Offline'
  )
  if (!buses.length) return null
  const etas = buses.map((b) => {
    const d = haversineKm(b.lat, b.lng, stop.lat, stop.lng)
    return (d / Math.max(b.speed || 10, 5)) * 60 + (b.delay_minutes || 0)
  })
  return Math.max(1, Math.round(Math.min(...etas)))
}

// latest crowd report for a route (backend in-memory store)
function CrowdChip({ routeId }) {
  const [level, setLevel] = useState(null)
  useEffect(() => {
    let on = true
    getCrowd(routeId, false)
      .then((c) => on && setLevel(c.level))
      .catch(() => {})
    return () => {
      on = false
    }
  }, [routeId])
  if (!level) return null
  // backend vocabulary is lowercase: 'empty' | 'seats' | 'packed' (api/server.js)
  const lvl = String(level).toLowerCase()
  const color = lvl === 'packed' ? '#B3402E' : lvl === 'seats' ? '#E4572E' : '#2E7D4F'
  return (
    <span
      className="rounded-md border px-2 py-0.5 font-mono text-xs font-bold tracking-widest"
      style={{ color, borderColor: `${color}55`, background: `${color}12` }}
      title="Latest rider crowd report"
    >
      CROWD · {lvl === 'seats' ? 'SEATS FULL' : lvl.toUpperCase()}
    </span>
  )
}

function ResultCard({ route, locations, faved, onToggleFav }) {
  const isTransfer = !!route.transfer
  const mins = nextBusMinutes(locations, route, route.start_location)
  const photo = ROUTE_PHOTOS[String(route.route_id)]
  return (
    <Link
      to={`/track/${route.route_id}`}
      className={`group block overflow-hidden rounded-xl border transition hover:-translate-y-0.5 ${
        isTransfer
          ? 'border-amber/40 bg-amber/5 hover:border-amber/70'
          : 'border-edge bg-panel hover:border-phos/60 hover:bg-panel2'
      }`}
    >
      {photo && (
        <div className="relative h-28 overflow-hidden sm:h-32">
          <img
            src={photo.url}
            alt={photo.alt}
            loading="lazy"
            className="h-full w-full object-cover sepia-[0.12] saturate-[0.9] transition duration-700 group-hover:scale-[1.04]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-transparent" />
          <span className="absolute bottom-2 left-3 font-mono text-[10px] tracking-widest text-snow/90">
            © {photo.by.toUpperCase()}
          </span>
        </div>
      )}
      <div className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <RouteChip route={route} big />
        <button
          onClick={(e) => {
            e.preventDefault()
            onToggleFav(route.route_id)
          }}
          title={faved ? 'Remove from favorites' : 'Save route to favorites'}
          aria-label={faved ? 'Remove from favorites' : 'Save route to favorites'}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-base transition ${
            faved
              ? 'border-signal/60 bg-signal/10 text-signal'
              : 'border-edge bg-panel text-fog hover:border-signal/50 hover:text-signal'
          }`}
        >
          {faved ? '★' : '☆'}
        </button>
        {isTransfer ? (
          <span className="rounded-md border border-amber/40 bg-amber/10 px-2 py-0.5 font-mono text-xs font-bold tracking-widest text-amber">
            TRANSFER
          </span>
        ) : (
          <span className="rounded-md border border-phos/40 bg-phos/10 px-2 py-0.5 font-mono text-xs font-bold tracking-widest text-phos">
            DIRECT
          </span>
        )}
        <CrowdChip routeId={route.route_id} />
        <span className="ml-auto font-mono text-xs text-fog">
          {mins != null ? (
            <>
              NEXT BUS IN{' '}
              <span className="font-bold text-phos">{mins} MIN</span>
            </>
          ) : (
            'NO LIVE BUS'
          )}
        </span>
      </div>

      <h3 className="mt-3 text-xl font-bold tracking-tight text-snow group-hover:text-phos">
        {route.route_name}
      </h3>
      <div className="mt-1 font-mono text-xs text-fog">
        {route.stops?.length ?? 0} STOPS · {route.start_location} →{' '}
        {route.destination}
        {route.fare_pkr != null && (
          <>
            {' '}
            · <span className="font-bold text-snow">PKR {route.fare_pkr}</span>
          </>
        )}
      </div>

      {isTransfer && (
        <div className="mt-3 rounded-lg border border-amber/30 bg-ink/60 px-3 py-2 font-mono text-xs text-amber">
          TRANSFER AT{' '}
          <span className="font-bold">{route.transfer.via_stop}</span> → THEN ROUTE{' '}
          {routeNumber({ route_id: route.transfer.then_route_id, number: route.transfer.then_route_id })}{' '}
          {route.transfer.then_route_name}
        </div>
      )}

      <div className="mt-3 flex items-center gap-1 font-mono text-xs uppercase tracking-widest text-fog">
        {route.stops?.slice(0, 8).map((s, i) => (
          <span key={s.stop_id} className="flex items-center gap-1">
            {i > 0 && <span className="text-edge">—</span>}
            <span className="hidden xl:inline">{s.stop_name}</span>
            <span className="xl:hidden">{s.stop_order}</span>
          </span>
        ))}
      </div>
      </div>
    </Link>
  )
}

export default function Search() {
  const { demo } = useDemo()
  const { locations } = useLiveLocations(demo)
  const [from, setFrom] = useState('Minar-e-Pakistan')
  const [to, setTo] = useState('Kalma Chowk')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [favs, setFavs] = useState(getFavs)
  const [favOnly, setFavOnly] = useState(false)

  // Stop list must match the active feed: the mock network and the live
  // database have completely different stop names, and offering mock names
  // against the live API makes every manual search come back empty.
  const [stops, setStops] = useState(ALL_STOP_NAMES)
  useEffect(() => {
    if (demo) {
      setStops(ALL_STOP_NAMES)
      return
    }
    let on = true
    getNetwork(false)
      .then((net) => {
        if (!on) return
        const names = [
          ...new Set(
            (net.routes || []).flatMap((r) => (r.stops || []).map((s) => s.stop_name))
          ),
        ].sort()
        if (names.length) setStops(names)
      })
      .catch(() => {}) // API down — keep the mock list (search itself will surface the error)
    return () => {
      on = false
    }
  }, [demo])

  const run = async (f = from, t = to) => {
    setLoading(true)
    setError(null)
    try {
      setResults(await searchRoutes(f, t, demo))
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  // auto-search on load and whenever the feed flips. The defaults
  // (Minar-e-Pakistan → Kalma Chowk) only exist in the live database —
  // swap in a valid mock pair in demo mode so the page never opens on
  // "No service runs on this stretch".
  useEffect(() => {
    const fallbackFrom = stops.includes('Minar-e-Pakistan')
      ? 'Minar-e-Pakistan'
      : stops.includes('City Center')
        ? 'City Center'
        : stops[0]
    const fallbackTo = stops.includes('Kalma Chowk')
      ? 'Kalma Chowk'
      : stops.includes('University Gate')
        ? 'University Gate'
        : stops.find((s) => s !== fallbackFrom) || stops[0]
    const f = stops.includes(from) ? from : fallbackFrom
    const t = stops.includes(to) && to !== f ? to : fallbackTo
    if (f !== from) setFrom(f)
    if (t !== to) setTo(t)
    run(f, t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, stops])

  const swap = () => {
    const f = to
    const t = from
    setFrom(f)
    setTo(t)
    run(f, t)
  }

  const selectCls =
    'w-full appearance-none rounded-lg border border-edge bg-panel px-4 py-3.5 font-mono text-sm text-snow outline-none transition focus:border-phos/60 focus:ring-2 focus:ring-phos/20'

  return (
    <div className="space-y-8">
      {/* hero */}
      <section className="rp-grid-bg rounded-2xl border border-edge px-6 py-10 sm:px-10">
        <Mono className="text-xs font-semibold tracking-[0.3em] text-phos">
          PUBLIC TRANSIT · LIVE NETWORK
        </Mono>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          Know your bus.
          <br />
          <span className="text-phos">Before you wait.</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-fog sm:text-base">
          Live GPS positions, per-stop ETAs with confidence, service alerts — for
          every route in the network. No more staring down an empty road.
        </p>
      </section>

      {/* search panel */}
      <section className="rounded-2xl border border-edge bg-panel p-5 sm:p-6">
        <Mono className="text-xs font-bold tracking-[0.3em] text-fog">
          PLAN YOUR TRIP
        </Mono>
        <div className="mt-4 grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_1fr_auto]">
          <label className="block">
            <span className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-fog">
              From
            </span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls}>
              {stops.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={swap}
            title="Swap origin and destination"
            className="mb-0.5 flex h-12 w-12 items-center justify-center rounded-lg border border-edge bg-panel2 text-phos transition hover:border-phos/60 hover:bg-phos/10"
          >
            ⇄
          </button>
          <label className="block">
            <span className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-fog">
              To
            </span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className={selectCls}>
              {stops.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => run()}
            disabled={loading}
            className="mb-0.5 h-12 rounded-lg bg-phos px-6 font-mono text-sm font-extrabold tracking-widest text-ink transition hover:bg-[#34d97a] disabled:opacity-50"
          >
            {loading ? 'SEARCHING…' : 'SEARCH →'}
          </button>
        </div>
      </section>

      {/* results */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Mono className="text-xs font-bold tracking-[0.3em] text-fog">
            RESULTS
          </Mono>
          {results && (
            <span className="font-mono text-xs text-fog">
              {from} → {to}
            </span>
          )}
        </div>

        {error && <ErrorBanner error={error} onRetry={() => run()} />}

        {loading &&
          [0, 1].map((i) => <Skeleton key={i} className="h-36 w-full" />)}

        {!loading && results && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFavOnly((v) => !v)}
              className={`inline-flex min-h-11 items-center rounded-md border px-3 font-mono text-xs font-bold tracking-widest transition ${
                favOnly
                  ? 'border-signal/60 bg-signal/10 text-signal'
                  : 'border-edge bg-panel text-fog hover:text-snow'
              }`}
              title="Show only saved routes"
            >
              ★ FAVORITES{favs.length ? ` (${favs.length})` : ''}
            </button>
            {favOnly && favs.length === 0 && (
              <span className="font-mono text-xs text-fog">
                no saved routes yet — tap ☆ on a route card
              </span>
            )}
          </div>
        )}

        {!loading && results && results.routes.length === 0 && (
          <div className="rounded-xl border border-edge bg-panel p-8 text-center">
            <div className="font-mono text-sm text-fog">
              No service runs on this stretch — try a transfer.
            </div>
          </div>
        )}

        {!loading &&
          results
            ?.routes.filter((r) => !favOnly || favs.includes(String(r.route_id)))
            .map((r) => (
              <ResultCard
                key={`${r.route_id}-${r.transfer ? `${r.transfer.via_stop}-${r.transfer.then_route_id}` : 'D'}`}
                route={r}
                locations={locations}
                faved={favs.includes(String(r.route_id))}
                onToggleFav={(id) => setFavs(toggleFav(id))}
              />
            ))}
      </section>

      {/* ---------- CITY GALLERY ---------- */}
      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <Mono className="text-xs font-bold tracking-[0.3em] text-fog">THE CITY, FROM THE ROUTE</Mono>
          <Mono className="text-xs text-fog">PEXELS · LAHORE</Mono>
        </div>
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {GALLERY.map((g, i) => (
            <figure
              key={g.id}
              className={`relative w-64 shrink-0 snap-start overflow-hidden rounded-xl border border-edge sm:w-72 ${
                i % 2 ? 'rotate-[0.4deg]' : '-rotate-[0.4deg]'
              }`}
            >
              <img
                src={g.url}
                alt={g.alt}
                loading="lazy"
                className="h-40 w-full object-cover sepia-[0.14] saturate-[0.92] transition duration-700 hover:scale-[1.03]"
              />
              <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-ink/80 to-transparent px-3 pb-2 pt-6 font-mono text-[10px] tracking-widest text-snow">
                <span>{String(i + 1).padStart(2, '0')} · LAHORE</span>
                <span className="text-fog">© {g.by.toUpperCase()}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  )
}
