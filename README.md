# ROUTEPULSE — The timetable came alive

Live public-transport tracking for Lahore: search a route, watch every bus move on the map in real time, get per-stop arrival **ETAs with a confidence rating**, and receive service alerts the moment operators publish them. Drivers stream phone GPS; operators run the network from a dark control-room dashboard.

![Live tracking](screenshots/live-tracking.png)

**Passenger (paper register, above)** · **Operator (night register)**

![Operator dashboard](screenshots/operator-dashboard.png)

## Demo

- Local: `npm install` at root, then `npm run dev` → app on :5173, API + GPS simulator on :8787
- The app auto-detects the live feed; if the API is down it switches to an offline demo dataset and says so (badge in the header)

## What's simulated (honesty disclosure)

- Bus positions come from the built-in **GPS simulator** (`simulator/sim.js` + in-process loop) that moves buses along real route polylines — and from the **driver console** using the browser's real geolocation (`/driver` → Enable my GPS). Both feed the same endpoint.
- Seed data is synthetic (Lahore corridors, realistic names/fares). No real passenger data anywhere.

## Architecture

```
app/      Vite + React + Leaflet  ←── WebSocket /ws + REST /api ──→  api/  Express + better-sqlite3 + ws
simulator/ GPS source ──POST /api/ingest/:bus_id──→                                   │
localhost:8787 (single URL: Express serves app/dist + API + WS)            SQLite (auto-seeded)
```

- ETA engine: remaining distance along route polyline ÷ rolling average observed speed, adjusted by trip delay; **confidence** (high/medium/low) from sample count, speed variance and position freshness.
- Transfers: server-side search finds multi-route connections through shared stops.
- Live updates: WebSocket push with automatic polling fallback.

## Screens

| Route | Who | What |
|---|---|---|
| `/#/` | Everyone | The living timetable — stats, story, entry points |
| `/#/search` | Passenger | Route search with direct + transfer results, favourites ★, fares |
| `/#/track/:id` | Passenger | Live map, moving buses, per-stop ETAs with confidence, alerts |
| `/#/driver` | Driver | Start trip, stream GPS, report delays, end trip |
| `/#/operator` | Operator | Fleet KPIs, live map, alert publishing |

## Credits

Media: [Pexels](https://www.pexels.com) (free license) · Map tiles © Esri, data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors · Fonts: Zodiak/Satoshi via Fontshare, Sometype Mono via Google Fonts (OFL) · Built at a hackathon in one day by Team Routepulse.
