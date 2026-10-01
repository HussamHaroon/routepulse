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
