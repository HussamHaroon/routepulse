// ============================================================
// API layer — codes against the backend contract EXACTLY.
// Every function takes `mock` (the DEMO DATA toggle); when true
// it answers from src/mock.js instead of hitting the network.
// ============================================================
import * as m from './mock'

const API_BASE = import.meta.env.VITE_API_URL || ''
const TIMEOUT_MS = 4000

async function j(path, opts = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      ...opts,
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
export const searchRoutes = (from, to, mock) =>
  mock
    ? Promise.resolve(m.mockSearch(from, to))
    : j(`/api/routes${qs({ from, to })}`)

export const getRoute = (id, mock) =>
  mock ? Promise.resolve(m.mockRouteById(id)) : j(`/api/routes/${encodeURIComponent(id)}`)

export const getEtas = (id, mock, busId) =>
  mock
    ? Promise.resolve(m.mockEtas(id))
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

export const WS_URL = 'ws://localhost:8787'
