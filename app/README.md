# Routepulse — frontend

Live public-transport tracking UI: passenger route search, real-time bus map,
per-stop ETAs with confidence, driver trip console, operator dashboard.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
```

## Modes

- **DEMO DATA ON (default):** the app runs fully from `src/mock.js` — seed data +
  a client-side bus simulator — no backend needed.
- **DEMO DATA OFF:** talks to the real API. Vite proxies `/api` →
  `http://localhost:8787` (see `vite.config.js`), live updates arrive over
  `ws://localhost:8787` with automatic 3s-polling fallback.

## Screens

| Route | Screen |
| --- | --- |
| `/` | Passenger search — origin/destination selects, direct + transfer results |
| `/track/:routeId` | Live tracking — map, moving bus, ticking stop ETAs, service alerts |
| `/driver` | Driver console — start trip, status updates, phone-GPS source |
| `/operator` | Operator dashboard — KPIs, fleet map, live table, alert publishing |

Stack: Vite + React (JS) · Tailwind v4 · react-leaflet · Esri dark basemap tiles
(no API key). ETA confidence (`high|medium|low` + `eta_range_min`) comes from the
API when present; the UI degrades to "ESTIMATING…" on low confidence.
