// ============================================================
// MOCK MODE — same data shapes as the backend API contract.
// Seed data MUST match the backend exactly (see crew contract).
// Includes a tiny client-side bus simulator so the whole demo
// works before / while the real API is up.
// ============================================================

const S = (stop_id, stop_name, lat, lng, stop_order) => ({
  stop_id,
  stop_name,
  lat,
  lng,
  stop_order,
})

export const ROUTES = [
  {
    route_id: 'R7',
    route_name: 'City Center → University Gate',
    number: '7',
    start_location: 'City Center',
    destination: 'University Gate',
    estimated_duration: 42,
    active_status: true,
    stops: [
      S('R7-1', 'City Center', 31.5582, 74.3507, 1),
      S('R7-2', 'Shimla Pahar', 31.562, 74.342, 2),
      S('R7-3', 'Railway Station', 31.5703, 74.333, 3),
      S('R7-4', 'Civil Area', 31.568, 74.322, 4),
      S('R7-5', 'Data Nagar', 31.565, 74.314, 5),
      S('R7-6', 'University Gate', 31.5645, 74.3075, 6),
    ],
  },
  {
    route_id: 'R5',
    route_name: 'Central Station → Bus Terminal',
    number: '5',
    start_location: 'Central Station',
    destination: 'Bus Terminal',
    estimated_duration: 48,
    active_status: true,
    stops: [
      S('R5-1', 'Central Station', 31.572, 74.352, 1),
      S('R5-2', 'Lakshmi Chowk', 31.565, 74.344, 2),
      S('R5-3', 'Main Market', 31.556, 74.34, 3),
      S('R5-4', 'Civil Lines', 31.548, 74.332, 4),
      S('R5-5', 'Model Town Link', 31.538, 74.326, 5),
      S('R5-6', 'Bus Terminal', 31.529, 74.318, 6),
    ],
  },
  {
    route_id: 'R3',
    route_name: 'Airport → City Center',
    number: '3',
    start_location: 'Airport',
    destination: 'City Center',
    estimated_duration: 55,
    active_status: true,
    stops: [
      S('R3-1', 'Airport', 31.521, 74.403, 1),
      S('R3-2', 'Cohsala', 31.532, 74.387, 2),
      S('R3-3', 'Ghazi Road', 31.543, 74.374, 3),
      S('R3-4', 'Peco Mor', 31.551, 74.363, 4),
      S('R3-5', 'Islampura', 31.556, 74.356, 5),
      S('R3-6', 'City Center', 31.5582, 74.3507, 6),
    ],
  },
  {
    route_id: 'R9',
    route_name: 'City Center → University Gate Express',
    number: '9',
    start_location: 'City Center',
    destination: 'University Gate',
    estimated_duration: 30,
    active_status: true,
    stops: [
      S('R9-1', 'City Center', 31.5582, 74.3507, 1),
      S('R9-2', 'Canal Bank', 31.554, 74.338, 2),
      S('R9-3', 'Chauburji', 31.546, 74.318, 3),
      S('R9-4', 'Multan Chungi', 31.552, 74.312, 4),
      S('R9-5', 'Campus Gate', 31.559, 74.309, 5),
      S('R9-6', 'University Gate', 31.5645, 74.3075, 6),
    ],
  },
]

export const routeNumber = (r) =>
  r?.number || (r?.route_id ? r.route_id.replace(/^R/, '') : '?')

// ---------------- geo helpers ----------------
export function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

const geomCache = new Map()
function geom(route) {
  if (geomCache.has(route.route_id)) return geomCache.get(route.route_id)
  const pts = route.stops
  const segs = [0]
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += haversineKm(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng)
    segs.push(total)
  }
  const g = { segs, total }
  geomCache.set(route.route_id, g)
  return g
}

function posAlong(route, dist) {
  const { segs } = geom(route)
  const pts = route.stops
  if (dist <= 0) return { lat: pts[0].lat, lng: pts[0].lng }
  if (dist >= segs[segs.length - 1])
    return { lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lng }
  let i = 1
  while (segs[i] < dist) i++
  const t = (dist - segs[i - 1]) / (segs[i] - segs[i - 1] || 1)
  return {
    lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * t,
    lng: pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * t,
  }
}

