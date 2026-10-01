#!/usr/bin/env node
// Routepulse GPS simulator.
// Moves every "On Route"/"Delayed" bus along its route polyline at ~28 km/h
// (configurable) and POSTs each new position to the API every 2 seconds.
//
// Flags:
//   --speed=<kmh>   base cruise speed, default 28
//   --bus=<id>      simulate only this bus (comma-separated list allowed)
//   --interval=<ms> tick interval, default 2000
// Env:
//   ROUTES_API=http://localhost:8787

import {
  buildPolyline,
  projectOntoPolyline,
  pointAtDistance,
} from '../api/geo.js';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const argMap = new Map();
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) argMap.set(m[1], m[2] ?? true);
}
const BASE_SPEED = Number(argMap.get('speed')) || 28;
const INTERVAL = Number(argMap.get('interval')) || 2000;
const BUS_FILTER =
  typeof argMap.get('bus') === 'string'
    ? argMap.get('bus').split(',').map((s) => s.trim()).filter(Boolean)
    : null;
const API = (process.env.ROUTES_API || 'http://localhost:8787').replace(/\/$/, '');

const fmtKmh = (v) => v.toFixed(1).padStart(5);

// ---------------------------------------------------------------------------
// HTTP helpers (global fetch, Node >= 18)
// ---------------------------------------------------------------------------
async function api(path, opts) {
  const res = await fetch(`${API}${path}`, opts);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function waitForApi() {
  for (;;) {
    try {
      const { status, body } = await api('/api/health');
      if (status === 200 && body?.ok) return;
    } catch {
      /* not up yet */
    }
    console.log(`[sim] waiting for API at ${API} ...`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------
const buses = new Map(); // bus_id -> { routeId, poly, distAlong, factor, ended }
let frameLines = 0;

async function loadFleet() {
  const { status, body } = await api('/api/locations');
  if (status !== 200) throw new Error(`GET /api/locations → ${status}`);
  const list = body.locations || [];
  const filtered = BUS_FILTER ? list.filter((l) => BUS_FILTER.includes(l.bus_id)) : list;

  for (const loc of filtered) {
    if (buses.has(loc.bus_id)) continue;
    const r = await api(`/api/routes/${loc.route_id}`);
    if (r.status !== 200) continue;
    const stops = r.body.stops.map((s) => ({ lat: s.lat, lng: s.lng, name: s.stop_name }));
    const poly = buildPolyline(stops);
    const proj = projectOntoPolyline(loc.lat, loc.lng, poly);
    buses.set(loc.bus_id, {
      routeId: loc.route_id,
      stops,
      poly,
      distAlong: proj.distAlong,
      factor: 1, // per-bus speed random-walk factor (0.8 .. 1.2)
      ended: false,
      lastErr: null,
    });
    console.log(
      `[sim] tracking ${loc.bus_id} on route ${loc.route_id} (${stops.length} stops, ` +
        `${poly.total.toFixed(2)} km) — joined at ${proj.distAlong.toFixed(2)} km`
    );
  }
  if (BUS_FILTER) {
    for (const id of BUS_FILTER) {
      if (!filtered.some((l) => l.bus_id === id)) {
        console.log(`[sim] bus ${id} has no active trip on the server — skipped`);
      }
    }
  }
  return filtered.length;
}

async function tick() {
  const dtH = INTERVAL / 3600000;
  const jobs = [];
  for (const [busId, b] of buses) {
    if (b.ended) continue;

    // Smooth-ish random walk around base speed (city traffic feel)
    b.factor = Math.min(1.2, Math.max(0.8, b.factor + (Math.random() - 0.5) * 0.12));
    const kmh = BASE_SPEED * b.factor;
    b.distAlong += kmh * dtH;
    if (b.distAlong >= b.poly.total) b.distAlong = 0; // loop the service back to the start

    const p = pointAtDistance(b.poly, b.distAlong);
    jobs.push(
      api(`/api/ingest/${encodeURIComponent(busId)}`, {
        method: 'POST',
        // Non-GET /api calls require the operator key (see api/server.js F-01).
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.OPERATOR_KEY || 'routepulse-demo-key',
        },
        body: JSON.stringify({ lat: p.lat, lng: p.lng, speed: kmh }),
      })
        .then(({ status, body }) => {
          if (status === 409) {
            b.ended = true;
            console.log(`[sim] ${busId}: trip ended server-side — dropped from simulation`);
          } else if (status !== 200) {
            b.lastErr = body?.error || `HTTP ${status}`;
          } else {
            b.lastErr = null;
          }
        })
        .catch((e) => {
          b.lastErr = e.message;
        })
    );
  }
  await Promise.all(jobs);
}

function nextStopOf(b) {
  for (let i = 0; i < b.stops.length; i++) {
    if (b.poly.cum[i] > b.distAlong + 0.02) return b.stops[i].name;
  }
  return b.stops[b.stops.length - 1].name;
}

function render() {
  const active = [...buses.entries()].filter(([, b]) => !b.ended);
  const lines = [];
  lines.push(
    `\x1b[36m[sim]\x1b[0m ${active.length} bus(es) · base ${BASE_SPEED} km/h · ` +
      `tick ${INTERVAL} ms · ${new Date().toLocaleTimeString()}   `
  );
  if (!active.length) {
    lines.push('[sim] no active trips — start one: POST /api/trips/start {"bus_id":"B-21","driver_id":"D-05","route_id":"5"}');
  }
  for (const [busId, b] of active) {
    const pct = Math.min(1, b.distAlong / b.poly.total);
    const filled = Math.round(pct * 18);
    const bar = '█'.repeat(filled) + '░'.repeat(18 - filled);
    const err = b.lastErr ? ` \x1b[31m⚠ ${b.lastErr}\x1b[0m` : '';
    lines.push(
      `${busId.padEnd(5)} R${String(b.routeId).padEnd(3)} ${bar} ${(pct * 100).toFixed(0).padStart(3)}%` +
        `  ${fmtKmh(BASE_SPEED * b.factor)} km/h  next: ${nextStopOf(b).padEnd(18)}${err}   `
    );
  }
  if (frameLines) process.stdout.write(`\x1b[${frameLines}A`); // cursor up to redraw
  process.stdout.write(lines.map((l) => `\x1b[2K${l}`).join('\n') + '\n');
  frameLines = lines.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`\x1b[36m
  ┌─┐┌─┐┌─┐
  │R││O││U│  ROUTEPULSE GPS SIMULATOR  (simulated GPS — demo discloses this)
  └─┘└─┘└─┘\x1b[0m`);

await waitForApi();
let n = 0;
for (let i = 0; i < 3 && n === 0; i++) n = await loadFleet();
if (n === 0) console.log('[sim] no live buses yet — will keep checking each tick');
render();
setInterval(async () => {
  try {
    if ([...buses.values()].filter((b) => !b.ended).length === 0) await loadFleet();
  } catch {
    /* api briefly down */
  }
  await tick();
  render();
}, INTERVAL);

process.on('SIGINT', () => {
  process.stdout.write('\n[sim] stopped\n');
  process.exit(0);
});
