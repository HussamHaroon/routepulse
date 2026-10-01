# ROUTEPULSE — The timetable came alive

Live public-transport tracking for Lahore: search a route, watch every bus move along **real streets** on the map, get per-stop arrival **ETAs with a confidence rating**, arm a boarding alarm, and receive service alerts the moment operators publish them. Drivers stream phone GPS; operators run the network — delays, bunching, smog and all — from a dark control-room dashboard.

https://github.com/user-attachments/assets/26eeba20-6ba2-4cdb-8c36-ab0ff51c180b

*▶ Narrated demo — operator alert → passenger screen in <2s, live map, confidence-rated ETAs.*

![Live tracking](screenshots/live-tracking.png)

**Passenger (paper register, above)** · **Operator (night register)**

![Operator dashboard](screenshots/operator-dashboard.png)

## Try it live (60-second tour)

- **Product video:** the playable demo at the top of this README
- **Live deployment:** https://routepulse-production-50c8.up.railway.app (API + WebSocket + app on one URL)
- **Static demo (offline mock mode):** https://routepulse-pi.vercel.app
- **Operator key** (for driver start-trip / GPS ingest / crowd reports): `routepulse-demo-key`

1. Open [`/#/operator`](https://routepulse-production-50c8.up.railway.app/#/operator) — the night-shift control room: fleet KPIs, live map, bunching radar, delay rhythm, city conditions.
2. Open [`/#/track/3`](https://routepulse-production-50c8.up.railway.app/#/track/3) in a second window — buses glide along the real corridor; per-stop ETAs carry confidence ratings. **ARM** the boarding alarm on a stop that's 3–4 minutes out.
3. Back in the operator tab, publish a service alert → watch it land on the passenger screen in **under two seconds** over WebSocket.
4. Open [`/#/station/Data Darbar`](https://routepulse-production-50c8.up.railway.app/#/station/Data%20Darbar) — the flip-board departures for a stop, with a QR you'd print and post at the real bus stop.
5. Try [`/#/search`](https://routepulse-production-50c8.up.railway.app/#/search) — direct + transfer results over landmark route cards, fares in PKR, favourite routes ★.

## ✨ Novelty highlights

1. **Bunching radar.** Bus bunching — two buses on the same route pairing up and travelling as one — is the classic failure of real transit systems. The API scans the live fleet every few seconds, flags same-route pairs closer than 400 m, and issues the textbook fix: *"B-03 + B-16 · 20 m apart — hold B-16 at its next stop ~2 min to re-spread the line."*
2. **Time travel.** The server records a fleet snapshot every 10 s into a 2-hour ring buffer. The operator can replay the last hour on its own map at ~40× speed — watch delays bloom, buses wrap their loops, headways collapse and recover.
3. **Confidence-rated ETAs that grade themselves.** Every prediction carries a ± window and a `high / medium / low` grade from speed variance and position freshness — *"4 min ±1 · high"*, not a fake-precise number. The system also audits its own accuracy: *"80% of ETAs within 2 min, 442 samples."*
4. **The two-second round trip.** An operator publishes an alert in the control room; a WebSocket frame lands it on every passenger screen in under two seconds, with a visible radar ping on the map.
5. **Real roads, not straight lines.** Route geometry is snapped to actual Lahore streets via OSRM/OpenStreetMap — 3,800+ road points across 8 corridors, true drive distances (Route 1: 27.6 km). Buses follow real roads; ETAs use real distance along them.
6. **Smog-aware control room.** Live Lahore weather + air quality (Open-Meteo) with an operations verdict: *"AQI 169 · unhealthy — buses crawling on corridors."* Because in Lahore, the smog *is* the traffic report.
7. **Station departures board.** Every stop gets a flip-board page — `/#/station/Data Darbar` — with live departures per route and a **QR code you'd print and post at the actual bus stop**.
8. **Boarding alarm.** Pick your stop, hit **ARM** — at ETA ≤ 2 minutes the browser fires a real notification (and an optional spoken announcement). The app doesn't just show the bus; it tells you when to leave.
9. **Delay-rhythm analytics.** Completed-trip history is mined into human verdicts — *"chronic morning delays — budget +19 min around 07:00"* — so the timetable learns.
10. **One ingest, two GPS sources.** Phone GPS from the driver console and the fleet simulator POST to the same `/api/ingest/:bus_id` — swapping the sim for a real fleet is config, not a rewrite.
11. **Crowd reporting.** Passengers report `empty / seats / packed`; the level fans out over WebSocket and feeds route search.
12. **A living-timetable design system.** Paper register (passengers) vs night register (operators), Clash Display identity, landmark route cards, an installable PWA — and honest degradation everywhere: WS drops → polling; backend down → offline dataset with a badge. The demo never shows a blank screen.

## Demo (local)

- Local: `npm install` at root, then `npm run dev` → app on :5173, API + GPS simulator on :8787
- The app auto-detects the live feed; if the API is down it switches to an offline demo dataset and says so (badge in the header)

## What's simulated (honesty disclosure)

- Bus positions come from the built-in **GPS simulator** (`simulator/sim.js` + in-process loop) that moves buses along real route polylines — and from the **driver console** using the browser's real geolocation (`/driver` → Enable my GPS). Both feed the same endpoint.
- Road geometry comes from OpenStreetMap via the public OSRM demo service; weather and air quality are live observations from Open-Meteo.
- Seed data is synthetic (Lahore corridors, realistic names/fares). No real passenger data anywhere.

## Architecture

```
app/      Vite + React + Leaflet  ←── WebSocket /ws + REST /api ──→  api/  Express + better-sqlite3 + ws
simulator/ GPS source ──POST /api/ingest/:bus_id──→                                   │
localhost:8787 (single URL: Express serves app/dist + API + WS)            SQLite (auto-seeded)
```

- ETA engine: remaining distance along the road-snapped route polyline ÷ rolling average observed speed, adjusted by trip delay; confidence (high/medium/low) from sample count, speed variance and position freshness.
- Transfers: server-side search finds multi-route connections through shared stops.
- Live updates: WebSocket push with automatic polling fallback.

## Screens

| Route | Who | What |
|---|---|---|
| `/#/` | Everyone | The living timetable — video hero, route postcards, live stats |
| `/#/search` | Passenger | Route search with direct + transfer results over landmark cards, favourites ★, fares |
| `/#/track/:id` | Passenger | Live map on real streets, per-stop ETAs with confidence, boarding alarm, alerts |
| `/#/station/:stop` | Passenger | Flip-board departures for a stop + QR stop sign |
| `/#/driver` | Driver | Start trip, stream GPS, report delays, end trip |
| `/#/operator` | Operator | Fleet KPIs, live network map, bunching radar, time travel, city conditions, alerts |

## Credits

Media: [Pexels](https://www.pexels.com) (free license) · Basemaps © [CARTO](https://carto.com/basemaps), data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors · Road geometry: [OSRM](https://project-osrm.org) demo server · Weather & air quality: [Open-Meteo](https://open-meteo.com) · Fonts: Clash Display & Satoshi via Fontshare (ITF Free Font License), JetBrains Mono via Google Fonts (OFL) · Built at a hackathon in one day by Team Routepulse.
