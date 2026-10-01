import { useEffect, useRef, useState } from 'react'
import { getLocations, WS_URL } from './api'
import { mockLocations } from './mock'

// Live fleet locations.
// mock = true → local simulator ticks every 1s (DEMO DATA mode)
// mock = false → WebSocket push, automatic fallback to 3s polling
export function useLiveLocations(mock) {
  const [state, setState] = useState({
    locations: [],
    source: mock ? 'demo' : 'connecting',
    lastAlert: null, // WS 'alert' frame (the two-second magic moment)
    crowdUpdates: {}, // route_id -> latest WS 'crowd' frame
  })

  useEffect(() => {
    if (mock) {
      setState({ locations: mockLocations(), source: 'demo' })
      const id = setInterval(
        () => setState({ locations: mockLocations(), source: 'demo' }),
        1000
      )
      return () => clearInterval(id)
    }

    let closed = false
    let ws = null
    let pollId = null
    let wsAttempts = 0

    const upsert = (frame) => {
      setState((s) => {
        const map = new Map(s.locations.map((x) => [x.bus_id, x]))
        map.set(frame.bus_id, { ...map.get(frame.bus_id), ...frame })
        return { ...s, locations: [...map.values()], source: 'ws' }
      })
    }

    const startPolling = () => {
      if (closed || pollId) return
      pollId = setInterval(async () => {
        try {
          const data = await getLocations(false)
          if (!closed) setState({ locations: data.locations, source: 'poll' })
        } catch {
          if (!closed) setState((s) => ({ ...s, source: 'offline' }))
        }
      }, 3000)
    }

    const connect = () => {
      if (closed) return
      try {
        ws = new WebSocket(WS_URL)
      } catch {
        startPolling()
        return
      }
      ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data)
          if (frame.type === 'snapshot') {
            // server sends a full fleet snapshot on connect
            setState((s) => ({ ...s, locations: frame.locations || [], source: 'ws' }))
          } else if (frame.type === 'location') {
            upsert(frame)
          } else if (frame.type === 'alert') {
            // operator published a service alert — land it on screen in <2s
            setState((s) => ({ ...s, lastAlert: frame, source: 'ws' }))
          } else if (frame.type === 'crowd') {
            setState((s) => ({
              ...s,
              crowdUpdates: { ...s.crowdUpdates, [frame.route_id]: frame },
            }))
          } else if (frame.type === 'trip_ended') {
            setState((s) => ({
              ...s,
              locations: s.locations.filter((x) => x.bus_id !== frame.bus_id),
            }))
          }
        } catch {
          /* ignore malformed frames */
        }
      }
      ws.onclose = () => {
        if (closed) return
        wsAttempts += 1
        if (wsAttempts >= 2) startPolling()
        else setTimeout(() => !closed && connect(), 1500)
      }
      ws.onerror = () => {
        try {
          ws.close()
        } catch {
          /* noop */
        }
      }
    }

    // initial full snapshot, then WS pushes
    getLocations(false)
      .then((data) => {
        if (!closed) setState({ locations: data.locations, source: 'connecting' })
      })
      .catch(() => {})

    connect()

    return () => {
      closed = true
      if (ws) {
        ws.onclose = null
        try {
          ws.close()
        } catch {
          /* noop */
        }
      }
      if (pollId) clearInterval(pollId)
    }
  }, [mock])

  return state
}

// ticking clock — forces a re-render every `ms` (ETA countdown)
export function useTick(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

// poll anything on an interval; fn should return a promise
export function usePoll(fn, ms, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const load = async () => {
    try {
      const d = await fnRef.current()
      setData(d)
      setError(null)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    load()
    const id = setInterval(load, ms)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, reload: load }
}

// Buses glide between GPS fixes instead of teleporting, and each bus leaves a
// fading comet trail of its recent fixes. The feed still updates at push rate;
// rendering happens at display rate via requestAnimationFrame.
export function useSmoothedLocations(locations, { trailLength = 14, glideMs = 2200 } = {}) {
  const targets = useRef(new Map()) // bus_id -> { from, to, t0, ms, raw }
  const trails = useRef(new Map()) // bus_id -> [[lat, lng], ...] actual fixes
  const [smooth, setSmooth] = useState([])
  const [trailList, setTrailList] = useState([])

  useEffect(() => {
    const now = Date.now()
    for (const b of locations) {
      if (b.lat == null || b.lng == null) continue
      const prev = targets.current.get(b.bus_id)
      targets.current.set(b.bus_id, {
        from: prev ? prev.to : { lat: b.lat, lng: b.lng },
        to: { lat: b.lat, lng: b.lng },
        t0: now,
        ms: glideMs,
        raw: b,
      })
      const tr = trails.current.get(b.bus_id) || []
      const last = tr[tr.length - 1]
      if (!last || last[0] !== b.lat || last[1] !== b.lng) {
        tr.push([b.lat, b.lng])
        if (tr.length > trailLength) tr.shift()
        trails.current.set(b.bus_id, tr)
      }
    }
  }, [locations, glideMs, trailLength])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const now = Date.now()
      const out = []
      for (const [busId, t] of targets.current) {
        if (now - t.t0 > 5 * 60 * 1000) continue // bus gone from the feed
        const k = Math.min(1, (now - t.t0) / t.ms)
        const e = 1 - Math.pow(1 - k, 3) // easeOutCubic
        out.push({
          ...t.raw,
          lat: t.from.lat + (t.to.lat - t.from.lat) * e,
          lng: t.from.lng + (t.to.lng - t.from.lng) * e,
        })
      }
      setSmooth(out)
      setTrailList(
        [...trails.current].map(([busId, points]) => ({
          busId,
          points,
          status: targets.current.get(busId)?.raw?.trip_status,
        }))
      )
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return { smooth, trails: trailList }
}
