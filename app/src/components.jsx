import { useEffect } from 'react'
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

function FitBounds({ fitKey }) {
  const map = useMap()
  useEffect(() => {
    // fit to all route layers currently on the map
    const group = new L.FeatureGroup()
    map.eachLayer((l) => {
      if (l instanceof L.Polyline || l instanceof L.CircleMarker) group.addLayer(l)
    })
    const b = group.getBounds()
    if (b && b.isValid()) map.fitBounds(b.pad(0.12), { animate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])
  return null
}

/**
 * MapView — CARTO basemap (Dark Matter at night, Positron by day, sepia-tinted),
 * route polylines, stop markers, pulsing bus dots.
 * polylines: [{ coords: [[lat,lng]...], color?, weight? }]
 * stops:     [{ lat, lng, stop_name, stop_order }]
 * buses:     [{ bus_id, lat, lng, speed, delay_minutes, trip_status, next_stop }]
 */
export function MapView({ polylines = [], stops = [], buses = [], fitKey, className = 'h-[420px]', night = false }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-edge ${className}`}>
      <MapContainer
        center={[31.5582, 74.3507]}
        zoom={13}
        scrollWheelZoom
        className="h-full w-full"
        preferCanvas
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors &copy; CARTO'
          url={
            night
              ? `https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`
              : `https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`
          }
          maxZoom={18}
        />
        {polylines.map((p, i) => (
          <Polyline
            key={i}
            positions={p.coords}
            pathOptions={{
              color: p.color || '#E4572E',
              weight: p.weight || 4,
              opacity: p.opacity ?? 0.75,
              dashArray: p.dashArray,
            }}
          />
        ))}
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
        {fitKey && <FitBounds fitKey={fitKey} />}
      </MapContainer>
    </div>
  )
}

// relative time for alerts
export const agoMin = (iso) =>
  Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
