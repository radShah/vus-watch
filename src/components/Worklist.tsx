import { useMemo, useState } from 'react'
import type { Patient } from '../types'
import {
  WATCH_ORDER,
  caseStatus,
  fmtDate,
  fmtDateTime,
  isChanged,
  reviewStars,
  shortClass,
  shortVariant,
} from '../lib/clinical'
import { ClassBadge, Stars, WatchChip } from './Chips'

type SortKey = 'patient' | 'indication' | 'gene' | 'reported' | 'current' | 'changed' | 'status' | 'checked'
type Dir = 'asc' | 'desc'

const CLASS_RANK = ['Pathogenic', 'P/LP', 'Likely pathogenic', 'Conflicting', 'VUS', 'Likely benign', 'B/LB', 'Benign']

function sortValue(p: Patient, key: SortKey): string | number {
  const v = p.variants[0]
  switch (key) {
    case 'patient':
      return p.name.split(' ').reverse().join(' ')
    case 'indication':
      return p.indication
    case 'gene':
      return v?.gene ?? '~'
    case 'reported':
      return p.report_date
    case 'current':
      return v ? CLASS_RANK.indexOf(shortClass(v.clinvar.classification)) : 99
    case 'changed':
      return isChanged(p) ? 0 : 1
    case 'status': {
      const s = caseStatus(p)
      return s ? WATCH_ORDER.indexOf(s) : 99
    }
    case 'checked':
      return p.last_checked
  }
}

/** Default worklist order: most urgent status, then changed, then most recent report. */
function defaultCompare(a: Patient, b: Patient): number {
  return (
    (sortValue(a, 'status') as number) - (sortValue(b, 'status') as number) ||
    (sortValue(a, 'changed') as number) - (sortValue(b, 'changed') as number) ||
    b.report_date.localeCompare(a.report_date)
  )
}

type Sort = { key: SortKey; dir: Dir } | null

function Th({ k, sort, onSort, children, className = '' }: {
  k?: SortKey
  sort: Sort
  onSort: (k: SortKey) => void
  children: string
  className?: string
}) {
  return (
    <th
      onClick={k ? () => onSort(k) : undefined}
      className={`sticky top-0 z-10 border-b border-slate-300 bg-slate-100 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600 ${
        k ? 'cursor-pointer select-none hover:text-slate-900' : ''
      } ${className}`}
    >
      {children}
      {k && sort?.key === k && <span className="ml-0.5 text-blue-700">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )
}

interface Props {
  patients: Patient[]
  selectedId: string | null
  onSelect: (p: Patient) => void
}

export function Worklist({ patients, selectedId, onSelect }: Props) {
  const [sort, setSort] = useState<Sort>(null)

  const rows = useMemo(() => {
    if (!sort) return [...patients].sort(defaultCompare)
    const m = sort.dir === 'asc' ? 1 : -1
    return [...patients].sort((a, b) => {
      const x = sortValue(a, sort.key)
      const y = sortValue(b, sort.key)
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return c * m || defaultCompare(a, b)
    })
  }, [patients, sort])

  const clickSort = (key: SortKey) =>
    setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null))

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <Th k="patient" sort={sort} onSort={clickSort}>Patient</Th>
            <Th k="indication" sort={sort} onSort={clickSort}>Indication</Th>
            <Th k="gene" sort={sort} onSort={clickSort}>Gene</Th>
            <Th sort={sort} onSort={clickSort}>Variant</Th>
            <Th k="reported" sort={sort} onSort={clickSort}>Reported (lab, date)</Th>
            <Th k="current" sort={sort} onSort={clickSort}>Current ClinVar</Th>
            <Th k="changed" sort={sort} onSort={clickSort} className="text-center">Changed?</Th>
            <Th k="status" sort={sort} onSort={clickSort}>Watch status</Th>
            <Th sort={sort} onSort={clickSort}>Next action</Th>
            <Th k="checked" sort={sort} onSort={clickSort}>Last checked</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const status = caseStatus(p)
            const changed = isChanged(p)
            const selected = p.id === selectedId
            const rowTone = selected
              ? 'bg-blue-50'
              : status === 'active' || changed
                ? 'bg-amber-50/60 hover:bg-amber-50'
                : 'bg-white hover:bg-slate-50'
            const accent = status === 'active' || changed ? 'border-l-amber-500' : 'border-l-transparent'
            return (
              <tr
                key={p.id}
                onClick={() => onSelect(p)}
                className={`cursor-pointer border-b border-slate-200 align-top ${rowTone}`}
              >
                <td className={`border-l-4 px-2 py-1 ${accent}`}>
                  <div className="font-medium text-slate-900">{p.name}</div>
                  <div className="whitespace-nowrap text-[11px] text-slate-500">
                    {p.mrn} · {p.age}y {p.sex}
                  </div>
                </td>
                <td className="max-w-56 px-2 py-1 text-slate-700">{p.indication}</td>
                <td className="px-2 py-1">
                  {p.variants.length ? (
                    p.variants.map((v, i) => (
                      <div key={i} className="font-mono font-semibold text-slate-800 italic">
                        {v.gene}
                      </div>
                    ))
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-2 py-1 font-mono text-[11px] text-slate-700">
                  {p.variants.length
                    ? p.variants.map((v, i) => {
                        const s = shortVariant(v.hgvs)
                        return (
                          <div key={i} className="whitespace-nowrap">
                            {s.c}
                            {s.p && <span className="text-slate-500"> {s.p}</span>}
                          </div>
                        )
                      })
                    : <span className="font-sans text-slate-400">Negative</span>}
                </td>
                <td className="px-2 py-1">
                  {p.variants.length ? (
                    p.variants.map((v, i) => (
                      <div key={i} className="whitespace-nowrap">
                        <ClassBadge desc={v.reported_classification.classification} />{' '}
                        <span className="text-[11px] text-slate-500">
                          {v.reported_classification.lab}, {fmtDate(v.reported_classification.date)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <span className="whitespace-nowrap text-[11px] text-slate-500">
                      {p.testing_lab}, {fmtDate(p.report_date)}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {p.variants.map((v, i) => (
                    <div key={i} className="flex items-center gap-1 whitespace-nowrap">
                      <ClassBadge desc={v.clinvar.classification} />
                      <Stars n={reviewStars(v.clinvar.review_status)} title={v.clinvar.review_status} />
                    </div>
                  ))}
                </td>
                <td className="px-2 py-1 text-center">
                  {p.variants.map((v, i) => (
                    <div key={i}>
                      {v.classification_changed ? (
                        <span className="rounded bg-amber-500 px-1 text-[10px] font-bold text-white">CHANGED</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </div>
                  ))}
                </td>
                <td className="px-2 py-1">
                  <WatchChip status={status} />
                </td>
                <td className="max-w-64 px-2 py-1 text-slate-700">{p.next_action}</td>
                <td className="whitespace-nowrap px-2 py-1 text-[11px] text-slate-500">{fmtDateTime(p.last_checked)}</td>
              </tr>
            )
          })}
          {!rows.length && (
            <tr>
              <td colSpan={10} className="px-2 py-6 text-center text-slate-500">
                No patients match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
