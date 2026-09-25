import { useEffect, useState, type ReactNode } from 'react'
import type { CycleActivity } from '../types'
import { fmtDateTime } from '../lib/clinical'

type State = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ok'; cycles: CycleActivity[] }

/** Per-cycle caseload counts, read from RawTree via the dev-server API. Never computed locally. */
export function CaseloadActivity({ lastCycle }: { lastCycle?: number }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  // Re-read after each cycle (Vite hot-reloads caseload.json, which changes lastCycle)
  useEffect(() => {
    let live = true
    fetch('/api/caseload-activity')
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`)
        if (live) setState({ status: 'ok', cycles: body as CycleActivity[] })
      })
      .catch((e: unknown) => live && setState({ status: 'error', error: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
  }, [lastCycle])

  const frame = (children: ReactNode) => (
    <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50 px-4 py-1 text-[12px] text-slate-600">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Caseload activity</span>
      {children}
    </div>
  )

  if (state.status === 'loading') return frame(<span className="text-slate-400">Loading from RawTree…</span>)
  if (state.status === 'error')
    return frame(
      <span className="font-medium text-red-700" title={state.error}>
        RawTree unavailable
      </span>,
    )

  const full = state.cycles.filter((c) => !c.variant_filter)
  const latest = full.at(-1)
  const prev = full.at(-2)
  const single = state.cycles.at(-1)?.variant_filter && (!latest || state.cycles.at(-1)!.cycle > latest.cycle) ? state.cycles.at(-1) : null
  if (!latest && !single) return frame(<span className="text-slate-400">No cycles in RawTree yet</span>)

  const n = (v: number | null) => (v == null ? '—' : String(v))
  const delta = (cur: number | null, old: number | null | undefined) => {
    if (cur == null || old == null || cur === old) return null
    const d = cur - old
    return <span className={d > 0 ? 'text-amber-700' : 'text-emerald-700'}>{d > 0 ? `+${d}` : d}</span>
  }
  const stats: { label: string; key: 'cases_watched' | 'cases_woke_up' | 'urgent_upgrades' | 'awaiting_gc'; alarm?: boolean }[] = [
    { label: 'Watched', key: 'cases_watched' },
    { label: 'Woke up', key: 'cases_woke_up' },
    { label: 'Urgent upgrades', key: 'urgent_upgrades', alarm: true },
    { label: 'Awaiting GC review', key: 'awaiting_gc' },
  ]

  return frame(
    <>
      {latest && (
        <>
          <span>
            Cycle <span className="font-medium text-slate-800">{latest.cycle}</span> · {fmtDateTime(latest.ts)}
          </span>
          {stats.map((s) => (
            <span key={s.key} className="flex items-baseline gap-1">
              {s.label}
              <span className={`font-semibold ${s.alarm && latest[s.key] ? 'text-red-700' : 'text-slate-800'}`}>{n(latest[s.key])}</span>
              {delta(latest[s.key], prev?.[s.key])}
            </span>
          ))}
        </>
      )}
      {single && (
        <span className="text-slate-500">
          Cycle {single.cycle} · variant {single.variant_filter} · {single.cases_watched} case{single.cases_watched === 1 ? '' : 's'} · woke up{' '}
          {n(single.cases_woke_up)} · awaiting GC {n(single.awaiting_gc)}
        </span>
      )}
      <span className="ml-auto text-[11px] text-slate-400">from RawTree</span>
    </>,
  )
}
