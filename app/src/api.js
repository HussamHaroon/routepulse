// ============================================================
// API layer — codes against the backend contract EXACTLY.
// Every function takes `mock` (the DEMO DATA toggle); when true
// it answers from src/mock.js instead of hitting the network.
// ============================================================
import * as m from './mock'

const API_BASE = import.meta.env.VITE_API_URL || ''
const TIMEOUT_MS = 4000
// mutating endpoints require the operator key (see api/server.js)
const OPERATOR_KEY = import.meta.env.VITE_OPERATOR_KEY || 'routepulse-demo-key'

async function j(path, opts = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const { headers = {}, ...rest } = opts
  const method = (rest.method || 'GET').toUpperCase()
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: ctrl.signal,
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(method !== 'GET' ? { 'x-api-key': OPERATOR_KEY } : {}),
        ...headers,
      },
    })
    if (!res.ok) throw new Error(`API ${res.status} ${path}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

const qs = (o) =>
  '?' +
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')

// ---- routes / search ----
// Live responses are normalized to the row shape the UI consumes
// (stop objects, transfer rows) so mock and live feed one code path.
export const searchRoutes = (from, to, mock) =>
  mock
    ? Promise.resolve(m.mockSearch(from, to))
    : j(`/api/routes${qs({ from, to })}`).then((res) => {
        if (Array.isArray(res?.routes)) {
          const rows = res.routes.map((r) => ({
            ...r,
            stops: (r.stops ?? []).map((s, i) =>
              typeof s === 'string'
                ? { stop_id: `${r.route_id}_s${i + 1}`, stop_name: s, stop_order: i + 1 }
                : s
            ),
          }))
          // search rows are name-only — enrich with fares + stop coordinates
          return Promise.all(
            rows.map((r) =>
              j(`/api/routes/${encodeURIComponent(r.route_id)}`)
                .then((full) => ({
                  ...r,
                  ...full,
                  stops: full.stops?.length ? full.stops : r.stops,
                }))
                .catch(() => r)
            )
          ).then((routes) => ({ routes }))
        }
        if (res?.transfer) {
          const t = res.transfer
          return {
            routes: [
              {
                route_id: t.second?.route_id,
                route_name: t.second?.route_name,
                start_location: t.via_stop,
                destination: '',
                stops: [],
                transfer: {
                  via_stop: t.via_stop,
                  then_route_id: t.second?.route_id,
                  then_route_name: t.second?.route_name,
                },
              },
            ],
          }
        }
        return { routes: [] }
      })

// Mock resolvers can throw synchronously (unknown demo id) — route the throw
// through a rejected promise so callers' .catch() sees it instead of React.
const mockP = (fn) => {
  try {
    return Promise.resolve(fn())
  } catch (e) {
    return Promise.reject(e)
  }
}

export const getRoute = (id, mock) =>
  mock ? mockP(() => m.mockRouteById(id)) : j(`/api/routes/${encodeURIComponent(id)}`)

// Whole network in one call (stops included) — operator map + driver selects.
export const getNetwork = (mock) =>
  mock ? Promise.resolve({ routes: m.ROUTES }) : j('/api/routes?with_stops=1')

export const getEtas = (id, mock, busId) =>
  mock
    ? mockP(() => m.mockEtas(id))
    : j(`/api/routes/${encodeURIComponent(id)}/etas${busId ? qs({ bus_id: busId }) : ''}`)

export const getLocations = (mock) =>
  mock ? Promise.resolve({ locations: m.mockLocations() }) : j('/api/locations')

export const getAlerts = (routeId, mock) =>
  mock
    ? Promise.resolve(m.mockAlertsList(routeId))
    : j(`/api/alerts${routeId ? qs({ route_id: routeId }) : ''}`)

export const publishAlert = (route_id, message, mock) =>
  mock
    ? Promise.resolve(m.mockPublishAlert(route_id, message))
    : j('/api/alerts', { method: 'POST', body: JSON.stringify({ route_id, message }) })

// WP3: history-mined analytics — delay rhythm per route + ETA accuracy grades.
// Demo mode has no history table, so patterns resolve empty and the panel hides.
export const getDelayPatterns = (mock) =>
  mock ? Promise.resolve({ patterns: [] }) : j('/api/analytics/delay-patterns')

export const getEtaAccuracy = (mock) =>
  mock ? Promise.resolve(null) : j('/api/analytics/eta-accuracy')

// Real-world Lahore conditions — live weather + smog (Open-Meteo, no key).
export const getConditions = (mock) =>
  mock ? Promise.resolve(null) : j('/api/conditions')

// Bunching radar — same-route pairs operating <400 m apart.
export const getBunching = (mock) =>
  mock
    ? Promise.resolve({ threshold_m: 400, routes_scanned: 8, buses_scanned: 22, pairs: [] })
    : j('/api/analytics/bunching')

// Time travel — fleet snapshots for the operator replay slider.
export const getReplay = (minutes = 60) => j(`/api/replay?minutes=${minutes}`)

export const getStats = (mock) =>
  mock ? Promise.resolve(m.mockStats()) : j('/api/stats')

export const getDrivers = (mock) =>
  mock
    ? Promise.resolve({
        drivers: m.DRIVERS.map((d) => ({
          ...d,
          current_trip: null,
        })),
      })
    : j('/api/drivers')

// ---- trip lifecycle ----
export const startTrip = (body, mock) =>
  mock
    ? Promise.resolve(m.mockStartTrip(body))
    : j('/api/trips/start', { method: 'POST', body: JSON.stringify(body) })

export const updateTrip = (tripId, body, mock) =>
  mock
    ? Promise.resolve(m.mockUpdateTrip(tripId, body))
    : j(`/api/trips/${encodeURIComponent(tripId)}/update`, {
        method: 'POST',
        body: JSON.stringify(body),
      })

export const endTrip = (tripId, mock) =>
  mock
    ? Promise.resolve(m.mockEndTrip(tripId))
    : j(`/api/trips/${encodeURIComponent(tripId)}/end`, { method: 'POST' })

// ---- driver phone GPS (second location source) ----
export const ingestGps = (busId, body, mock) => {
  if (mock) {
    m.setMockGps(busId, body)
    return Promise.resolve({ ok: true })
  }
  return j(`/api/ingest/${encodeURIComponent(busId)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// WS endpoint. Backend serves WS on the same port at path /ws (see api/server.js).
// dev: backend listens directly on :8787. prod: Vercel's proxy cannot upgrade
// websocket passes to the API host (plain 200, handshake fails), so connect
// straight to the Railway origin — it serves WS with no origin restriction.
export const WS_URL = (() => {
  if (import.meta.env.DEV) return 'ws://localhost:8787/ws'
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  return 'wss://routepulse-production-50c8.up.railway.app/ws'
})()

// ---- crowd reports (P1) ----
export const reportCrowd = (routeId, level, mock) =>
  mock
    ? Promise.resolve({ ok: true, route_id: routeId, level })
    : j(`/api/routes/${encodeURIComponent(routeId)}/crowd`, {
        method: 'POST',
        body: JSON.stringify({ level }),
      })

export const getCrowd = (routeId, mock) =>
  mock
    ? Promise.resolve({ level: null, updated_at: null })
    : j(`/api/routes/${encodeURIComponent(routeId)}/crowd`)

// ---- station board (GET /api/stops/:name/departures) ----
// One stop, every bus that passes it. Mock rows are built from the demo
// ROUTES + the client-side bus simulator so the static demo works.
export const getDepartures = (stopName, mock) => {
  if (mock) {
    return mockP(() => {
      const want = String(stopName ?? '').trim().toLowerCase()
      const locs = m.mockLocations()
      const rows = []
      for (const r of m.ROUTES) {
        const stop = r.stops.find((s) => String(s.stop_name).trim().toLowerCase() === want)
        if (!stop) continue
        const bus = locs.find((b) => b.route_id === r.route_id && b.trip_status !== 'Offline')
        const eta = (m.mockEtas(r.route_id).etas ?? []).find((e) => e.stop_id === stop.stop_id)
        const etaMin = eta?.eta_min ?? m.mockNextBusMinutes(r.route_id, stop.stop_name) ?? 9
        rows.push({
          route_id: r.route_id,
          route_name: r.route_name,
          headsign: r.destination,
          eta_min: Math.max(0, Math.round(Number(etaMin) * 10) / 10),
          confidence: eta?.confidence ?? 'medium',
          delay_minutes: bus?.delay_minutes ?? 0,
          bus_id: bus?.bus_id ?? '—',
          trip_status: bus?.trip_status ?? 'On Route',
        })
      }
      rows.sort((a, b) => a.eta_min - b.eta_min)
      return { stop_name: stopName, departures: rows.slice(0, 12) }
    })
  }
  return j(`/api/stops/${encodeURIComponent(stopName)}/departures`)
}
