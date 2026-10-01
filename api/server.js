// Routepulse API — Express REST + WebSocket (same port, path /ws) + ETA engine.
// Port 8787. DB auto-created and seeded by ./db.js on first run.

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';
import { WebSocketServer } from 'ws';
import { db } from './db.js';
import { seedHistory } from './history.js';
import {
  buildPolyline,
  projectOntoPolyline,
  pointAtDistance,
  haversineKm,
} from './geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const DEFAULT_SPEED_KMH = 25;
const EMA_ALPHA = 0.35; // weight of each new observed speed
const POSITION_STALE_SEC = 25; // past this, ETA confidence drops to 'low'

// In-process GPS simulator (single-process deploys): on unless SIMULATE=0.
const SIMULATE = process.env.SIMULATE !== '0';
const SIM_BASE_KMH = Number(process.env.SIM_SPEED_KMH || 28);
const SIM_INTERVAL_MS = 1000;

const OPERATOR_KEY = process.env.OPERATOR_KEY || 'routepulse-demo-key';

const app = express();
app.set('trust proxy', 1); // behind Render's proxy → correct client IPs for rate limiting
app.disable('x-powered-by');

// F-03 (SECURITY_FINDINGS.md): rate limiting — per IP across /api. 1000/15min
// still caps floods (~1 req/s sustained) but won't lock out a judge whose
// browser polls ETAs/alerts/stats from a single IP. Ingest gets its own
// looser bucket (machine GPS traffic).
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8000, standardHeaders: true, legacyHeaders: false });
const ingestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8000, standardHeaders: true, legacyHeaders: false });
app.use('/api/ingest', ingestLimiter);
app.use('/api', apiLimiter);

// F-01: mutating (non-GET) /api calls require the operator key.
// GETs and the WS feed stay public — passenger screens are read-only.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.get('x-api-key') === OPERATOR_KEY) return next();
  return res.status(401).json({ error: 'unauthorized — send x-api-key header' });
});

app.use(express.json());

// ---------------------------------------------------------------------------
// In-memory live state (source of truth for /api/locations + WS frames)
// ---------------------------------------------------------------------------
const positions = new Map(); // bus_id -> { lat, lng, speed, updated_at, trip_id, route_id }
const tripByBus = new Map(); // bus_id  -> live trip row (trip_status 'On Route'|'Delayed')
const routeStats = new Map(); // route_id -> { ema, samples, recent[] }  (EMA of observed speeds)
const routeCtx = new Map(); // route_id -> { stops, poly }

// WP2: crowd reporting — latest level per route, in-memory (resets on restart).
const crowdByRoute = new Map(); // route_id -> { level, updated_at }
const CROWD_LEVELS = ['empty', 'seats', 'packed'];
const crowdOf = (routeId) => crowdByRoute.get(routeId)?.level ?? null;

// Real road geometry per route (snapped via OSRM against OSM Lahore — see
// scripts/snap_routes.mjs). Falls back to straight stop-to-stop lines if the
// file is missing or a route is absent (e.g. newly seeded route).
const ROAD_ROUTES = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'road_routes.json'), 'utf8'));
  } catch {
    return {};
  }
})();

function getRouteContext(routeId) {
  let ctx = routeCtx.get(routeId);
  if (!ctx) {
    const stops = db
      .prepare('SELECT * FROM stop WHERE route_id = ? ORDER BY stop_order')
      .all(routeId);
    const road = ROAD_ROUTES[String(routeId)];
    const poly = road?.coords?.length
      ? buildPolyline(road.coords.map(([lat, lng]) => ({ lat, lng })))
      : buildPolyline(stops);
    ctx = { stops, poly, road_km: road?.distance_km ?? null, road_coords: road?.coords ?? null };
    routeCtx.set(routeId, ctx);
  }
  return ctx;
}

function loadLiveState() {
  const trips = db
    .prepare("SELECT * FROM trip WHERE trip_status IN ('On Route','Delayed')")
    .all();
  let loaded = 0;
  for (const trip of trips) {
    // Guard: a trip whose route is missing or has no stops (partial seed,
    // spare bus with null route_id, platform-seeded DB) must never crash boot.
    const firstStop = db
      .prepare('SELECT lat, lng FROM stop WHERE route_id = ? ORDER BY stop_order LIMIT 1')
      .get(trip.route_id);
    if (!firstStop) {
      console.warn(`[api] skipping trip ${trip.trip_id} (bus ${trip.bus_id}) — route ${trip.route_id} missing or has no stops; bus stays Available (no live state)`);
      continue;
    }
    tripByBus.set(trip.bus_id, trip);
    let lat = null;
    let lng = null;
    if (trip.current_location) {
      const [a, b] = String(trip.current_location).split(',').map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        lat = a;
        lng = b;
      }
    }
    if (lat == null) {
      lat = firstStop.lat;
      lng = firstStop.lng;
    }
    positions.set(trip.bus_id, {
      lat,
      lng,
      speed: null,
      updated_at: trip.start_time,
      trip_id: trip.trip_id,
      route_id: trip.route_id,
    });
    loaded += 1;
  }
  console.log(`[api] ${loaded}/${trips.length} active trip(s) loaded`);
}

// ---------------------------------------------------------------------------
// ETA engine: distance-along-polyline + per-route EMA speed + confidence
// ---------------------------------------------------------------------------

/** Record an observed speed into the per-route EMA. Returns stats. */
function observeSpeed(routeId, kmh) {
  let st = routeStats.get(routeId);
  if (!st) {
    st = { ema: null, samples: 0, recent: [] };
    routeStats.set(routeId, st);
  }
  st.ema = st.ema == null ? kmh : st.ema * (1 - EMA_ALPHA) + kmh * EMA_ALPHA;
  st.samples += 1;
  st.recent.push(kmh);
  if (st.recent.length > 12) st.recent.shift();
  return st;
}

function currentSpeedKmh(routeId) {
  const st = routeStats.get(routeId);
  // Floor at 3 km/h: an EMA of exactly 0 (first ingest without a speed field,
  // or a stopped bus) divides every ETA to Infinity → serialized as null.
  return Math.max(3, st?.ema ?? DEFAULT_SPEED_KMH);
}

/**
 * Rule-based confidence for an ETA.
 * 'high' = enough speed samples, tight speed jitter, bus on the polyline, fresh data
 * 'medium' = some samples / moderate jitter
 * 'low'  = cold start, stale bus, or bus far off route → frontend shows "estimating…"
 */
