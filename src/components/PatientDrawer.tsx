import type { ReactNode } from 'react'
import type { HistoryEntry, Patient, Variant } from '../types'
import { caseStatus, fmtDate, fmtDateTime, reviewStars } from '../lib/clinical'
import { ClassBadge, Stars, WatchChip } from './Chips'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 py-px text-xs">
      <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
      <dd className="text-slate-800">{children}</dd>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-200 px-4 py-3">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

const HISTORY_LABEL: Record<HistoryEntry['field'], string> = {
  classification: 'Classification',
  record_version: 'Record version',
  submission: 'Lab submission',
}

function LabSubmissions({ clinvar: c }: { clinvar: Variant['clinvar'] }) {
  if (!c.submissions && c.extraction_status !== 'failed') return null
  return (
    <div className="border-t border-slate-200 px-2 py-1.5">
      <div className="mb-1 text-[11px] text-slate-500">Lab submissions</div>
      {c.extraction_status === 'failed' && (
        <p className="mb-1 text-[11px] text-rose-700">
          Extraction failed this cycle{c.submissions ? '; showing the last successful extraction.' : '. See ClinVar.'}
        </p>
      )}
      {c.submissions && (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pr-2 font-normal">Lab</th>
              <th className="pr-2 font-normal">Classification</th>
              <th className="pr-2 font-normal">Last evaluated</th>
              <th className="pr-2 font-normal">Review status</th>
              <th className="font-normal">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {c.submissions.map((s) => (
              <tr key={s.scv_accession} className="border-t border-slate-100 align-top">
                <td className="py-0.5 pr-2 text-slate-800" title={s.scv_accession}>
                  {s.lab}
                </td>
                <td className="py-0.5 pr-2">
                  <ClassBadge desc={s.classification} />
                </td>
                <td className="whitespace-nowrap py-0.5 pr-2 text-slate-600">{fmtDate(s.last_evaluated)}</td>
                <td className="py-0.5 pr-2 text-slate-600" title={s.review_status ?? undefined}>
                  <Stars n={reviewStars(s.review_status ?? '')} />
                </td>
                <td className="py-0.5">
                  <div className="flex flex-wrap gap-0.5">
                    {s.evidence_tags.length ? (
                      s.evidence_tags.map((t) => (
                        <span key={t} className="rounded bg-slate-100 px-1 text-[10px] text-slate-700">
                          {t.replace(/_/g, ' ')}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function PatientDrawer({ patient: p, onClose }: { patient: Patient; onClose: () => void }) {
  return (
    <aside className="flex w-[500px] shrink-0 flex-col border-l border-slate-300 bg-white shadow-xl">
      <div className="flex items-start justify-between border-b border-slate-200 bg-slate-100 px-4 py-2">
        <div>
          <div className="text-sm font-semibold text-slate-900">{p.name}</div>
          <div className="text-[11px] text-slate-600">
            MRN {p.mrn} · {p.age}y {p.sex} · DOB {fmtDate(p.dob)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <WatchChip status={caseStatus(p)} />
          <button onClick={onClose} aria-label="Close" className="rounded px-1.5 text-lg leading-none text-slate-500 hover:bg-slate-200">
            ×
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Block title="Demographics & referral">
          <dl>
            <Field label="Clinic area">{p.clinic_area}</Field>
            <Field label="Indication">{p.indication}</Field>
            <Field label="Ordering provider">{p.ordering_provider}</Field>
          </dl>
        </Block>

        <Block title="Test">
          <dl>
            <Field label="Testing lab">{p.testing_lab}</Field>
            <Field label="Test">{p.test_name}</Field>
            <Field label="Report date">{fmtDate(p.report_date)}</Field>
            <Field label="Result">{p.result_category === 'VUS' ? 'Variant of uncertain significance (VUS)' : p.result_category}</Field>
          </dl>
        </Block>

        <Block title={`Variants (${p.variants.length})`}>
          {!p.variants.length && <p className="text-xs text-slate-500">No reportable variants. Negative result.</p>}
          {p.variants.map((v, i) => (
            <div key={i} className={`mb-2 rounded border ${v.classification_changed ? 'border-amber-400' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1">
                <span className="font-mono text-[11px] text-slate-800">{v.hgvs}</span>
                {v.classification_changed && (
                  <span className="shrink-0 rounded bg-amber-500 px-1 text-[10px] font-bold text-white">CHANGED</span>
                )}
              </div>
              <div className="grid grid-cols-2 divide-x divide-slate-200 text-xs">
                <div className="px-2 py-1.5">
                  <div className="mb-0.5 text-[11px] text-slate-500">As reported by lab</div>
                  <ClassBadge desc={v.reported_classification.classification} />
                  <div className="mt-0.5 text-[11px] text-slate-600">
                    {v.reported_classification.lab} · {fmtDate(v.reported_classification.date)}
                  </div>
                </div>
                <div className="px-2 py-1.5">
                  <div className="mb-0.5 text-[11px] text-slate-500">Current ClinVar</div>
                  <div className="flex items-center gap-1">
                    <ClassBadge desc={v.clinvar.classification} />
                    <Stars n={reviewStars(v.clinvar.review_status)} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-600">{v.clinvar.classification}</div>
                  <div className="text-[11px] text-slate-600">Review status: {v.clinvar.review_status}</div>
                  <div className="text-[11px] text-slate-600">Last evaluated: {fmtDate(v.clinvar.last_evaluated)}</div>
                  {v.clinvar.record_version != null && (
                    <div className="text-[11px] text-slate-600">
                      Record version {v.clinvar.record_version}
                      {v.clinvar.record_last_updated && ` · updated ${fmtDate(v.clinvar.record_last_updated)}`}
                    </div>
                  )}
                  {v.clinvar.last_checked && (
                    <div className="text-[11px] text-slate-600">Last checked {fmtDateTime(v.clinvar.last_checked)}</div>
                  )}
                </div>
              </div>
              <LabSubmissions clinvar={v.clinvar} />
              <div className="flex items-center justify-between border-t border-slate-200 px-2 py-1 text-[11px]">
                <span className="text-slate-500">
                  {v.gene} · {v.zygosity} · watch: <WatchChip status={v.watch_status} />
                </span>
                <a href={v.clinvar.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                  {v.clinvar.vcv} ↗
                </a>
              </div>
            </div>
          ))}
        </Block>

        <Block title="Next action">
          <p className="text-xs text-slate-800">{p.next_action}</p>
          <p className="mt-1 text-[11px] text-slate-500">Last checked {fmtDateTime(p.last_checked)}</p>
        </Block>

        <Block title="Agent activity">
          {p.history.length ? (
            <ul className="space-y-1.5">
              {[...p.history].reverse().map((h, i) => (
                <li key={i} className="text-xs">
                  <div className="text-slate-800">
                    <span className="font-semibold">{HISTORY_LABEL[h.field]}</span>
                    : {String(h.old ?? '—')} → <span className="font-semibold">{h.new == null ? 'withdrawn' : String(h.new)}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Observed {fmtDateTime(h.observed_at)} ·{' '}
                    <a href={h.source_url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                      ClinVar ↗
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs italic text-slate-400">
              {p.variants.some((v) => v.clinvar.last_checked)
                ? `No changes observed. Last checked ${fmtDateTime(p.last_checked)}.`
                : 'No agent activity yet.'}
            </p>
          )}
        </Block>

        <Block title="GC decisions">
          <p className="text-xs italic text-slate-400">No decisions recorded.</p>
        </Block>
      </div>
    </aside>
  )
}