// ---------------- seed fleet ----------------
const SEED_BUSES = [
  { bus_id: 'B-07', route_id: 'R7', driver_id: 'D-01', base_speed: 24, progress: 0.12, delay_minutes: 0, trip_status: 'On Route' },
  { bus_id: 'B-14', route_id: 'R5', driver_id: 'D-02', base_speed: 16, progress: 0.45, delay_minutes: 15, trip_status: 'Delayed' },
  { bus_id: 'B-03', route_id: 'R3', driver_id: 'D-03', base_speed: 30, progress: 0.62, delay_minutes: 0, trip_status: 'On Route' },
  { bus_id: 'B-09', route_id: 'R9', driver_id: 'D-04', base_speed: 34, progress: 0.3, delay_minutes: 2, trip_status: 'On Route' },
  { bus_id: 'B-21', route_id: null, status: 'Available', depot: { lat: 31.556, lng: 74.348 } },
  { bus_id: 'B-32', route_id: null, status: 'Break', depot: { lat: 31.567, lng: 74.331 } },
]

export const ALL_BUS_IDS = SEED_BUSES.map((b) => b.bus_id)

export const DRIVERS = [
  { driver_id: 'D-01', name: 'Farhan', assigned_bus: 'B-07', route_id: 'R7', current_trip: null, status: 'On Route' },
  { driver_id: 'D-02', name: 'Muneeb', assigned_bus: 'B-14', route_id: 'R5', current_trip: null, status: 'Delayed' },
  { driver_id: 'D-03', name: 'Prithvi', assigned_bus: 'B-03', route_id: 'R3', current_trip: null, status: 'On Route' },
  { driver_id: 'D-04', name: 'Aslam', assigned_bus: 'B-09', route_id: 'R9', current_trip: null, status: 'On Route' },
  { driver_id: 'D-05', name: 'Zafar', assigned_bus: null, route_id: null, current_trip: null, status: 'Available' },
]

let mockAlerts = [
  {
    alert_id: 'A-1',
    route_id: 'R5',
    message: 'Route 5 delayed ~15 min — accident near Main Market',
    created_at: new Date(Date.now() - 14 * 60000).toISOString(),
    active: true,
  },
  {
    alert_id: 'A-2',
    route_id: null,
    message: 'Stop 7 temporarily unavailable — road closure',
    created_at: new Date(Date.now() - 32 * 60000).toISOString(),
    active: true,
  },
  {
    alert_id: 'A-3',
    route_id: 'R5',
    message: 'Bus 14 ended trip — vehicle issue',
    created_at: new Date(Date.now() - 47 * 60000).toISOString(),
    active: true,
  },
]

// trips started from the driver console (mock)
const mockTrips = new Map() // bus_id -> {trip_id, route_id, driver_id, start_ts, trip_status, delay_minutes}
let tripSeq = 100
// driver-phone GPS override: bus_id -> {lat,lng,speed}
const gpsOverrides = new Map()

export function setMockGps(busId, latlng) {
  if (!latlng) gpsOverrides.delete(busId)
  else gpsOverrides.set(busId, latlng)
}

// ---------------- movement engine ----------------
const LOOP_SEC = 330 // seconds for a full route loop — clearly visible motion

function speedOf(seed, t) {
  // wobble ±6 km/h so ETA confidence varies believably
  return Math.max(6, seed.base_speed + 6 * Math.sin(t / 25 + seed.bus_id.charCodeAt(2)))
}

function movingState(seed, t) {
  const route = ROUTES.find((r) => r.route_id === seed.route_id)
  const g = geom(route)
  const speed = speedOf(seed, t)
  const dist = ((seed.progress + t / LOOP_SEC) % 1) * g.total
  const pos = posAlong(route, dist)
  let nextIdx = route.stops.findIndex((_, i) => g.segs[i] > dist + 0.05)
  if (nextIdx === -1) nextIdx = route.stops.length - 1
  const delay = seed.delay_minutes || 0
  return {
    bus_id: seed.bus_id,
    route_id: route.route_id,
    trip_id: (mockTrips.get(seed.bus_id) || {}).trip_id || `T-${seed.bus_id}`,
    lat: pos.lat,
    lng: pos.lng,
    speed: Math.round(speed),
    delay_minutes: delay,
    trip_status: seed.trip_status,
    next_stop: route.stops[nextIdx].stop_name,
    updated_at: new Date().toISOString(),
  }
}