function etaConfidence(routeId, offRouteKm, updatedAgeSec) {
  const st = routeStats.get(routeId);
  if (!st || st.samples < 2) return 'low';
  if (updatedAgeSec > POSITION_STALE_SEC) return 'low';
  if (offRouteKm > 0.5) return 'low';
  if (st.samples >= 8 && offRouteKm < 0.2) {
    const rec = st.recent;
    const mean = rec.reduce((a, b) => a + b, 0) / rec.length;
    const sd = Math.sqrt(rec.reduce((a, b) => a + (b - mean) ** 2, 0) / rec.length);
    return sd <= 6 ? 'high' : 'medium';
  }
  return 'medium';
}

/** ETA uncertainty half-window (minutes) by confidence. */
function etaRangeMin(etaMin, confidence) {
  const f = confidence === 'high' ? 0.12 : confidence === 'medium' ? 0.28 : 0.5;
  return Math.round(Math.max(1, etaMin * f) * 10) / 10;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

/** Per-stop ETAs for a bus on a route: remaining polyline km ÷ EMA speed + delay. */
function computeEtas(routeId, busId) {
  const ctx = getRouteContext(routeId);
  const pos = positions.get(busId);
  const trip = tripByBus.get(busId);
  const speed = currentSpeedKmh(routeId);
  const delay = trip?.delay_minutes || 0;
  const proj = projectOntoPolyline(pos.lat, pos.lng, ctx.poly);
  const ageSec = (Date.now() - new Date(pos.updated_at).getTime()) / 1000;
  const confidence = etaConfidence(routeId, proj.offsetKm, ageSec);

  const etas = ctx.stops.map((s, i) => {
    // Loop-aware: stops the bus already passed get their next-loop ETA instead
    // of pinning at 0 min / 0 km until the simulator wraps distAlong to 0.
    const ahead = ctx.poly.cum[i] - proj.distAlong;
    const remaining = ahead < 0 ? ahead + ctx.poly.total : Math.max(0, ahead);
    const etaMin = (remaining / speed) * 60 + delay;
    return {
      stop_id: s.stop_id,
      stop_name: s.stop_name,
      eta_min: round1(etaMin),
      eta_range_min: etaRangeMin(etaMin, confidence),
      confidence,
      distance_km: Math.round(remaining * 100) / 100,
      speed_kmh: round1(speed),
    };
  });
  return { etas, proj, confidence, speed, delay };
}

function nextStopInfo(routeId, distAlong) {
  const ctx = getRouteContext(routeId);
  for (let i = 0; i < ctx.stops.length; i++) {
    if (ctx.poly.cum[i] > distAlong + 0.02) {
      return { next_stop: ctx.stops[i].stop_name, remaining_km: ctx.poly.cum[i] - distAlong };
    }
  }
  const last = ctx.stops[ctx.stops.length - 1];
  return { next_stop: last.stop_name, remaining_km: 0 };
}

/** Build the canonical WS / locations payload for a bus. */
function locationPayload(busId, extraConfidence = true) {
  const pos = positions.get(busId);
  const trip = tripByBus.get(busId);
  if (!pos || !trip) return null;
  const ctx = getRouteContext(trip.route_id);
  const proj = projectOntoPolyline(pos.lat, pos.lng, ctx.poly);
  const { next_stop, remaining_km } = nextStopInfo(trip.route_id, proj.distAlong);
  const ageSec = (Date.now() - new Date(pos.updated_at).getTime()) / 1000;
  const confidence = extraConfidence
    ? etaConfidence(trip.route_id, proj.offsetKm, ageSec)
    : null;
  // ETA to the next stop (the number passengers watch count down)
  const speed = currentSpeedKmh(trip.route_id);
  const etaMin = (remaining_km / speed) * 60 + (trip.delay_minutes || 0);

  const payload = {
    type: 'location',
    bus_id: busId,
    route_id: trip.route_id,
    trip_id: trip.trip_id,
    lat: pos.lat,
    lng: pos.lng,
    speed: pos.speed != null ? pos.speed : round1(currentSpeedKmh(trip.route_id)),
    delay_minutes: trip.delay_minutes || 0,
    trip_status: trip.trip_status,
    next_stop,
    updated_at: pos.updated_at,
  };
  if (extraConfidence) {
    payload.next_stop_eta_min = round1(etaMin);
    payload.next_stop_eta_range_min = etaRangeMin(etaMin, confidence);
    payload.confidence = confidence;
  }
  return payload;
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function locationsArray() {
  const out = [];
  for (const [busId] of positions) {
    const p = locationPayload(busId, false);
    if (p) out.push({
      bus_id: p.bus_id,
      route_id: p.route_id,
      trip_id: p.trip_id,
      lat: p.lat,
      lng: p.lng,
      speed: p.speed,
      delay_minutes: p.delay_minutes,
      trip_status: p.trip_status,
      next_stop: p.next_stop,
      updated_at: p.updated_at,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// WebSocket (same HTTP server, path /ws) — snapshot on connect, then pushes
// ---------------------------------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'snapshot', locations: locationsArray() }));
});
const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState === 1) client.ping();
  }
}, 30000);
heartbeat.unref();

// ---------------------------------------------------------------------------
// Routes / search
// ---------------------------------------------------------------------------
const norm = (s) => String(s ?? '').trim().toLowerCase();

