// WP3 delay-rhythm verification — one command:
//   node _wp3_verify.mjs
// Boots the API twice (SIMULATE=0, port 8791) against the real api/data.db:
//   boot 1: seeds history (first time) → prints the three /api/analytics payloads
//   boot 2: asserts seeding was idempotent (identical patterns, same counts)
// Exit 0 = pass. Safe to re-run any time.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8791;
const BASE = `http://localhost:${PORT}/api`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const child = spawn(process.execPath, ['api/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), SIMULATE: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`  [api] ${d}`.replace(/\n/g, '\n  ')));
  child.stderr.on('data', (d) => process.stderr.write(`  [api!] ${d}`));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return child;
    } catch {}
    await sleep(500);
  }
  child.kill();
  throw new Error('server did not become healthy in 30s');
}

const stop = (child) =>
  new Promise((resolve) => {
    child.on('exit', resolve);
    child.kill();
    setTimeout(resolve, 3000).unref?.();
  });

const get = async (p) => (await fetch(`${BASE}${p}`)).json();

function summarize(patterns) {
  for (const p of patterns) {
    const worst = p.by_hour.find((h) => h.hour === p.worst_hour);
    console.log(
      `  route ${String(p.route_id).padStart(2)}  worst ${String(p.worst_hour).padStart(2)}:00  +${String(p.worst_avg_delay_min).padStart(5)} min  (samples ${worst?.samples})  | ${p.verdict}`
    );
  }
}

let failed = false;
try {
  // ---- boot 1 -------------------------------------------------------------
  console.log('\n=== BOOT 1 ===');
  let srv = await startServer();
  const patterns1 = (await get('/analytics/delay-patterns')).patterns;
  const summary1 = await get('/analytics/summary');
  const accuracy1 = await get('/analytics/eta-accuracy');
  console.log('\n-- GET /api/analytics/delay-patterns (per-route worst hour) --');
  summarize(patterns1);
  console.log('\n-- GET /api/analytics/summary --');
  console.log('  ' + JSON.stringify(summary1));
  console.log('\n-- GET /api/analytics/eta-accuracy --');
  console.log('  ' + JSON.stringify(accuracy1));
  await stop(srv);

  // ---- boot 2: idempotency ------------------------------------------------
  console.log('\n=== BOOT 2 (restart — must NOT re-seed) ===');
  srv = await startServer();
  const patterns2 = (await get('/analytics/delay-patterns')).patterns;
  const summary2 = await get('/analytics/summary');
  const accuracy2 = await get('/analytics/eta-accuracy');
  await stop(srv);

  const same = JSON.stringify(patterns1) === JSON.stringify(patterns2);
  console.log(`\n  delay-patterns identical across restart: ${same ? 'YES (idempotent)' : 'NO — DUPLICATED!'}`);
  console.log(`  summary identical: ${JSON.stringify(summary1) === JSON.stringify(summary2) ? 'YES' : 'NO'}`);
  console.log(`  eta-accuracy identical: ${JSON.stringify(accuracy1) === JSON.stringify(accuracy2) ? 'YES' : 'NO'}`);
  if (!same) failed = true;

  // pattern sanity: chronic routes must stand out from the mild ones
  const byRoute = Object.fromEntries(patterns1.map((p) => [p.route_id, p.worst_avg_delay_min]));
  const worst5 = byRoute['5'];
  const worst2 = byRoute['2'];
  const mildMax = Math.max(...Object.entries(byRoute).filter(([id]) => id !== '5' && id !== '2').map(([, v]) => v));
  console.log(`\n  route 5 worst-hour avg ${worst5} min (expect ≥ 12, morning profile)`);
  console.log(`  route 2 worst-hour avg ${worst2} min (expect ≥ 6, evening profile)`);
  console.log(`  mildest other route max ${mildMax} min (expect < 7)`);
  if (!(worst5 >= 12 && worst5 <= 24) || !(worst2 >= 6 && worst2 <= 14) || mildMax >= 7) failed = true;

  // absolute row counts straight from SQLite
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(path.join(root, 'api', 'data.db'), { readonly: true });
    const n = (q) => db.prepare(q).get().n;
    console.log('\n-- row counts --');
    console.log(`  trips Completed: ${n("SELECT COUNT(*) n FROM trip WHERE trip_status='Completed'")}`);
    console.log(`  eta_sample rows: ${n('SELECT COUNT(*) n FROM eta_sample')}`);
    console.log(`  meta: ${JSON.stringify(db.prepare('SELECT * FROM meta').all())}`);
    db.close();
  } catch (e) {
    console.log(`  (skipped direct sqlite counts: ${e.message})`);
  }

  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
} catch (e) {
  console.error('VERIFY ERROR:', e);
  failed = true;
}
process.exit(failed ? 1 : 0);
