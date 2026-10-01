import { Link } from 'react-router-dom'

// Styled 404 — paper-register "route not found" notice.
export default function NotFound() {
  return (
    <div className="rp-grid-bg flex min-h-[65vh] flex-col items-center justify-center rounded-2xl border border-edge py-16 text-center">
      <div className="font-mono text-xs tracking-[0.3em] text-fog">
        ROUTE NOT FOUND
      </div>
      <h1 className="mt-4 font-display text-7xl font-bold tracking-tight text-snow">
        404
      </h1>
      <p className="mt-4 max-w-md leading-relaxed text-fog">
        This page isn't on any route in the network — the timetable has no stop
        here. Try a different connection.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-5">
        <Link
          to="/"
          className="inline-flex min-h-12 items-center rounded-md bg-snow px-6 py-3 font-mono text-xs font-bold tracking-[0.2em] text-ink transition-colors hover:bg-signal hover:text-ink"
        >
          BACK TO THE TIMETABLE →
        </Link>
        <Link
          to="/search"
          className="self-center font-mono text-xs font-medium tracking-[0.2em] text-fog underline-offset-4 transition-colors hover:text-signal hover:underline"
        >
          SEARCH ROUTES
        </Link>
      </div>
    </div>
  )
}