export function mockLocations() {
  const t = Date.now() / 1000
  const out = []
  for (const seed of SEED_BUSES) {
    const trip = mockTrips.get(seed.bus_id)
    if (trip) {
      const s = movingState({ ...seed, route_id: trip.route_id, progress: 0, delay_minutes: trip.delay_minutes, trip_status: trip.trip_status, base_speed: 26 }, t)
      s.trip_id = trip.trip_id
      out.push(s)
      continue
    }
    if (seed.route_id) {
      out.push(movingState(seed, t))
      continue
    }
    const d = seed.depot
    const loc = gpsOverrides.get(seed.bus_id)
    out.push({
      bus_id: seed.bus_id,
      route_id: null,
      trip_id: null,
      lat: loc ? loc.lat : d.lat,
      lng: loc ? loc.lng : d.lng,
      speed: loc ? Math.round(loc.speed || 0) : 0,
      delay_minutes: 0,
      trip_status: seed.status, // Available | Break
      next_stop: null,
      updated_at: new Date().toISOString(),
    })
  }
  // driver phone GPS: override an active bus position live
  for (const [busId, p] of gpsOverrides) {
    const row = out.find((b) => b.bus_id === busId)
    if (row) {
      row.lat = p.lat
      row.lng = p.lng
      row.speed = Math.round(p.speed || row.speed)
      row.updated_at = new Date().toISOString()
    }
  }
  return out
}

function activeBusOnRoute(routeId) {
  return mockLocations().find(
    (b) => b.route_id === routeId && b.trip_status !== 'Offline'
  )
}

// ---------------- ETAs (+ confidence, the novelty twist) ----------------
export function mockEtas(routeId) {
  const route = ROUTES.find((r) => r.route_id === routeId)
  if (!route) return { etas: [] }
  const bus = activeBusOnRoute(routeId)
  const t = Date.now() / 1000
  if (!bus) {
    return {
      etas: route.stops.map((s) => ({
        stop_id: s.stop_id,
        stop_name: s.stop_name,
        eta_min: null,
        distance_km: null,
        speed_kmh: null,
        confidence: 'low',
        eta_range_min: null,
      })),
    }
  }
  const g = geom(route)
  const busDist = ((bus._dist !== undefined ? bus._dist : nearestDist(route, bus)) ?? 0)
  const { segs, total } = g
  const wobble = Math.abs(Math.sin(t / 45 + routeId.charCodeAt(1)))
  const confidence = wobble < 0.85 ? 'high' : wobble < 0.98 ? 'medium' : 'low'
  const range = confidence === 'high' ? 1 : confidence === 'medium' ? 3 : 6
  const etas = route.stops.map((s, i) => {
    let ahead = segs[i] - busDist
    if (ahead < 0.05) ahead += total // wrap: bus will come around again
    const etaMin = (ahead / Math.max(bus.speed, 5)) * 60 + bus.delay_minutes
    return {
      stop_id: s.stop_id,
      stop_name: s.stop_name,
      eta_min: Math.max(0, Math.round(etaMin * 10) / 10),
      distance_km: Math.round(ahead * 10) / 10,
      speed_kmh: bus.speed,
      confidence,
      eta_range_min: range,
    }
  })
  return { etas }
}

function nearestDist(route, bus) {
  const { segs } = geom(route)
  let best = 0
  let bestD = Infinity
  route.stops.forEach((s, i) => {
    const d = haversineKm(bus.lat, bus.lng, s.lat, s.lng)
    if (d < bestD) {
      bestD = d
      best = segs[i]
    }
  })
  return Math.min(best + bestD, geom(route).total)
}

// ETA of the next bus at a stop — used on search result cards
export function mockNextBusMinutes(routeId, stopName) {
  const route = ROUTES.find((r) => r.route_id === routeId)
  const bus = activeBusOnRoute(routeId)
  if (!route || !bus) return null
  const stop = route.stops.find((s) => s.stop_name === stopName) || route.stops[0]
  const d = haversineKm(bus.lat, bus.lng, stop.lat, stop.lng)
  const eta = (d / Math.max(bus.speed, 5)) * 60 + (bus.delay_minutes || 0)
  return Math.max(1, Math.round(eta))
}