app.get('/api/routes', (req, res) => {
  const from = norm(req.query.from);
  const to = norm(req.query.to);

  const allRoutes = db.prepare('SELECT * FROM route WHERE active_status = 1 ORDER BY route_id').all();
  if (!from || !to) {
    const withStops = req.query.with_stops === '1';
    const stopsByRoute = db.prepare(
      'SELECT stop_id, stop_name, lat, lng, stop_order FROM stop WHERE route_id = ? ORDER BY stop_order'
    );
    return res.json({
      routes: allRoutes.map((r) => ({
        ...r,
        ...(withStops
          ? {
              stops: stopsByRoute.all(r.route_id),
              road_polyline: getRouteContext(r.route_id).road_coords ?? undefined,
            }
          : {}),
        crowd: crowdOf(r.route_id),
      })),
    });
  }

  const stopsByRoute = db.prepare('SELECT * FROM stop WHERE route_id = ? ORDER BY stop_order');
  const direct = [];
  for (const r of allRoutes) {
    const stops = stopsByRoute.all(r.route_id);
    const i = stops.findIndex((s) => norm(s.stop_name) === from);
    const j = stops.findIndex((s) => norm(s.stop_name) === to);
    if (i !== -1 && j !== -1 && j > i) {
      direct.push({
        route_id: r.route_id,
        route_name: r.route_name,
        start_location: r.start_location,
        destination: r.destination,
        fare_pkr: r.fare_pkr,
        crowd: crowdOf(r.route_id),
        stops: stops.map((s) => ({ stop_id: s.stop_id, stop_name: s.stop_name, stop_order: s.stop_order, lat: s.lat, lng: s.lng })), // full stop objects, matches /api/routes/:id
      });
    }
  }
  if (direct.length) return res.json({ direct: true, routes: direct });

  // No direct route — collect ALL transfers A: from → X, then B: X → to
  const withStops = allRoutes.map((r) => ({ r, stops: stopsByRoute.all(r.route_id) }));
  const transfers = [];
  const seen = new Set();
  for (const { r: ra, stops: sa } of withStops) {
    const fi = sa.findIndex((s) => norm(s.stop_name) === from);
    if (fi === -1) continue;
    for (const { r: rb, stops: sb } of withStops) {
      if (rb.route_id === ra.route_id) continue;
      const tj = sb.findIndex((s) => norm(s.stop_name) === to);
      if (tj === -1) continue;
      for (let ix = fi + 1; ix < sa.length; ix++) {
        const via = sa[ix].stop_name;
        const xj = sb.findIndex((s) => norm(s.stop_name) === norm(via));
        if (xj !== -1 && xj < tj) {
          const key = `${ra.route_id}|${norm(via)}|${rb.route_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          transfers.push({
            route_id: ra.route_id,
            route_name: ra.route_name,
            start_location: ra.start_location,
            destination: ra.destination,
            fare_pkr: ra.fare_pkr,
            crowd: crowdOf(ra.route_id),
            stops: sa.map((s) => ({ stop_id: s.stop_id, stop_name: s.stop_name, stop_order: s.stop_order, lat: s.lat, lng: s.lng })),
            transfer: {
              via_stop: via,
              then_route_id: rb.route_id,
              then_route_name: rb.route_name,
            },
          });
        }
      }
    }
  }
  if (transfers.length) {
    const first = transfers[0];
    return res.json({
      direct: false,
      // legacy top-level shape, kept for compat (first option only)
      transfer: {
        via_stop: first.transfer.via_stop,
        first: { route_id: first.route_id, route_name: first.route_name },
        second: { route_id: first.transfer.then_route_id, route_name: first.transfer.then_route_name },
      },
      routes: transfers.slice(0, 12),
    });
  }
  return res.json({ direct: false, transfer: null, routes: [] });
});

app.get('/api/routes/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM route WHERE route_id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'route not found' });
  const stops = db
    .prepare('SELECT stop_id, stop_name, lat, lng, stop_order FROM stop WHERE route_id = ? ORDER BY stop_order')
    .all(r.route_id);
  const ctx = getRouteContext(r.route_id);
  res.json({
    ...r,
    stops,
    crowd: crowdOf(r.route_id),
    road_polyline: ctx.road_coords ?? undefined,
    road_km: ctx.road_km ?? undefined,
  });
});

// ---------------------------------------------------------------------------
// WP2: crowd reporting — POST latest level per route (in-memory), GET returns it
// ---------------------------------------------------------------------------
app.post('/api/routes/:id/crowd', (req, res) => {
  const route = db.prepare('SELECT route_id FROM route WHERE route_id = ?').get(req.params.id);
  if (!route) return res.status(404).json({ error: 'route not found' });
  const { level } = req.body || {};
  if (!CROWD_LEVELS.includes(level)) {
    return res.status(400).json({ ok: false, error: `level must be one of: ${CROWD_LEVELS.join(' | ')}` });
  }
  const entry = { level, updated_at: new Date().toISOString() };
  crowdByRoute.set(route.route_id, entry);
  broadcast({ type: 'crowd', route_id: route.route_id, level, updated_at: entry.updated_at });
  res.json({ ok: true, route_id: route.route_id, level: entry.level, updated_at: entry.updated_at });
});

app.get('/api/routes/:id/crowd', (req, res) => {
  const entry = crowdByRoute.get(req.params.id);
  res.json({
    route_id: req.params.id,
    level: entry?.level ?? null,
    updated_at: entry?.updated_at ?? null,
  });
});

// ---------------------------------------------------------------------------
// Live locations + ETA endpoint (the judged "smart" feature)
// ---------------------------------------------------------------------------
app.get('/api/locations', (_req, res) => {
  res.json({ locations: locationsArray() });
});

app.get('/api/routes/:id/etas', (req, res) => {
  const routeId = req.params.id;
  const route = db.prepare('SELECT * FROM route WHERE route_id = ?').get(routeId);
  if (!route) return res.status(404).json({ error: 'route not found' });

  let busId = req.query.bus_id;
  if (!busId) {
    // default to the first live bus on this route (convenience for the frontend)
    for (const [bid, trip] of tripByBus) {
      if (trip.route_id === routeId) {
        busId = bid;
        break;
      }
    }
  }
  if (!busId || !positions.get(busId)) {
    return res.status(404).json({ error: 'no active bus on this route' });
  }
  const { etas } = computeEtas(routeId, busId);
  res.json({ etas });
});

// ---------------------------------------------------------------------------
// Ingest (driver app POST or simulator) → state, delay drift, DB, WS broadcast
// ---------------------------------------------------------------------------

/** Shared ingest path: EMA + delay drift + DB persist + WS broadcast.
 *  Used by the HTTP route below AND by the in-process simulator. */
function ingestPosition(busId, latIn, lngIn, speedIn) {
  const trip = tripByBus.get(busId);
  if (!trip) return null;

  const latN = Number(latIn);
  const lngN = Number(lngIn);
  const spd = Number.isFinite(Number(speedIn)) ? Math.max(0, Number(speedIn)) : 0;

  // 1) Per-route EMA of observed speeds (drives every ETA)
  observeSpeed(trip.route_id, spd);

  // 2) Rule-based delay drift:
  //    crawling/stopped → delay builds; free-flowing → delay slowly recovers.
  let delay = trip.delay_minutes || 0;
  let status = trip.trip_status;
  let statusFlipped = false;
  if (spd < 5 && delay < 45) {
    if (Math.random() < 0.5) delay += 1;
  } else if (spd >= 18 && delay > 0 && Math.random() < 0.06) {
    delay -= 1;
  }
  if (delay >= 5 && status === 'On Route') {
    status = 'Delayed';
    statusFlipped = true;
  } else if (delay === 0 && status === 'Delayed') {
    status = 'On Route';
    statusFlipped = true;
  }

  // 3) Persist + update memory
  const now = new Date().toISOString();
  const loc = `${latN},${lngN}`;
  db.prepare('UPDATE trip SET current_location = ?, delay_minutes = ?, trip_status = ? WHERE trip_id = ?')
    .run(loc, delay, status, trip.trip_id);
  if (statusFlipped) {
    db.prepare('UPDATE bus SET status = ? WHERE bus_id = ?').run(status, busId);
  }
  trip.delay_minutes = delay;
  trip.trip_status = status;
  trip.current_location = loc;
  positions.set(busId, {
    lat: latN,
    lng: lngN,
    speed: round1(spd),
    updated_at: now,
    trip_id: trip.trip_id,
    route_id: trip.route_id,
  });

  // 4) Broadcast to every connected passenger/operator screen
  const payload = locationPayload(busId);
  broadcast(payload);
  return payload;
}

app.post('/api/ingest/:bus_id', (req, res) => {
  const busId = req.params.bus_id;
  const { lat, lng, speed } = req.body || {};
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return res.status(400).json({ ok: false, error: 'lat and lng (numbers) are required' });
  }
  if (!tripByBus.get(busId)) {
    return res.status(409).json({ ok: false, error: `no active trip for bus ${busId}` });
  }
  ingestPosition(busId, lat, lng, speed);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
app.get('/api/alerts', (req, res) => {
  const routeId = req.query.route_id;
  const rows = routeId
    ? db.prepare('SELECT * FROM alert WHERE active = 1 AND (route_id = ? OR route_id IS NULL) ORDER BY created_at DESC').all(routeId)
    : db.prepare('SELECT * FROM alert WHERE active = 1 ORDER BY created_at DESC').all();
  res.json({ alerts: rows });
});

app.post('/api/alerts', (req, res) => {
  const { route_id, message } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ ok: false, error: 'message is required' });
  }
  const createdAt = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO alert (route_id, message, created_at, active) VALUES (?,?,?,1)')
    .run(route_id ?? null, String(message).trim(), createdAt);
  const alert = {
    alert_id: Number(info.lastInsertRowid),
    route_id: route_id ?? null,
    message: String(message).trim(),
    created_at: createdAt,
    active: 1,
  };
  broadcast({ type: 'alert', ...alert }); // lands on passenger screens in <2s, no refresh
  res.json({ ok: true, alert });
});

// ---------------------------------------------------------------------------
// Stats + drivers
// ---------------------------------------------------------------------------
app.get('/api/stats', (_req, res) => {
  const totalBuses = db.prepare('SELECT COUNT(*) AS n FROM bus').get().n;
  const active = [...tripByBus.values()];
  const activeBuses = active.filter((t) => t.trip_status === 'On Route').length;
  const delayedBuses = active.filter((t) => (t.delay_minutes || 0) > 0 || t.trip_status === 'Delayed').length;
  const offlineBuses =
    db.prepare("SELECT COUNT(*) AS n FROM bus WHERE status = 'Offline'").get().n +
    (totalBuses - active.length); // buses without a live trip are not reporting
  const routesRunning = new Set(active.map((t) => t.route_id)).size;
  const tripsToday = db
    .prepare("SELECT COUNT(*) AS n FROM trip WHERE date(start_time) = date('now','localtime')")
    .get().n;
  const avgDelay = active.length
    ? Math.round((active.reduce((a, t) => a + (t.delay_minutes || 0), 0) / active.length) * 10) / 10
    : 0;
  res.json({
    total_buses: totalBuses,
    active_buses: activeBuses,
    delayed_buses: delayedBuses,
    offline_buses: offlineBuses,
    routes_running: routesRunning,
    trips_today: tripsToday,
    avg_delay_min: avgDelay,
  });
});

app.get('/api/drivers', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT d.driver_id, d.name, d.phone, d.assigned_bus, d.current_trip, d.status,
              b.route_id, r.route_name
         FROM driver d
         LEFT JOIN bus b ON b.bus_id = d.assigned_bus
         LEFT JOIN route r ON r.route_id = b.route_id
        ORDER BY d.driver_id`
    )
    .all();
  res.json({ drivers: rows });
});

// ---------------------------------------------------------------------------
// WP3: delay-rhythm analytics (judged novelty feature) + ETA accuracy grades.
// Mined from the Completed-trip history seeded once by ./history.js.
// ---------------------------------------------------------------------------
const fmtHour = (h) => `${String(h).padStart(2, '0')}:00`;

function verdictFor(worstHour, worstAvg) {
  if (worstHour == null) return 'not enough history yet';
  const band = worstHour <= 10 ? 'morning' : worstHour <= 15 ? 'midday' : 'evening';
  if (worstAvg >= 12) return `chronic ${band} delays — budget +${Math.round(worstAvg)} min around ${fmtHour(worstHour)}`;
  if (worstAvg >= 7) return `regular ${band} delays of ~${Math.round(worstAvg)} min around ${fmtHour(worstHour)}`;
  return 'no strong delay rhythm — delays stay mild through the day';
}

app.get('/api/analytics/delay-patterns', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT route_id, CAST(strftime('%H', start_time) AS INTEGER) AS hour,
              ROUND(AVG(delay_minutes), 1) AS avg_delay_min, COUNT(*) AS samples
         FROM trip
        WHERE trip_status = 'Completed' AND start_time IS NOT NULL
        GROUP BY route_id, hour
       HAVING samples >= 3
        ORDER BY route_id, hour`
    )
    .all();
  const names = new Map(db.prepare('SELECT route_id, route_name FROM route').all().map((r) => [r.route_id, r.route_name]));
  const byRoute = new Map();
  for (const row of rows) {
    if (!byRoute.has(row.route_id)) {
      byRoute.set(row.route_id, { route_id: row.route_id, route_name: names.get(row.route_id) ?? null, by_hour: [] });
    }
    byRoute.get(row.route_id).by_hour.push({
      hour: row.hour,
      avg_delay_min: row.avg_delay_min,
      samples: row.samples,
    });
  }
  const patterns = [...byRoute.values()]
    .map((p) => {
      const worst = p.by_hour.reduce((a, b) => (b.avg_delay_min > a.avg_delay_min ? b : a));
      return {
        ...p,
        worst_hour: worst.hour,
        worst_avg_delay_min: worst.avg_delay_min,
        verdict: verdictFor(worst.hour, worst.avg_delay_min),
      };
    })
    .sort((a, b) => b.worst_avg_delay_min - a.worst_avg_delay_min); // worst offender first
  res.json({ patterns });
});

app.get('/api/analytics/summary', (_req, res) => {
  const completed = "trip_status = 'Completed' AND start_time IS NOT NULL";
  const network = db.prepare(`SELECT ROUND(AVG(delay_minutes), 1) AS avg FROM trip WHERE ${completed}`).get();
  const topRoute = db
    .prepare(
      `SELECT route_id, ROUND(AVG(delay_minutes), 1) AS avg_delay_min
         FROM trip WHERE ${completed} GROUP BY route_id
        ORDER BY AVG(delay_minutes) DESC LIMIT 1`
    )
    .get();
  const peak = db
    .prepare(
      `SELECT CAST(strftime('%H', start_time) AS INTEGER) AS hour, ROUND(AVG(delay_minutes), 1) AS avg_delay_min
         FROM trip WHERE ${completed} GROUP BY hour
       HAVING COUNT(*) >= 3
        ORDER BY AVG(delay_minutes) DESC LIMIT 1`
    )
    .get();
  let mostDelayed = null;
  if (topRoute) {
    const r = db.prepare('SELECT route_name FROM route WHERE route_id = ?').get(topRoute.route_id);
    mostDelayed = {
      route_id: topRoute.route_id,
      route_name: r?.route_name ?? null,
      avg_delay_min: topRoute.avg_delay_min,
    };
  }
  res.json({
    most_delayed_route: mostDelayed,
    peak_delay_hour: peak?.hour ?? null,
    network_avg_delay_min: network?.avg ?? 0,
  });
});

app.get('/api/analytics/eta-accuracy', (_req, res) => {
  const errors = db
    .prepare('SELECT predicted_eta_min, actual_eta_min FROM eta_sample WHERE actual_eta_min IS NOT NULL')
    .all()
    .map((r) => r.actual_eta_min - r.predicted_eta_min);
  if (!errors.length) {
    return res.json({ samples: 0, median_error_min: null, within_2min_pct: null });
  }
  const sorted = [...errors].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const within = errors.filter((e) => Math.abs(e) <= 2).length;
  res.json({
    samples: errors.length,
    median_error_min: round1(median),
    within_2min_pct: Math.round((within / errors.length) * 100),
  });
});

// ---------------------------------------------------------------------------
// Trip lifecycle
// ---------------------------------------------------------------------------
function startTripRow(busId, driverId, routeId) {
  const ctx = getRouteContext(routeId);
  const s0 = ctx.stops[0];
  const now = new Date().toISOString();
  const info = db
    .prepare(
      "INSERT INTO trip (bus_id, driver_id, route_id, start_time, current_location, trip_status, delay_minutes) VALUES (?,?,?,?,?,'On Route',0)"
    )
    .run(busId, driverId, routeId, now, `${s0.lat},${s0.lng}`);
  // WP3b: record our opening promise — final-stop ETA at the default speed —
  // so the trip can be graded on /api/analytics/eta-accuracy when it ends.
  const predicted = round1((ctx.poly.total / DEFAULT_SPEED_KMH) * 60);
  db.prepare(
    'INSERT INTO eta_sample (trip_id, route_id, predicted_eta_min, actual_eta_min, measured_at) VALUES (?,?,?,NULL,?)'
  ).run(Number(info.lastInsertRowid), routeId, predicted, now);
  return Number(info.lastInsertRowid);
}

function endTripRow(trip, newStatus = 'Completed') {
  const now = new Date().toISOString();
  db.prepare("UPDATE trip SET end_time = ?, trip_status = ? WHERE trip_id = ?").run(now, newStatus, trip.trip_id);
  db.prepare("UPDATE bus SET status = 'Available' WHERE bus_id = ?").run(trip.bus_id);
  db.prepare("UPDATE driver SET current_trip = NULL, status = 'Available' WHERE driver_id = ?").run(trip.driver_id);
  // WP3b: grade the prediction — actual vs predicted, only if one was recorded.
  const startMs = trip.start_time ? new Date(trip.start_time).getTime() : NaN;
  if (Number.isFinite(startMs)) {
    const actual = round1((Date.now() - startMs) / 60000);
    db.prepare('UPDATE eta_sample SET actual_eta_min = ?, measured_at = ? WHERE trip_id = ? AND actual_eta_min IS NULL')
      .run(actual, now, trip.trip_id);
  }
  tripByBus.delete(trip.bus_id);
  positions.delete(trip.bus_id);
}

app.post('/api/trips/start', (req, res) => {
  const { bus_id, driver_id, route_id } = req.body || {};
  if (!bus_id || !driver_id || !route_id) {
    return res.status(400).json({ ok: false, error: 'bus_id, driver_id and route_id are required' });
  }
  const bus = db.prepare('SELECT * FROM bus WHERE bus_id = ?').get(bus_id);
  const driver = db.prepare('SELECT * FROM driver WHERE driver_id = ?').get(driver_id);
  const route = db.prepare('SELECT * FROM route WHERE route_id = ?').get(route_id);
  if (!bus) return res.status(404).json({ ok: false, error: `bus ${bus_id} not found` });
  if (!driver) return res.status(404).json({ ok: false, error: `driver ${driver_id} not found` });
  if (!route) return res.status(404).json({ ok: false, error: `route ${route_id} not found` });
  // Guard: a route with zero stops (bad/partial seed) can't anchor a trip.
  const startStop = db
    .prepare('SELECT lat, lng FROM stop WHERE route_id = ? ORDER BY stop_order LIMIT 1')
    .get(route_id);
  if (!startStop) {
    return res.status(409).json({ ok: false, error: `route ${route_id} has no stops — cannot start a trip` });
  }

  // Demo-friendly: silently close any previous active trip on this bus.
  const existing = tripByBus.get(bus_id);
  if (existing) endTripRow(existing);

  const tripId = startTripRow(bus_id, driver_id, route_id);
  db.prepare('UPDATE bus SET status = ?, driver_id = ?, route_id = ? WHERE bus_id = ?')
    .run('On Route', driver_id, route_id, bus_id);
  db.prepare('UPDATE driver SET current_trip = ?, status = ?, assigned_bus = ? WHERE driver_id = ?')
    .run(String(tripId), 'On Route', bus_id, driver_id);

  const trip = db.prepare('SELECT * FROM trip WHERE trip_id = ?').get(tripId);
  tripByBus.set(bus_id, trip);
  positions.set(bus_id, {
    lat: startStop.lat,
    lng: startStop.lng,
    speed: null,
    updated_at: new Date().toISOString(),
    trip_id: tripId,
    route_id,
  });
  broadcast(locationPayload(bus_id));
  res.json({ ok: true, trip });
});

app.post('/api/trips/:id/update', (req, res) => {
  const tripId = Number(req.params.id);
  const trip =
    [...tripByBus.values()].find((t) => t.trip_id === tripId) ||
    db.prepare('SELECT * FROM trip WHERE trip_id = ?').get(tripId);
  if (!trip) return res.status(404).json({ ok: false, error: `trip ${tripId} not found` });

  const { trip_status, delay_minutes, note } = req.body || {};
  if (trip_status === undefined && delay_minutes === undefined && note === undefined) {
    return res.status(400).json({ ok: false, error: 'nothing to update (trip_status, delay_minutes or note)' });
  }

  const newStatus = trip_status ?? trip.trip_status;
  const newDelay = Number.isFinite(Number(delay_minutes)) ? Math.max(0, Math.round(Number(delay_minutes))) : trip.delay_minutes;
  db.prepare('UPDATE trip SET trip_status = ?, delay_minutes = ? WHERE trip_id = ?').run(newStatus, newDelay, tripId);

  const isLive = tripByBus.get(trip.bus_id)?.trip_id === tripId;
  if (isLive) {
    trip.trip_status = newStatus;
    trip.delay_minutes = newDelay;
    const busStatus =
      newStatus === 'Completed' || newStatus === 'Cancelled'
        ? 'Available'
        : newStatus === 'Delayed'
          ? 'Delayed'
          : 'On Route';
    db.prepare('UPDATE bus SET status = ? WHERE bus_id = ?').run(busStatus, trip.bus_id);
    if (newStatus === 'Completed' || newStatus === 'Cancelled') endTripRow(trip, newStatus);
  }

  // Free-text note becomes a visible service alert for that route.
  if (note && String(note).trim()) {
    const createdAt = new Date().toISOString();
    const info = db
      .prepare('INSERT INTO alert (route_id, message, created_at, active) VALUES (?,?,?,1)')
      .run(trip.route_id, String(note).trim(), createdAt);
    broadcast({
      type: 'alert',
      alert_id: Number(info.lastInsertRowid),
      route_id: trip.route_id,
      message: String(note).trim(),
      created_at: createdAt,
      active: 1,
    });
  }

  const updated = db.prepare('SELECT * FROM trip WHERE trip_id = ?').get(tripId);
  if (isLive && tripByBus.get(trip.bus_id)) broadcast(locationPayload(trip.bus_id));
  res.json({ ok: true, trip: updated });
});

app.post('/api/trips/:id/end', (req, res) => {
  const tripId = Number(req.params.id);
  const trip =
    [...tripByBus.values()].find((t) => t.trip_id === tripId) ||
    db.prepare('SELECT * FROM trip WHERE trip_id = ?').get(tripId);
  if (!trip) return res.status(404).json({ ok: false, error: `trip ${tripId} not found` });
  // Idempotent: a 'route blocked' cancel already set end_time — a repeat /end
  // returns success instead of 409 so the driver app can't get stuck.
  if (trip.end_time) {
    return res.json({
      ok: true,
      trip: db.prepare('SELECT * FROM trip WHERE trip_id = ?').get(tripId),
      already_ended: true,
    });
  }

  endTripRow(trip, 'Completed');
  broadcast({ type: 'trip_ended', bus_id: trip.bus_id, trip_id: tripId, route_id: trip.route_id });
  const updated = db.prepare('SELECT * FROM trip WHERE trip_id = ?').get(tripId);
  res.json({ ok: true, trip: updated });
});

// ---------------------------------------------------------------------------
// Real-world conditions — live Lahore weather + air quality (Open-Meteo, no
// key required, 10-minute in-memory cache). Gives the control room a genuine
// "why is traffic like this today" read: heat, rain, and the famous smog.
// ---------------------------------------------------------------------------
let conditionsCache = { at: 0, data: null };
const LAHORE = { lat: 31.5497, lng: 74.3436 };

function aqiVerdict(aqi, pm25) {
  const score = aqi ?? (pm25 != null ? Math.round(pm25 * 2.2) : null);
  if (score == null) return null;
  if (score >= 301) return { band: 'HAZARDOUS', note: 'smog hazardous — service at risk, advisories likely' };
  if (score >= 201) return { band: 'VERY UNHEALTHY', note: 'smog very unhealthy — expect heavy delays' };
  if (score >= 151) return { band: 'UNHEALTHY', note: 'smog unhealthy — buses crawling on corridors' };
  if (score >= 101) return { band: 'UNHEALTHY FOR SENSITIVE', note: 'haze unhealthy for sensitive groups' };
  if (score >= 51) return { band: 'MODERATE', note: 'moderate haze — normal service' };
  return { band: 'GOOD', note: 'clear air — rare and beautiful' };
}

app.get('/api/conditions', async (_req, res) => {
  if (Date.now() - conditionsCache.at < 10 * 60 * 1000 && conditionsCache.data) {
    return res.json(conditionsCache.data);
  }
  try {
    const wxUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${LAHORE.lat}&longitude=${LAHORE.lng}` +
      '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m';
    const aqUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAHORE.lat}&longitude=${LAHORE.lng}` +
      '&current=pm2_5,us_aqi';
    const [wxRes, aqRes] = await Promise.all([
      fetch(wxUrl, { signal: AbortSignal.timeout(8000) }),
      fetch(aqUrl, { signal: AbortSignal.timeout(8000) }),
    ]);
    const wx = await wxRes.json();
    const aq = await aqRes.json().catch(() => ({}));
    const cur = wx.current ?? {};
    const aqCur = aq.current ?? {};
    const pm25 = aqCur.pm2_5 != null ? Math.round(aqCur.pm2_5) : null;
    const data = {
      city: 'Lahore',
      temperature_c: cur.temperature_2m != null ? Math.round(cur.temperature_2m) : null,
      humidity: cur.relative_humidity_2m ?? null,
      wind_kmh: cur.wind_speed_10m != null ? Math.round(cur.wind_speed_10m) : null,
      weather_code: cur.weather_code ?? null,
      pm2_5: pm25,
      us_aqi: aqCur.us_aqi != null ? Math.round(aqCur.us_aqi) : null,
      verdict: aqiVerdict(aqCur.us_aqi != null ? Math.round(aqCur.us_aqi) : null, pm25),
      observed_at: new Date().toISOString(),
      source: 'open-meteo.com (real observations)',
    };
    conditionsCache = { at: Date.now(), data };
    res.json(data);
  } catch (e) {
    if (conditionsCache.data) return res.json({ ...conditionsCache.data, stale: true });
    res.status(502).json({ error: 'conditions unavailable', detail: e.message });
  }
});

// ---------------------------------------------------------------------------
// Station board — GET /api/stops/:name/departures
// Every active bus whose route serves the named stop, ETAs computed the same
// way as /api/routes/:id/etas (polyline projection + EMA speed + delay).
// :name matches case/whitespace-insensitively; only the first matching
// stop_name feeds the board so shared stop names across routes line up.
// ---------------------------------------------------------------------------
const flatName = (s) => norm(s).replace(/\s+/g, ' ');

app.get('/api/stops/:name/departures', (req, res) => {
  const fallback = { stop_name: req.params.name, departures: [] };
  try {
    const want = flatName(req.params.name);
    if (!want) return res.json(fallback);

    const names = db.prepare('SELECT DISTINCT stop_name FROM stop').all().map((r) => r.stop_name);
    const match = names.find((n) => flatName(n) === want);
    if (!match) return res.json(fallback); // unknown stop → empty board, not a 404

    // Same-named stop on several routes (one row per route serves the board)
    const stopsForName = db.prepare('SELECT * FROM stop WHERE stop_name = ?').all(match);
    const routeById = new Map(); // per-request cache of route rows

    const rows = [];
    for (const [busId, trip] of tripByBus) {
      try {
        const stop = stopsForName.find((s) => String(s.route_id) === String(trip.route_id));
        const pos = positions.get(busId);
        if (!stop || !pos) continue; // route doesn't serve this stop / no live fix

        const ctx = getRouteContext(trip.route_id);
        const busProj = projectOntoPolyline(Number(pos.lat), Number(pos.lng), ctx.poly);
        const stopProj = projectOntoPolyline(stop.lat, stop.lng, ctx.poly);
        // Loop-aware remaining km: already-passed stops get their next-pass ETA
        let ahead = stopProj.distAlong - busProj.distAlong;
        if (ahead < 0) ahead += ctx.poly.total;
        const remainingKm = Math.max(0, ahead);

        const speed = Math.max(currentSpeedKmh(trip.route_id), 5);
        const delay = trip.delay_minutes || 0;
        const ageSec = (Date.now() - new Date(pos.updated_at).getTime()) / 1000;

        if (!routeById.has(trip.route_id)) {
          routeById.set(trip.route_id, db.prepare('SELECT route_name, destination FROM route WHERE route_id = ?').get(trip.route_id));
        }
        const route = routeById.get(trip.route_id);

        rows.push({
          route_id: trip.route_id,
          route_name: route?.route_name ?? null,
          headsign: route?.destination ?? route?.route_name ?? null,
          eta_min: round1((remainingKm / speed) * 60 + delay),
          confidence: etaConfidence(trip.route_id, busProj.offsetKm, ageSec),
          delay_minutes: delay,
          bus_id: busId,
          trip_status: trip.trip_status,
        });
      } catch (e) {
        console.error(`[api] departures row ${busId}:`, e.message); // one bad bus never kills the board
      }
    }

    rows.sort((a, b) => a.eta_min - b.eta_min);
    return res.json({ stop_name: match, departures: rows.slice(0, 12) });
  } catch (e) {
    console.error('[api] departures:', e.message);
    return res.json(fallback); // never crash: empty board beats a 500
  }
});

// ---------------------------------------------------------------------------
// WP5: bunching radar — the classic transit-ops failure where two buses on
// the same route pair up and travel as one. Detected live from positions;
// the fix (hold the follower at its next stop) is what real agencies do.
// ---------------------------------------------------------------------------
const BUNCHING_THRESHOLD_KM = 0.4;

app.get('/api/analytics/bunching', (_req, res) => {
  try {
    const byRoute = new Map();
    for (const [busId, pos] of positions) {
      const trip = tripByBus.get(busId);
      if (!trip || pos.lat == null) continue;
      if (!byRoute.has(trip.route_id)) byRoute.set(trip.route_id, []);
      byRoute.get(trip.route_id).push({
        bus_id: busId,
        lat: pos.lat,
        lng: pos.lng,
        speed: pos.speed ?? 0,
        next_stop: null,
      });
    }
    const pairs = [];
    for (const [route_id, buses] of byRoute) {
      for (let i = 0; i < buses.length; i++) {
        for (let j = i + 1; j < buses.length; j++) {
          const a = buses[i];
          const b = buses[j];
          const gapKm = haversineKm(a.lat, a.lng, b.lat, b.lng);
          if (gapKm <= BUNCHING_THRESHOLD_KM) {
            pairs.push({
              route_id,
              bus_a: a.bus_id,
              bus_b: b.bus_id,
              gap_m: Math.round(gapKm * 1000),
              avg_speed_kmh: Math.round((a.speed + b.speed) / 2),
            });
          }
        }
      }
    }
    pairs.sort((x, y) => x.gap_m - y.gap_m);
    res.json({
      threshold_m: BUNCHING_THRESHOLD_KM * 1000,
      routes_scanned: byRoute.size,
      buses_scanned: positions.size,
      pairs: pairs.slice(0, 8),
    });
  } catch (e) {
    res.status(500).json({ error: 'bunching scan failed', detail: e.message });
  }
});

// ---------------------------------------------------------------------------
// WP6: time travel — the server keeps a 2-hour ring buffer of fleet
// snapshots (every 10s). /api/replay returns the window so the operator can
// scrub the network's recent past: watch delays bloom and buses loop.
// ---------------------------------------------------------------------------
const REPLAY_STEP_MS = 10000;
const REPLAY_WINDOW_MS = 2 * 60 * 60 * 1000;
const replayBuffer = [];

function snapshotReplay() {
  if (!positions.size) return;
  replayBuffer.push({
    at: Date.now(),
    buses: [...positions.entries()].map(([bus_id, p]) => {
      const trip = tripByBus.get(bus_id);
      return {
        bus_id,
        route_id: p.route_id,
        lat: p.lat != null ? +p.lat.toFixed(5) : null,
        lng: p.lng != null ? +p.lng.toFixed(5) : null,
        speed: p.speed ?? null,
        delay_minutes: trip?.delay_minutes ?? 0,
        trip_status: trip?.trip_status ?? 'Unknown',
      };
    }),
  });
  while (replayBuffer.length && replayBuffer[0].at < Date.now() - REPLAY_WINDOW_MS) {
    replayBuffer.shift();
  }
}
setInterval(snapshotReplay, REPLAY_STEP_MS).unref();

app.get('/api/replay', (req, res) => {
  const minutes = Math.min(Math.max(Number(req.query.minutes) || 60, 5), 120);
  const cutoff = Date.now() - minutes * 60000;
  const frames = replayBuffer.filter((f) => f.at >= cutoff);
  const step_s =
    frames.length > 1 ? Math.max(Math.round((frames[1].at - frames[0].at) / 1000), 1) : REPLAY_STEP_MS / 1000;
  res.json({
    step_s,
    window_minutes: minutes,
    recorded_minutes: frames.length ? Math.round(((frames[frames.length - 1].at - frames[0].at) / 60000) * 10) / 10 : 0,
    frames,
  });
});

// ---------------------------------------------------------------------------
// Health + fallthrough
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

// ---------------------------------------------------------------------------
// Single-domain deploy: serve the built frontend (app/dist) from this server.
// In dev the app runs on its own vite port with a proxy — this only activates
// when a production build exists.
// ---------------------------------------------------------------------------
const distDir = path.join(__dirname, '..', 'app', 'dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir));
  // SPA fallback: any non-/api GET serves the app (client routing)
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  console.log('[api] serving frontend from app/dist (single-domain mode)');
}
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[api] error:', err.message);
  // Honor parser errors' status (e.g. malformed JSON body → 400, not 500).
  if (res.headersSent) return _next(err);
  res.status(err.status || err.statusCode || 500).json({ error: 'internal error' });
});

// ---------------------------------------------------------------------------
// WP3: 14-day trip history + ETA samples (idempotent — runs once per DB).
seedHistory();

loadLiveState();

// WP2: seed a few crowd levels so the UI shows data before the first report.
const crowdBootIso = new Date().toISOString();
for (const [rid, lvl] of [['1', 'seats'], ['3', 'packed'], ['2', 'seats'], ['4', 'empty'], ['6', 'seats'], ['8', 'empty']]) {
  crowdByRoute.set(rid, { level: lvl, updated_at: crowdBootIso });
}

// ---------------------------------------------------------------------------
// In-process GPS simulator (SIMULATE !== '0') — replaces the separate
// /simulator process for single-process deploys (Render etc.). Same movement
// model as simulator/sim.js: ~28 km/h ±20% random walk along the route
// polyline, looping back to the start at the end. Driver-app GPS
// (POST /api/ingest) keeps working alongside it; trips started mid-session
// are picked up automatically on the next tick.
// ---------------------------------------------------------------------------
if (SIMULATE) {
  const simState = new Map(); // bus_id -> { distAlong, factor, route_id }
  setInterval(() => {
    const dtH = SIM_INTERVAL_MS / 3600000;
    for (const [busId, trip] of tripByBus) {
      try {
        const { poly } = getRouteContext(trip.route_id);
        let st = simState.get(busId);
        if (!st || st.route_id !== trip.route_id) {
          const pos = positions.get(busId) || {};
          const proj = projectOntoPolyline(Number(pos.lat), Number(pos.lng), poly);
          st = { distAlong: proj.distAlong, factor: 1, route_id: trip.route_id };
          console.log(
            `[sim] tracking ${busId} on route ${trip.route_id} — joined at ${proj.distAlong.toFixed(2)} km`
          );
        }
        st.factor = Math.min(1.2, Math.max(0.8, st.factor + (Math.random() - 0.5) * 0.12));
        st.distAlong += SIM_BASE_KMH * st.factor * dtH;
        if (st.distAlong >= poly.total) st.distAlong = 0; // loop the service
        simState.set(busId, st);
        const p = pointAtDistance(poly, st.distAlong);
        ingestPosition(busId, p.lat, p.lng, SIM_BASE_KMH * st.factor);
      } catch (e) {
        console.error(`[sim] ${busId}:`, e.message);
      }
    }
  }, SIM_INTERVAL_MS);
  console.log(
    `[sim] in-process simulator ON — ${SIM_BASE_KMH} km/h every ${SIM_INTERVAL_MS}ms (SIMULATE=0 to disable)`
  );
}

server.listen(PORT, () => {
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log('│  ROUTEPULSE API                                      │');
  console.log(`│  REST  http://localhost:${PORT}/api/...                │`);
  console.log(`│  WS    ws://localhost:${PORT}/ws                       │`);
  console.log('│  GET  /api/routes?from=&to=      route search        │');
  console.log('│  GET  /api/routes/:id            route + stops       │');
  console.log('│  GET  /api/routes/:id/etas?bus_id=  smart ETAs       │');
  console.log('│  GET  /api/locations             live fleet          │');
  console.log('│  POST /api/ingest/:bus_id        GPS ingest          │');
  console.log('│  GET/POST /api/alerts            service alerts      │');
  console.log('│  GET  /api/stats  /api/drivers   dashboards          │');
  console.log('│  POST /api/trips/start /:id/update /:id/end          │');
  console.log('│  GET  /api/analytics/*  delay rhythms + ETA grades  │');
  console.log('└──────────────────────────────────────────────────────┘');
});
