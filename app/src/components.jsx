import { useEffect, useRef } from 'react'
import L from 'leaflet'
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Marker,
  Popup,
  Tooltip,
  useMap,
} from 'react-leaflet'

// CARTO Basemaps key (client-side by design — restrict by referrer in the CARTO dashboard).
const CARTO_KEY = import.meta.env.VITE_CARTO_KEY || 'cb1_45y6_1_736945477684ff5c74ac6971'
import { routeNumber } from './mock'

// ---------- tiny text atoms ----------
export const Mono = ({ children, className = '' }) => (
  <span className={`font-mono ${className}`}>{children}</span>
)

export const RouteChip = ({ route, big = false }) => (
  <span
    className={`inline-block font-mono font-extrabold tracking-tight rounded-md border border-phos/40 bg-phos/10 text-phos ${
      big ? 'px-3 py-1 text-lg' : 'px-2 py-0.5 text-xs'
    }`}
  >
    ROUTE {routeNumber(route)}
  </span>
)

// ---------- status vocabulary ----------
export const STATUS_COLORS = {
  'On Route': '#2E7D4F',
  Delayed: '#E4572E',
  Available: '#E4572E',
  Break: '#64748B',
  Offline: '#EF4444',
  Completed: '#E4572E',
  Cancelled: '#EF4444',
}

export const StatusChip = ({ status }) => {
  const c = STATUS_COLORS[status] || '#8B98A5'
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-xs font-semibold uppercase tracking-wider"
      style={{ color: c, borderColor: `${c}55`, background: `${c}14` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c }} />
      {status}
    </span>
  )
}

// ---------- live source badge ----------
export function LiveBadge({ source }) {
  const map = {
    demo: { label: 'DEMO DATA', color: '#E4572E', pulse: true },
    ws: { label: 'LIVE · WS', color: '#2E7D4F', pulse: true },
    poll: { label: 'LIVE · 3s POLL', color: '#2E7D4F', pulse: true },
    connecting: { label: 'CONNECTING…', color: '#8B98A5', pulse: true },
    offline: { label: 'OFFLINE', color: '#EF4444', pulse: false },
  }
  const s = map[source] || map.connecting
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 font-mono text-xs font-bold tracking-widest"
      style={{ color: s.color, borderColor: `${s.color}55`, background: `${s.color}12` }}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${s.pulse ? 'rp-blink' : ''}`}
        style={{ background: s.color }}
      />
      {s.label}
    </span>
  )
}

// ---------- loading / error primitives ----------
export const Skeleton = ({ className = '' }) => (
  <div className={`rp-skel ${className}`} aria-hidden="true" />
)

export function ErrorBanner({ error, onRetry }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-alert/40 bg-alert/10 px-4 py-3">
      <div className="font-mono text-xs text-alert">
        ✗ {error?.message || 'Something went wrong'} — the API may be down.
      </div>
      <div className="flex gap-2">
        <button
          onClick={onRetry}
          className="rounded-md border border-phos/50 bg-phos/10 px-3 py-1 font-mono text-xs font-bold text-phos hover:bg-phos/20"
        >
          RETRY
        </button>
      </div>
    </div>
  )
}

// ---------- KPI card ----------
export function Kpi({ label, value, suffix, color = '#E6EDF3', loading, className = '' }) {
  return (
    <div className={`rounded-xl border border-edge bg-panel p-4 ${className}`}>
      <div className="font-mono text-xs uppercase tracking-[0.2em] text-fog">
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-16" />
      ) : (
        <div className="mt-1 font-mono text-3xl font-extrabold" style={{ color }}>
          {value}
          {suffix && <span className="ml-1 text-sm font-semibold text-fog">{suffix}</span>}
        </div>
      )}
    </div>
  )
}

// ---------- map ----------
const busIcon = (status) =>
  L.divIcon({
    className: '',
    html: `<div class="rp-bus ${
      status === 'Delayed' ? 'delayed' : ['Break', 'Offline'].includes(status) ? 'off' : status === 'Available' ? 'available' : ''
    }"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })

