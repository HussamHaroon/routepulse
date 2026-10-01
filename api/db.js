// Routepulse database — better-sqlite3, DDL + idempotent seed on first run.
// DB file: api/data.db (gitignored; recreated automatically).

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const db = new Database(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS bus (
  bus_id        TEXT PRIMARY KEY,
  bus_number    TEXT,
  vehicle_number TEXT,
  capacity      INTEGER,
  driver_id     TEXT,
  route_id      TEXT,
  status        TEXT
);
CREATE TABLE IF NOT EXISTS driver (
  driver_id     TEXT PRIMARY KEY,
  name          TEXT,
  phone         TEXT,
  assigned_bus  TEXT,
  current_trip  TEXT,
  status        TEXT
);
CREATE TABLE IF NOT EXISTS route (
  route_id      TEXT PRIMARY KEY,
  route_name    TEXT,
  start_location TEXT,
  destination   TEXT,
  estimated_duration_min INTEGER,
  active_status INTEGER,
  fare_pkr      INTEGER
);
CREATE TABLE IF NOT EXISTS stop (
  stop_id       TEXT PRIMARY KEY,
  route_id      TEXT,
  stop_name     TEXT,
  lat           REAL,
  lng           REAL,
  stop_order    INTEGER
);
CREATE TABLE IF NOT EXISTS trip (
  trip_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  bus_id        TEXT,
  driver_id     TEXT,
  route_id      TEXT,
  start_time    TEXT,
  end_time      TEXT,
  current_location TEXT,
  trip_status   TEXT,
  delay_minutes INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS alert (
  alert_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id      TEXT,
  message       TEXT,
  created_at    TEXT,
  active        INTEGER DEFAULT 1
);
`);

// Migration for DBs created before WP2: add fare_pkr to route if missing.
{
  const cols = db.prepare('PRAGMA table_info(route)').all().map((c) => c.name);
  if (!cols.includes('fare_pkr')) {
    db.exec('ALTER TABLE route ADD COLUMN fare_pkr INTEGER');
    console.log('[db] migrated route table: + fare_pkr');
  }
}

const ROUTES = [
  // [route] stops: [name, lat, lng] — Lahore coords (31.52–31.58 / 74.29–74.40)
  {
    route_id: '7',
    route_name: 'City Center → University Gate',
    start_location: 'City Center',
    destination: 'University Gate',
    estimated_duration_min: 35,
    fare_pkr: 25,
    stops: [
      ['City Center', 31.5582, 74.3507],
      ['Shimla Pahar', 31.562, 74.342],
      ['Railway Station', 31.5703, 74.333],
      ['Civil Area', 31.568, 74.322],
      ['Data Nagar', 31.565, 74.314],
      ['University Gate', 31.5645, 74.3075],
    ],
  },
  {
    route_id: '5',
    route_name: 'Central Station → Bus Terminal',
    start_location: 'Central Station',
    destination: 'Bus Terminal',
    estimated_duration_min: 42,
    fare_pkr: 40,
    stops: [
      ['Central Station', 31.572, 74.352],
      ['Lakshmi Chowk', 31.565, 74.344],
      ['Main Market', 31.556, 74.34],
      ['Civil Lines', 31.548, 74.332],
      ['Model Town Link', 31.538, 74.326],
      ['Bus Terminal', 31.529, 74.318],
    ],
  },
  {
    route_id: '3',
    route_name: 'Airport → City Center',
    start_location: 'Airport',
    destination: 'City Center',
    estimated_duration_min: 48,
    fare_pkr: 50,
    stops: [
      ['Airport', 31.521, 74.403],
      ['Cohsala', 31.532, 74.387],
      ['Ghazi Road', 31.543, 74.374],
      ['Peco Mor', 31.551, 74.363],
      ['Islampura', 31.556, 74.356],
      ['City Center', 31.5582, 74.3507],
    ],
  },
  {
    route_id: '9',
    route_name: 'City Center → University Gate Express',
    start_location: 'City Center',
    destination: 'University Gate',
    estimated_duration_min: 30,
    fare_pkr: 35,
    stops: [
      ['City Center', 31.5582, 74.3507],
      ['Canal Bank', 31.554, 74.338],
      ['Chauburji', 31.546, 74.318],
      ['Multan Chungi', 31.552, 74.312],
      ['Campus Gate', 31.559, 74.309],
      ['University Gate', 31.5645, 74.3075],
    ],
  },
  // --- WP2 additions: 4 new routes (~40 stops network-wide) ---
  {
    route_id: '1',
    route_name: 'Airport → Bus Terminal',
    start_location: 'Airport',
    destination: 'Bus Terminal',
    estimated_duration_min: 58,
    fare_pkr: 60,
    stops: [
      ['Airport', 31.521, 74.403],
      ['Cohsala', 31.532, 74.387],
      ['Ghazi Road', 31.543, 74.374],
      ['Kot Lakhpat', 31.535, 74.346],
      ['Model Town', 31.53, 74.329],
      ['Bus Terminal', 31.529, 74.318],
    ],
  },
  {
    route_id: '2',
    route_name: 'Railway Station → Main Market',
    start_location: 'Railway Station',
    destination: 'Main Market',
    estimated_duration_min: 25,
    fare_pkr: 20,
    stops: [
      ['Railway Station', 31.5703, 74.333],
      ['Bhatti Chowk', 31.568, 74.338],
      ['Lakshmi Chowk', 31.565, 74.344],
      ['Nila Gumbad', 31.56, 74.342],
      ['Main Market', 31.556, 74.34],
    ],
  },
  {
    route_id: '6',
    route_name: 'Canal → City Center',
    start_location: 'Thokar Niaz Baig',
    destination: 'City Center',
    estimated_duration_min: 38,
    fare_pkr: 30,
    stops: [
      ['Thokar Niaz Baig', 31.533, 74.312],
      ['Canal Side', 31.544, 74.325],
      ['Canal Bank', 31.554, 74.338],
      ['Shadman', 31.559, 74.345],
      ['City Center', 31.5582, 74.3507],
    ],
  },
  {
    route_id: '12',
    route_name: 'University Gate → Main Market',
    start_location: 'University Gate',
    destination: 'Main Market',
    estimated_duration_min: 36,
    fare_pkr: 30,
    stops: [
      ['University Gate', 31.5645, 74.3075],
      ['Campus Gate', 31.559, 74.309],
      ['Muslim Town', 31.553, 74.317],
      ['Civil Lines', 31.548, 74.332],
      ['Main Market', 31.556, 74.34],
    ],
  },
];

const BUSES = [
  // [bus_id, vehicle_number, capacity, driver_id, route_id, status]
  ['B-07', 'LEA-3147', 42, 'D-01', '7', 'On Route'],
  ['B-14', 'LEB-8852', 42, 'D-02', '5', 'Delayed'],
  ['B-03', 'LEC-2043', 36, 'D-03', '3', 'On Route'],
  ['B-09', 'LED-7719', 36, 'D-04', '9', 'On Route'],
  ['B-21', 'LEE-5561', 42, null, null, 'Available'],
  ['B-32', 'LEF-9330', 42, null, null, 'Break'],
];

const DRIVERS = [
  // [driver_id, name, phone, assigned_bus, status]
  ['D-01', 'Farhan', '+92-300-1234567', 'B-07', 'On Route'],
  ['D-02', 'Muneeb', '+92-301-2345678', 'B-14', 'On Route'],
  ['D-03', 'Prithvi', '+92-302-3456789', 'B-03', 'On Route'],
  ['D-04', 'Aslam', '+92-303-4567890', 'B-09', 'On Route'],
  ['D-05', 'Zafar', '+92-304-5678901', null, 'Available'],
];

/** Routes/stops seed — idempotent (INSERT OR IGNORE), so existing DBs grow into
 *  the new network without wiping trips/alerts. Fares are refreshed each boot. */
function seedRoutesAndStops() {
  const insRoute = db.prepare(
    'INSERT OR IGNORE INTO route (route_id, route_name, start_location, destination, estimated_duration_min, active_status, fare_pkr) VALUES (?,?,?,?,?,1,?)'
  );
  const insStop = db.prepare(
    'INSERT OR IGNORE INTO stop (stop_id, route_id, stop_name, lat, lng, stop_order) VALUES (?,?,?,?,?,?)'
  );
  const updFare = db.prepare('UPDATE route SET fare_pkr = ? WHERE route_id = ?');
  const tx = db.transaction(() => {
    let stopsAdded = 0;
    for (const r of ROUTES) {
      insRoute.run(r.route_id, r.route_name, r.start_location, r.destination, r.estimated_duration_min, r.fare_pkr);
      updFare.run(r.fare_pkr, r.route_id);
      r.stops.forEach(([name, lat, lng], i) => {
        const info = insStop.run(`${r.route_id}_s${i + 1}`, r.route_id, name, lat, lng, i + 1);
        stopsAdded += info.changes;
      });
    }
    return stopsAdded;
  });
  const added = tx();
  const nRoutes = db.prepare('SELECT COUNT(*) AS n FROM route').get().n;
  const nStops = db.prepare('SELECT COUNT(*) AS n FROM stop').get().n;
  if (added > 0) console.log(`[db] route seed: +${added} stops → now ${nRoutes} routes, ${nStops} route-stops`);
}

function seedFleetOnce() {
  const hasFleet = db.prepare('SELECT COUNT(*) AS n FROM bus').get().n > 0;
  if (hasFleet) return;

  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();

  const seed = db.transaction(() => {
    const insBus = db.prepare(
      'INSERT INTO bus (bus_id, bus_number, vehicle_number, capacity, driver_id, route_id, status) VALUES (?,?,?,?,?,?,?)'
    );
    for (const [id, veh, cap, drv, route, status] of BUSES) {
      insBus.run(id, id, veh, cap, drv, route, status);
    }

    const insDriver = db.prepare(
      'INSERT INTO driver (driver_id, name, phone, assigned_bus, current_trip, status) VALUES (?,?,?,?,NULL,?)'
    );
    for (const [id, name, phone, bus, status] of DRIVERS) {
      insDriver.run(id, name, phone, bus, status);
    }

    const insAlert = db.prepare(
      'INSERT INTO alert (route_id, message, created_at, active) VALUES (?,?,?,?)'
    );
    // Matches the frontend mock. Route 5 is actively delayed; "Bus 14 ended
    // trip" is historical (active=0).
    insAlert.run('5', 'Route 5 delayed ~15 min — accident near Main Market', iso(25 * 60 * 1000), 1);
    insAlert.run(null, 'Stop 7 temporarily unavailable — road closure', iso(40 * 60 * 1000), 1);
    insAlert.run(null, 'Bus 14 ended trip — vehicle issue', iso(90 * 60 * 1000), 0);
  });
  seed();
  console.log('[db] seeded fleet: 6 buses, 5 drivers, 3 alerts');
}

/** Create the 4 initial "On Route" trips (once) so the simulator has work. */
export function seedInitialTrips() {
  const hasTrips = db.prepare('SELECT COUNT(*) AS n FROM trip').get().n > 0;
  if (hasTrips) return;

  const buses = db
    .prepare("SELECT bus_id, driver_id, route_id, status FROM bus WHERE status IN ('On Route','Delayed')")
    .all();
  const firstStop = db.prepare(
    'SELECT lat, lng FROM stop WHERE route_id = ? ORDER BY stop_order LIMIT 1'
  );
  const insTrip = db.prepare(
    "INSERT INTO trip (bus_id, driver_id, route_id, start_time, current_location, trip_status, delay_minutes) VALUES (?,?,?,?,?,'On Route',0)"
  );
  const insDelayedTrip = db.prepare(
    "INSERT INTO trip (bus_id, driver_id, route_id, start_time, current_location, trip_status, delay_minutes) VALUES (?,?,?,?,?,'Delayed',?)"
  );
  const updDriver = db.prepare('UPDATE driver SET current_trip = ?, status = ? WHERE driver_id = ?');

  const now = new Date().toISOString();
  const created = [];
  const tx = db.transaction(() => {
    for (const b of buses) {
      const s = firstStop.get(b.route_id) || { lat: 31.5582, lng: 74.3507 };
      const loc = `${s.lat},${s.lng}`;
      let tripId;
      if (b.status === 'Delayed') {
        // B-14 matches the seeded "Route 5 delayed ~15 min" alert.
        tripId = insDelayedTrip.run(b.bus_id, b.driver_id, b.route_id, now, loc, 15).lastInsertRowid;
      } else {
        tripId = insTrip.run(b.bus_id, b.driver_id, b.route_id, now, loc).lastInsertRowid;
      }
      if (b.driver_id) updDriver.run(String(tripId), 'On Route', b.driver_id);
      created.push({ trip_id: Number(tripId), bus_id: b.bus_id });
    }
  });
  tx();
  if (created.length) console.log(`[db] seeded ${created.length} active trips`);
}

seedRoutesAndStops();
seedFleetOnce();
seedInitialTrips();
