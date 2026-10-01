// Geo helpers for the Routepulse ETA engine.
// Haversine distance, cumulative route polylines, point->polyline projection
// and distance->point interpolation. City-scale math (Lahore bbox), good to ~m.

const EARTH_R_KM = 6371;
const M_PER_LAT = 110540;
const mPerLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Build a cumulative-distance polyline from ordered stops [{lat, lng, ...}].
 * Returns { points, cum, total } where cum[i] = km from route start to stop i.
 */
export function buildPolyline(stops) {
  const points = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(
      cum[i - 1] +
        haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
    );
  }
  return { points, cum, total: cum[cum.length - 1] };
}

/**
 * Project a GPS position onto the polyline.
 * Returns { distAlong (km from start), offsetKm (perpendicular miss), segIndex, t }.
 */
export function projectOntoPolyline(lat, lng, poly) {
  let best = { distAlong: 0, offsetKm: Infinity, segIndex: 0, t: 0 };
  for (let i = 0; i < poly.points.length - 1; i++) {
    const a = poly.points[i];
    const b = poly.points[i + 1];
    const k = mPerLng((a.lat + b.lat) / 2);
    const ax = 0;
    const ay = 0;
    const bx = (b.lng - a.lng) * k;
    const by = (b.lat - a.lat) * M_PER_LAT;
    const px = (lng - a.lng) * k;
    const py = (lat - a.lat) * M_PER_LAT;
    const len2 = bx * bx + by * by;
    let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = px - t * bx;
    const dy = py - t * by;
    const offKm = Math.sqrt(dx * dx + dy * dy) / 1000;
    if (offKm < best.offsetKm) {
      const segKm = poly.cum[i + 1] - poly.cum[i];
      best = { distAlong: poly.cum[i] + t * segKm, offsetKm: offKm, segIndex: i, t };
    }
  }
  return best;
}

/** Interpolate the lat/lng at distance d (km) along the polyline. */
export function pointAtDistance(poly, d) {
  const { points, cum, total } = poly;
  if (d <= 0) return { ...points[0] };
  if (d >= total) return { ...points[points.length - 1] };
  for (let i = 0; i < cum.length - 1; i++) {
    if (d <= cum[i + 1]) {
      const seg = cum[i + 1] - cum[i] || 1e-9;
      const t = (d - cum[i]) / seg;
      return {
        lat: points[i].lat + t * (points[i + 1].lat - points[i].lat),
        lng: points[i].lng + t * (points[i + 1].lng - points[i].lng),
      };
    }
  }
  return { ...points[points.length - 1] };
}
