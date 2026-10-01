# Routepulse — Demo Day Runbook

Operational handbook for running, resetting, and rescuing Routepulse during the demo.
Keep this open in a second window on demo day.

## Cheat sheet

| Thing | Where |
|---|---|
| Passenger / Operator app | http://localhost:5173 |
| API | http://localhost:8787 |
| API health check | http://localhost:8787/api/health |
| WebSocket | ws://localhost:8787 (app falls back to polling if it fails) |
| Database file | `api/data.db` (auto-created + auto-seeded on API start) |
| One-command startup | `bash dev.sh` (starts api + app + simulator) |

## 0. Prerequisites (once)

- Node.js >= 20 (root `package.json` enforces this).
- Install dependencies:
  - Repo root: `npm install` — installs API + simulator deps (npm workspaces).
  - App: `cd app && npm install` — the app has its own lockfile.

## 1. Start everything (in this order)

**One command (recommended):**

```bash
bash dev.sh
```

Starts api → waits for health → starts app + simulator. `Ctrl+C` kills all three.

**Manual (3 terminals, same order):**

1. **API first** (everything depends on it):

   ```bash
   node api/server.js        # or: npm run api  (repo root)
   ```

   Wait until health is green: `curl http://localhost:8787/api/health`

2. **App:**

   ```bash
   cd app
   npm run dev               # Vite on http://localhost:5173
   ```

3. **Simulator last** (it needs the API up to accept GPS posts):

   ```bash
   node simulator/sim.js     # or: npm run sim  (repo root)
   ```

   Within ~2 seconds the buses start moving on the map.

## 2. Reseed the database

Seed data (routes, stops, buses, drivers, trips) is created automatically on API
startup when the DB file is missing.

1. Stop the API (Ctrl+C in its terminal).
2. Delete the DB: `rm api/data.db`
3. Restart the API (`node api/server.js`) — it auto-reseeds from scratch.

Note: reseeding wipes active trips, alerts, and location history. The simulator
recreates live movement within a few seconds of restarting.

## 3. Roll back a bad commit

```bash
git log --oneline -10          # find the bad commit
git revert <sha>               # safe: adds an "undo" commit, never force-pushes
git push                       # redeploys the reverted state (if a deploy exists)
```

Never `git reset --hard` or force-push `main` — it is shared during the event.
If a revert touches dependencies, run `npm install` (root and `app/`) and restart
everything per section 1.

## 4. Rotate a leaked key

If an API key (Unsplash/Pexels/GitHub token) leaks — committed, pasted, screen-shared:

1. **Revoke immediately** on the provider dashboard (GitHub: Settings → Developer
   settings → Tokens → delete; Unsplash/Pexels: account → API/keys → revoke).
2. **Issue a new key** on the same dashboard.
3. **Update `.env`** (it is git-ignored — never put real keys in `.env.example`).
4. **Restart the API** so it picks up the new value.
5. If the key ever landed in git history, treat it as burned: keep it revoked,
   rotate every credential in that file, and tell the orchestrator before any
   history rewriting (do not rewrite shared `main` solo).

## 5. Where the logs are

- **Manual startup:** each process logs to its own terminal — that is the log.
- **`dev.sh` startup:** logs go to
  - `/tmp/routepulse-api.log`
  - `/tmp/routepulse-app.log`
  - `/tmp/routepulse-sim.log`

  Tail one: `tail -f /tmp/routepulse-api.log` (dev.sh prints the last 30 lines
  of the API log if the API fails to start).

## 6. Demo fallback ladder

Run demos from the highest rung that works; drop one rung only after verifying
the one below is broken.

1. **Live deployed URL** — before relying on it, verify: health endpoint returns
   200, the map shows tiles, and a bus visibly moves within ~5 seconds.
2. **Local one-command** — `bash dev.sh` — before relying on it, verify: all
   three processes are up (health OK, Vite URL loads, bus moves).
3. **Recorded video** — last resort; record it once P0 feature-freeze happens
   (do not wait for demo day). Verify: video plays fullscreen with audio.

Rule of the ladder: confirm the fallback itself works *before* the demo starts,
never during it.

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `EADDRINUSE ... :8787` (port already in use) | A previous API instance is still running | Find and kill it: `netstat -ano | findstr :8787` then `taskkill /PID <pid> /F` (Windows) or `lsof -i :8787` then `kill <pid>` (macOS/Linux). Then restart. |
| Map tiles not loading (grey map) | No internet / OpenStreetMap tile CDN unreachable | Check connectivity; tiles are fetched from OSM servers and cannot run offline. App logic still works — retry once online. |
| Bus not moving on the map | Simulator not running (or crashed) | Check the simulator terminal / `/tmp/routepulse-sim.log`; restart `node simulator/sim.js`. |
| `ws failed` / WebSocket errors in app console | WS dropped (API restart, network hiccup) | Cosmetic — the app automatically falls back to polling. Keep demoing; restart the API only if data stops refreshing. |
| Health check fails / connection refused on 8787 | API not started yet or crashed on boot | Start the API first (order matters); check its log tail for the stack trace. |
| Weird trips / stale data on screen | Old database state | Reseed: section 2 (stop API → `rm api/data.db` → restart). |
| `npm install` fails on `better-sqlite3` | Node version lacks a prebuilt binary | Use Node 20 LTS, delete `node_modules`, run `npm install` at root again. |
| App served on :5174 instead of :5173 | 5173 was already occupied, Vite hopped ports | Free 5173 (see port row above) and restart the app. |
