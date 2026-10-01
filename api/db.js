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

// REAL Lahore landmarks (approx public coords, good enough for map display)
const LANDMARKS = {
  'Data Darbar': [31.5869, 74.3095],
  'Minar-e-Pakistan': [31.5928, 74.3079],
  'Azadi Chowk': [31.6186, 74.3123],
  'Bhati Chowk': [31.5854, 74.3190],
  'Badami Bagh': [31.5990, 74.3180],
  'Railway Station': [31.5703, 74.3330],
  'Lakshmi Chowk': [31.5620, 74.3360],
  'Charing Cross': [31.5590, 74.3250],
  'Chauburji': [31.5480, 74.3230],
  'Kalma Chowk': [31.5255, 74.3436],
  'Model Town': [31.5140, 74.3330],
  'Liberty Market': [31.5330, 74.3380],
  'Gulberg Main Blvd': [31.5340, 74.3460],
  'Lahore Cantt': [31.5460, 74.3520],
  'Allama Iqbal Airport': [31.5210, 74.4036],
  'Thokar Niaz Baig': [31.5160, 74.2970],
  'Punjab University Gate': [31.5650, 74.3070],
  'Peco Mor': [31.5490, 74.3650],
  'Ghazi Road': [31.5430, 74.3820],
};

// Stop-order helpers — build a route from landmark names in corridor order.
const L = (name) => {
  const lm = LANDMARKS[name];
  if (!lm) throw new Error(`[db] unknown landmark: ${name}`);
  return [name, lm[0], lm[1]];
};

const ROUTES = [
  {
    route_id: '1',
    route_name: 'Shahdara → Kalma Chowk',
    start_location: 'Minar-e-Pakistan',
    destination: 'Kalma Chowk',
    estimated_duration_min: 55,
    fare_pkr: 40,
    stops: [
      L('Minar-e-Pakistan'),
      L('Azadi Chowk'),
      L('Bhati Chowk'),
      L('Data Darbar'),
      L('Lakshmi Chowk'),
      L('Chauburji'),
      L('Kalma Chowk'),
    ],
  },
  {
    route_id: '2',
    route_name: 'Airport → City Center',
    start_location: 'Allama Iqbal Airport',
    destination: 'Bhati Chowk',
    estimated_duration_min: 48,
    fare_pkr: 50,
    stops: [
      L('Allama Iqbal Airport'),
      L('Ghazi Road'),
      L('Peco Mor'),
      L('Lahore Cantt'),
      L('Lakshmi Chowk'),
      L('Bhati Chowk'),
    ],
  },
  {
    route_id: '3',
    route_name: 'Railway Station → Liberty Market',
    start_location: 'Railway Station',
    destination: 'Liberty Market',
    estimated_duration_min: 42,
    fare_pkr: 35,
    stops: [
      L('Railway Station'),
      L('Data Darbar'),
      L('Charing Cross'),
      L('Gulberg Main Blvd'),
      L('Liberty Market'),
    ],
  },
  {
    route_id: '4',
    route_name: 'University Gate → Model Town',
    start_location: 'Punjab University Gate',
    destination: 'Model Town',
    estimated_duration_min: 28,
    fare_pkr: 25,
    stops: [
      L('Punjab University Gate'),
      L('Chauburji'),
      L('Kalma Chowk'),
      L('Model Town'),
    ],
  },
  {
    route_id: '5',
    route_name: 'Airport → Badami Bagh',
    start_location: 'Allama Iqbal Airport',
    destination: 'Badami Bagh',
    estimated_duration_min: 45,
    fare_pkr: 45,
    stops: [
      L('Allama Iqbal Airport'),
      L('Ghazi Road'),
      L('Lahore Cantt'),
      L('Lakshmi Chowk'),
      L('Badami Bagh'),
    ],
  },
  {
    route_id: '6',
    route_name: 'Thokar Niaz Baig → City Center',
    start_location: 'Thokar Niaz Baig',
    destination: 'Bhati Chowk',
    estimated_duration_min: 52,
    fare_pkr: 40,
    stops: [
      L('Thokar Niaz Baig'),
      L('Model Town'),
      L('Kalma Chowk'),
      L('Chauburji'),
      L('Lakshmi Chowk'),
      L('Bhati Chowk'),
    ],
  },
  {
    route_id: '7',
    route_name: 'Bhati Chowk → Punjab University Gate',
    start_location: 'Bhati Chowk',
    destination: 'Punjab University Gate',
    estimated_duration_min: 30,
    fare_pkr: 20,
    stops: [
      L('Bhati Chowk'),
      L('Data Darbar'),
      L('Charing Cross'),
      L('Punjab University Gate'),
    ],
  },
  {
    route_id: '8',
    route_name: 'Railway Station → Liberty Market Express',
    start_location: 'Railway Station',
    destination: 'Liberty Market',
    estimated_duration_min: 32,
    fare_pkr: 60,
    stops: [
      L('Railway Station'),
      L('Lakshmi Chowk'),
      L('Gulberg Main Blvd'),
      L('Liberty Market'),
    ],
  },
];

const BUSES = [
  // [bus_id, vehicle_number, capacity, driver_id, route_id, status]
  ['B-07', 'LEA-3147', 42, 'D-01', '1', 'On Route'],
  ['B-14', 'LEB-8852', 42, 'D-02', '3', 'Delayed'],
  ['B-03', 'LEC-2043', 36, 'D-03', '2', 'On Route'],
  ['B-09', 'LED-7719', 36, 'D-04', '7', 'On Route'],
  ['B-21', 'LEE-5561', 42, 'D-05', '6', 'On Route'],
  ['B-32', 'LEF-9330', 42, 'D-06', '8', 'On Route'],
  ['B-05', 'LEG-2274', 36, 'D-07', '4', 'On Route'],
  ['B-11', 'LEH-6602', 36, null, null, 'Available'],
];

const DRIVERS = [
  // [driver_id, name, phone, assigned_bus, status]
  ['D-01', 'Farhan', '+92-300-1234567', 'B-07', 'On Route'],
  ['D-02', 'Muneeb', '+92-301-2345678', 'B-14', 'On Route'],
  ['D-03', 'Prithvi', '+92-302-3456789', 'B-03', 'On Route'],
  ['D-04', 'Aslam', '+92-303-4567890', 'B-09', 'On Route'],
  ['D-05', 'Zafar', '+92-304-5678901', 'B-21', 'On Route'],
  ['D-06', 'Rizwan', '+92-305-6789012', 'B-32', 'On Route'],
  ['D-07', 'Naveed', '+92-306-7890123', 'B-05', 'On Route'],
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
    // Realistic Lahore service alerts. Route 3 (B-14) is actively delayed;
    // "ended trip" is historical (active=0).
    insAlert.run('3', 'Route 3 delayed ~15 min — traffic jam on Ferozepur Road near Charing Cross', iso(25 * 60 * 1000), 1);
    insAlert.run(null, 'Bhati Chowk stop temporarily shifted 100 m — road maintenance', iso(40 * 60 * 1000), 1);
    insAlert.run('1', 'Route 1 diversion via Lakshmi Chowk due to procession near Data Darbar', iso(90 * 60 * 1000), 1);
    insAlert.run(null, 'Bus 14 ended trip — vehicle issue', iso(200 * 60 * 1000), 0);
  });
  seed();
  console.log('[db] seeded fleet: 8 buses, 7 drivers, 4 alerts');
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