// Fit to the data being rendered, not layers scraped off the map (those may
// not be attached yet when this effect first runs, and a static fitKey never
// re-fits once the live network replaces the mock fallback). Re-runs when the
// point count changes so the view always lands on the real network extent.
const LAHORE_BBOX = { latMin: 31.2, latMax: 31.95, lngMin: 73.7, lngMax: 75.1 }
function FitBounds({ fitKey, points = [] }) {
  const map = useMap()
  useEffect(() => {
    const fit = () => {
      // one stray far-away point (bad seed row, mock fallback, 0/0 GPS) would
      // stretch the bounds to the whole planet and drop the map to zoom 0 —
      // clamp to the network's home city before fitting
      const valid = points.filter(
        (p) =>
          Array.isArray(p) &&
          Number.isFinite(p[0]) &&
          Number.isFinite(p[1]) &&
          p[0] > LAHORE_BBOX.latMin &&
          p[0] < LAHORE_BBOX.latMax &&
          p[1] > LAHORE_BBOX.lngMin &&
          p[1] < LAHORE_BBOX.lngMax
      )
      if (!valid.length) return
      try {
        map.invalidateSize()
        const b = L.latLngBounds(valid)
        if (b.isValid()) map.fitBounds(b.pad(0.12), { animate: false })
        // degenerate fit (tiny/huge bounds computing to a world view) — hold
        // the city view instead of letting the map collapse to zoom 0
        if (map.getZoom() < 9) map.setView([31.5582, 74.3507], 12, { animate: false })
      } catch {
        /* bad coords — keep the default view instead of crashing */
      }
    }
    fit()
    const t = setTimeout(fit, 400) // container may still be laying out on first run
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, points.length])
  return null
}

// CameraFlyTo — pans the map when the `flyTo` prop changes to a new
// [lat, lng] pair. A ~1.4s flight with low easeLinearity approximates the
// house easing feel (Leaflet exposes no custom bezier). flyTo=null (the
// default) is a no-op, so existing callers keep their behavior; a ref
// guards against re-flying when the caller passes a fresh-but-equal array.
function CameraFlyTo({ flyTo }) {
  const map = useMap()
  const lastRef = useRef(null)
  useEffect(() => {
    const target =
      Array.isArray(flyTo) &&
      flyTo.length >= 2 &&
      Number.isFinite(flyTo[0]) &&
      Number.isFinite(flyTo[1])
        ? flyTo
        : null
    if (!target) return
    const prev = lastRef.current
    if (prev && prev[0] === target[0] && prev[1] === target[1]) return
    lastRef.current = target
    try {
      map.flyTo([target[0], target[1]], Math.max(map.getZoom(), 14), {
        duration: 1.4,
        easeLinearity: 0.22,
      })
    } catch {
      /* bad coords — hold the current view */
    }
  }, [flyTo, map])
  return null
}

/**
 * MapView — CARTO basemap (Dark Matter at night, Positron (light_all) by day —
 * no tint/filter applied), route polylines, stop markers, pulsing bus dots.
 * polylines: [{ coords: [[lat,lng]...], color?, weight?, hot? }] — hot routes glow red
 * stops:     [{ lat, lng, stop_name, stop_order }]
 * buses:     [{ bus_id, lat, lng, speed, delay_minutes, trip_status, next_stop }]
 * trails:    [{ busId, points: [[lat,lng]...], status? }] — fading comet trails
 * ping:      { lat, lng, key } — expanding radar ring for a live service alert
 * drawIn:    animate route polylines drawing themselves on mount
 * flyTo:     [lat, lng] | null — camera flies to this point (1.4s, house-feel
 *            easing); null keeps the default view (backwards compatible)
 */
