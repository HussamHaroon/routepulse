// WP3 delay-rhythm — 14 days of synthetic Completed-trip history so the
// /api/analytics endpoints have a pattern to mine on first boot (and so the
// demo shows "route 5 is chronically late at 8 AM" without waiting 2 weeks).
//
// Idempotent: claimed once via a meta-table flag row inserted inside the same
// transaction as the rows, so a restart (or a second process racing the boot)
// can never duplicate history. Trip counts on a seeded DB stay stable.

import { db } from './db.js';

const HISTORY_DAYS = 14;
const TRIPS_PER_DAY = 4; // per route: 8 routes × 14 days × 4 ≈ 448 rows

// Chronic delay profiles — the "rhythm" the analytics endpoints surface.
// Route 5 runs 14–22 min late through the morning peak (07–10h);
// route 2 runs 8–12 min late through the evening peak (16–20h);
// every other slot/route is mild (0–6 min).
const PROFILES = {
  5: { from: 7, to: 10, min: 14, max: 22 },
  2: { from: 16, to: 20, min: 8, max: 12 },
};
const MILD = { min: 0, max: 6 };

// Base departure hours per route (UTC hour == the hour analytics reports).
// Route 5's first departure lands inside its morning window; route 2's
// last two land inside its evening window. All other routes get a
// phase-shifted spread so the network covers the whole 06–22 day.
const ROUTE_HOURS = {
  5: [8, 12, 16, 20],
  2: [7, 11, 16, 20],
};

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function delayFor(routeId, hour) {
  const p = PROFILES[Number(routeId)];
  if (p && hour >= p.from && hour <= p.to) return randInt(p.min, p.max);
  return randInt(MILD.min, MILD.max);
}

function baseHoursFor(routeId, index) {
  if (ROUTE_HOURS[Number(routeId)]) return ROUTE_HOURS[Number(routeId)];
  const phase = index % 4;
  return [0, 1, 2, 3].map((k) => 6 + ((k * 4 + phase) % 16));
}

// Residual ETA-prediction noise, modeling speed-estimation error on top of the
// reported delay (the live engine's ETA already includes delay_minutes).
// Mostly ±1 min, occasionally a 2–4 min miss.
function predNoise() {
  if (Math.random() < 0.12) return (Math.random() < 0.5 ? -1 : 1) * randInt(2, 4);
  return randInt(-1, 1);
}

/** Seed Completed-trip history + ETA samples. Runs once; no-op after that. */
export function seedHistory() {
  const routes = db.prepare('SELECT * FROM route ORDER BY CAST(route_id AS INTEGER)').all();
  if (!routes.length) return console.log('[history] no routes yet — skipping history seed');

  const buses = db.prepare('SELECT bus_id, driver_id FROM bus').all();
  const fallbackBus = buses[0] || { bus_id: 'B-07', driver_id: 'D-01' };

  const insMeta = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('history_seeded', ?)");
  const insTrip = db.prepare(
    "INSERT INTO trip (bus_id, driver_id, route_id, start_time, end_time, current_location, trip_status, delay_minutes) VALUES (?,?,?,?,?,NULL,'Completed',?)"
  );
  const insEta = db.prepare(
    'INSERT INTO eta_sample (trip_id, route_id, predicted_eta_min, actual_eta_min, measured_at) VALUES (?,?,?,?,?)'
  );

  const now = new Date();
  const rows = [];
  routes.forEach((r, ri) => {
    const hours = baseHoursFor(r.route_id, ri);
    const est = r.estimated_duration_min || 30;
    for (let d = HISTORY_DAYS; d >= 1; d--) {
      for (const h of hours) {
        const hour = clamp(h + randInt(-1, 1), 5, 22);
        const start = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d, hour, randInt(0, 59))
        );
        const delay = delayFor(r.route_id, hour);
        // Actual duration = schedule + delay + small run-to-run jitter.
        const durMin = Math.max(8, est + delay + randInt(-2, 2));
        const end = new Date(start.getTime() + durMin * 60000);
        const predicted = Math.max(5, est + delay + predNoise());
        const bus = buses[rows.length % Math.max(1, buses.length)] || fallbackBus;
        rows.push({ bus, route: r, start, end, delay, durMin, predicted });
      }
    }
  });

  const round1 = (x) => Math.round(x * 10) / 10;
  const seeded = db.transaction(() => {
    const claim = insMeta.run(String(rows.length));
    if (claim.changes === 0) return 0; // already seeded on a previous boot
    for (const t of rows) {
      const info = insTrip.run(
        t.bus.bus_id,
        t.bus.driver_id,
        t.route.route_id,
        t.start.toISOString(),
        t.end.toISOString(),
        t.delay
      );
      insEta.run(
        Number(info.lastInsertRowid),
        t.route.route_id,
        round1(t.predicted),
        round1(t.durMin),
        t.end.toISOString()
      );
    }
    return rows.length;
  })();

  if (seeded > 0) {
    console.log(
      `[history] seeded ${seeded} Completed trips + ETA samples (${HISTORY_DAYS} days × ${routes.length} routes) — delay rhythms: route 5 mornings +14–22, route 2 evenings +8–12`
    );
  }
}
