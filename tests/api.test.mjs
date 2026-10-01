// Routepulse API integration tests — golden path + security + chaos basics.
// Run: npm test   (spawns its own server on :8791, SIMULATE off, cleans up after)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8791;
const BASE = `http://localhost:${PORT}`;
const KEY = 'routepulse-demo-key'; // same default the server uses
let server;
let serverLogs = '';

const api = (p, opts = {}) => fetch(BASE + p, opts);
const GET = (p) => api(p);
const POST = (p, body, withKey = true) =>
  api(p, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withKey ? { 'x-api-key': KEY } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

const requireApi = createRequire(path.join(ROOT, 'api', 'package.json'));

const waitHealthy = async (tries = 30) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

before(async () => {
  server = spawn(process.execPath, ['api/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), SIMULATE: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => (serverLogs += d));
  server.stderr.on('data', (d) => (serverLogs += d));
  assert.ok(await waitHealthy(), 'server did not become healthy — logs:\n' + serverLogs.slice(-800));
});

after(async () => {
  if (server) server.kill();
  // cleanup: remove rows the tests created so the demo DB stays pristine
  try {
    const Database = requireApi('better-sqlite3');
    const db = new Database(path.join(ROOT, 'api', 'data.db'));
    db.prepare("DELETE FROM alert WHERE message LIKE 'TEST-%'").run();
    db.prepare("DELETE FROM trip WHERE bus_id = 'B-21'").run();
    db.prepare("UPDATE bus SET status = 'Available' WHERE bus_id = 'B-21'").run();
    db.prepare("UPDATE driver SET current_trip = NULL WHERE driver_id = 'D-05'").run();
    db.close();
  } catch (e) {
    console.error('cleanup failed:', e.message);
  }
});

// ---------- golden path ----------

test('health responds ok', async () => {
  const r = await GET('/api/health');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('route search finds a direct route with ordered stops', async () => {
  const r = await GET('/api/routes?from=' + encodeURIComponent('City Center') + '&to=' + encodeURIComponent('University Gate'));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.direct, true);
  assert.ok(j.routes.length >= 1);
  const route = j.routes.find((x) => x.route_id === '7');
  assert.ok(route, 'route 7 should serve City Center → University Gate');
  const orders = route.stops.map((s) => s.stop_order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'stops must be ordered');
});

test('transfer suggestion when no direct route exists', async () => {
  // Airport → University Gate: route 3 ends at City Center; route 7/9 continue — expect a transfer via City Center
  const r = await GET('/api/routes?from=' + encodeURIComponent('Airport') + '&to=' + encodeURIComponent('University Gate'));
  const j = await r.json();
  if (j.direct) return; // network grew a direct route — transfer no longer required
  assert.ok(j.transfer, 'no direct route → transfer must be suggested');
  assert.ok(j.transfer.via_stop, 'transfer names the connection stop');
});

test('route detail returns the route with its stops', async () => {
  const r = await GET('/api/routes/7');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.route_name || j.start_location, 'route detail has identity fields');
});

// ---------- security: writes are gated ----------

test('ingest without x-api-key is rejected 401', async () => {
  const r = await POST('/api/ingest/B-07', { lat: 31.5582, lng: 74.3507, speed: 25 }, false);
  assert.equal(r.status, 401);
});

test('trip start without x-api-key is rejected 401', async () => {
  const r = await POST('/api/trips/start', { bus_id: 'B-21', driver_id: 'D-05', route_id: '9' }, false);
  assert.equal(r.status, 401);
});

test('alert create without x-api-key is rejected 401', async () => {
  const r = await POST('/api/alerts', { route_id: '7', message: 'TEST-nope' }, false);
  assert.equal(r.status, 401);
});

// ---------- live data: ingest → locations → ETAs ----------

test('ingest with key accepts a position', async () => {
  const r = await POST('/api/ingest/B-07', { lat: 31.5582, lng: 74.3507, speed: 25 });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('ingested bus appears in /api/locations with next_stop', async () => {
  const r = await GET('/api/locations');
  const j = await r.json();
  const b07 = (j.locations || []).find((l) => l.bus_id === 'B-07');
  assert.ok(b07, 'B-07 present in live locations');
  assert.ok(typeof b07.lat === 'number' && typeof b07.lng === 'number');
  assert.ok(b07.next_stop, 'next_stop computed');
});

test('ETA engine returns numeric per-stop ETAs with confidence', async () => {
  const r = await GET('/api/routes/7/etas?bus_id=B-07');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.etas) && j.etas.length === 6, '6 stops for route 7');
  for (const e of j.etas) {
    assert.equal(typeof e.eta_min, 'number', 'eta_min numeric');
    assert.ok(e.eta_min >= 0, 'eta_min >= 0 (wrap-ahead allowed)');
    assert.ok(['high', 'medium', 'low'].includes(e.confidence), 'confidence present');
    assert.equal(typeof e.distance_km, 'number');
  }
});

// ---------- trip lifecycle ----------

test('trip lifecycle: start → delay update → end (B-21 spare bus)', async () => {
  const start = await POST('/api/trips/start', { bus_id: 'B-21', driver_id: 'D-05', route_id: '9' });
  assert.equal(start.status, 200, 'trip starts');
  const trip = (await start.json()).trip || (await start.json());
  const tripId = trip.trip_id ?? trip.id;
  assert.ok(tripId, 'trip id returned');

  const upd = await POST(`/api/trips/${tripId}/update`, { trip_status: 'Delayed', delay_minutes: 4 });
  assert.equal(upd.status, 200, 'trip update works');

  const stats = await (await GET('/api/stats')).json();
  assert.equal(typeof stats.total_buses, 'number');
  assert.ok(stats.total_buses >= 6, 'seed fleet present');

  const end = await POST(`/api/trips/${tripId}/end`, {});
  assert.equal(end.status, 200, 'trip ends');
});

// ---------- alerts + crowd ----------

test('alert create with key works and is listed', async () => {
  const r = await POST('/api/alerts', { route_id: '7', message: 'TEST- signal failure at Civil Area' });
  assert.equal(r.status, 200);
  const list = await (await GET('/api/alerts')).json();
  const msgs = (list.alerts || list).map((a) => a.message || '');
  assert.ok(msgs.some((m) => m.includes('TEST-')), 'test alert appears in feed');
  // cleanup happens in after() — test alert is deleted from the DB
});

test('crowd report: create + read + validation', async () => {
  const bad = await POST('/api/routes/7/crowd', { level: 'walrus' });
  assert.equal(bad.status, 400, 'invalid crowd level rejected');

  const ok = await POST('/api/routes/7/crowd', { level: 'packed' });
  assert.ok(ok.status === 200 || ok.status === 201, 'crowd report accepted');

  const read = await GET('/api/routes/7/crowd');
  assert.equal(read.status, 200);
});

// ---------- frontend serving (single-URL deploy) ----------

test('static frontend served at / with SPA fallback', async () => {
  const home = await GET('/');
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.ok(html.includes('<div id='), 'index.html served');
  const deep = await GET('/track/7');
  assert.equal(deep.status, 200, 'SPA fallback for deep routes');
  assert.ok((await deep.text()).includes('<div id='));
});

// ---------- WS: the two-second round trip ----------

test('ws: snapshot frame + location frame after ingest', async () => {
  const WebSocket = requireApi('ws');
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const frames = [];
  let done = false;
  await new Promise((resolve, reject) => {
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(() => reject(new Error('ws timeout — no frames in 8s')), 8000);
    ws.on('message', (raw) => {
      try { frames.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
      const hasSnapshot = frames.some((f) => f.type === 'snapshot');
      const hasLocation = frames.some((f) => f.type === 'location');
      if (hasSnapshot && hasLocation) { clearTimeout(timer); setTimeout(finish, 300); }
    });
    ws.on('open', () => {
      POST('/api/ingest/B-03', { lat: 31.543, lng: 74.374, speed: 30 })
        .then((r) => r.text().catch(() => {}))
        .catch(() => {});
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  ws.close();
  assert.ok(frames.some((f) => f.type === 'location' && f.bus_id === 'B-03'), 'location frame for the ingested bus');
});