export function MapView({
  polylines = [],
  stops = [],
  buses = [],
  trails = [],
  ping = null,
  fitKey,
  className = 'h-[420px]',
  night = false,
  drawIn = false,
  flyTo = null,
}) {
  // drop malformed points so one bad row can never poison Leaflet's
  // projection (NaN coords render nothing / blow up fitBounds)
  const safePt = (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])
  const lines = polylines.map((p) => ({ ...p, coords: (p.coords || []).filter(safePt) }))
  const fitPoints = [
    ...lines.flatMap((p) => p.coords),
    ...stops.filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng)).map((s) => [s.lat, s.lng]),
  ]
  // SVG renderer (not canvas) so rp-draw / rp-route-hot CSS animation classes apply.
  return (
    <div className={`overflow-hidden rounded-xl border border-edge ${className}`}>
      <MapContainer
        center={[31.5582, 74.3507]}
        zoom={13}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          url={
            night
              ? `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`
              : `https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`
          }
          maxZoom={18}
        />
        {lines.map((p, i) => (
          <Polyline
            key={i}
            positions={p.coords}
            pathOptions={{
              color: p.color || '#FF4F1F',
              weight: p.weight || 5,
              opacity: p.opacity ?? 0.92,
              dashArray: p.dashArray,
              className: `${drawIn ? 'rp-draw ' : ''}${p.hot ? 'rp-route-hot' : ''}`.trim() || undefined,
            }}
          />
        ))}
        {trails
          .filter((t) => t.points.length >= 2)
          .map((t) => {
            const c = STATUS_COLORS[t.status] || '#E4572E'
            const segs = t.points.length - 1
            return t.points.slice(1).map((pt, i) => (
              <Polyline
                key={`tr-${t.busId}-${i}`}
                positions={[t.points[i], pt]}
                interactive={false}
                pathOptions={{
                  color: c,
                  weight: 2.5,
                  opacity: 0.05 + ((i + 1) / segs) * 0.4,
                  lineCap: 'round',
                }}
              />
            ))
          })}
        {ping && (
          <Marker
            key={ping.key}
            position={[ping.lat, ping.lng]}
            interactive={false}
            icon={L.divIcon({
              className: '',
              html: '<span class="rp-alert-ping"></span>',
              iconSize: [0, 0],
            })}
          />
        )}
        {stops.map((s) => (
          <CircleMarker
            key={`${s.stop_name}-${s.stop_order}`}
            center={[s.lat, s.lng]}
            radius={6}
            pathOptions={{
              color: '#211D16',
              weight: 2,
              fillColor: '#F4EFE4',
              fillOpacity: 1,
            }}
          >
            <Tooltip direction="right" offset={[8, 0]} className="rp-stop-label">
              {s.stop_order}. {s.stop_name}
            </Tooltip>
          </CircleMarker>
        ))}
        {buses
          .filter((b) => b.lat != null && b.lng != null)
          .map((b) => (
            <Marker key={b.bus_id} position={[b.lat, b.lng]} icon={busIcon(b.trip_status)}>
              {/* hover = quick info, click popup below = pinned detail */}
              <Tooltip direction="top" offset={[0, -12]} className="rp-bus-tip">
                <div>
                  <div>BUS {b.bus_id}</div>
                  <div>
                    {b.route_id ? `ROUTE ${String(b.route_id).replace('R', '')}` : 'NO ROUTE'}
                    {b.next_stop ? ` → ${b.next_stop}` : ''}
                  </div>
                  <div>
                    {b.speed ?? 0} km/h · delay {b.delay_minutes ?? 0} min · {b.trip_status}
                  </div>
                </div>
              </Tooltip>
              <Popup>
                <div className="space-y-1">
                  <div className="font-bold text-[#2E7D4F]">BUS {b.bus_id}</div>
                  <div>
                    {b.route_id ? `ROUTE ${String(b.route_id).replace('R', '')}` : 'NO ROUTE'}
                    {b.next_stop ? ` → ${b.next_stop}` : ''}
                  </div>
                  <div>
                    {b.speed ?? 0} km/h · delay {b.delay_minutes ?? 0} min · {b.trip_status}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        {fitKey && <FitBounds fitKey={fitKey} points={fitPoints} />}
        {flyTo && <CameraFlyTo flyTo={flyTo} />}
      </MapContainer>
    </div>
  )
}

// relative time for alerts
export const agoMin = (iso) =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