// ---------------- search (direct + transfer) ----------------
const ordered = (route, a, b) => {
  const ia = route.stops.findIndex((s) => s.stop_name === a)
  const ib = route.stops.findIndex((s) => s.stop_name === b)
  return ia !== -1 && ib !== -1 && ia < ib
}

export function mockSearch(from, to) {
  if (!from || !to || from === to) return { routes: [], direct: true }
  const directRoutes = ROUTES.filter((r) => ordered(r, from, to))
  const routes = directRoutes.map((r) => ({ ...r }))
  let direct = true
  if (routes.length === 0) {
    direct = false
    for (const a of ROUTES) {
      for (const b of ROUTES) {
        if (a.route_id === b.route_id) continue
        if (!ordered(a, from, '___')) {
          const ia = a.stops.findIndex((s) => s.stop_name === from)
          if (ia === -1) continue
        }
        for (const via of a.stops) {
          if (via.stop_name === from) continue
          if (ordered(a, from, via.stop_name) && ordered(b, via.stop_name, to)) {
            routes.push({
              ...a,
              transfer: {
                via_stop: via.stop_name,
                then_route_id: b.route_id,
                then_route_name: b.route_name,
              },
            })
            break
          }
        }
        if (routes.length && routes[routes.length - 1].transfer) break
      }
      if (routes.length) break
    }
  }
  return { routes, direct }
}

// ---------------- stats / alerts / trips ----------------
export function mockStats() {
  const locs = mockLocations()
  const active = locs.filter((b) => b.trip_status === 'On Route').length
  const delayed = locs.filter((b) => b.trip_status === 'Delayed').length
  const offline = locs.filter((b) => ['Break', 'Offline'].includes(b.trip_status)).length
  const delays = locs.map((b) => b.delay_minutes || 0)
  return {
    total_buses: SEED_BUSES.length,
    active_buses: active,
    delayed_buses: delayed,
    offline_buses: offline,
    routes_running: new Set(locs.filter((b) => b.route_id).map((b) => b.route_id)).size,
    trips_today: 7 + mockTrips.size,
    avg_delay_min: Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10,
  }
}

export function mockAlertsList(routeId) {
  const now = Date.now()
  return {
    alerts: mockAlerts
      .filter((a) => !routeId || a.route_id === routeId || a.route_id === null)
      .map((a) => ({ ...a, age_min: Math.max(0, Math.round((now - new Date(a.created_at)) / 60000)) })),
  }
}

export function mockPublishAlert(route_id, message) {
  const a = {
    alert_id: `A-${Date.now()}`,
    route_id: route_id || null,
    message,
    created_at: new Date().toISOString(),
    active: true,
  }
  mockAlerts = [a, ...mockAlerts]
  return a
}

export function mockStartTrip({ bus_id, driver_id, route_id }) {
  const trip = {
    trip_id: `T-${++tripSeq}`,
    bus_id,
    driver_id,
    route_id,
    start_time: new Date().toISOString(),
    end_time: null,
    trip_status: 'On Route',
    delay_minutes: 0,
  }
  mockTrips.set(bus_id, trip)
  return { trip }
}

export function mockUpdateTrip(tripId, { trip_status, delay_minutes, note }) {
  for (const trip of mockTrips.values()) {
    if (trip.trip_id === tripId) {
      if (trip_status) trip.trip_status = trip_status
      if (delay_minutes !== undefined) trip.delay_minutes = delay_minutes
      trip.note = note || trip.note
      return { trip }
    }
  }
  throw new Error('trip not found')
}

export function mockEndTrip(tripId) {
  for (const [busId, trip] of mockTrips) {
    if (trip.trip_id === tripId) {
      trip.trip_status = 'Completed'
      trip.end_time = new Date().toISOString()
      mockTrips.delete(busId)
      return { trip }
    }
  }
  throw new Error('trip not found')
}

export const mockRouteById = (id) => {
  const r = ROUTES.find((x) => x.route_id === id)
  if (!r) throw new Error('route not found')
  return r
}

export const ALL_STOP_NAMES = [
  ...new Set(ROUTES.flatMap((r) => r.stops.map((s) => s.stop_name))),
].sort()
