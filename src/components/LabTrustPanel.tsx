import { useMemo, useState } from 'react'
import type { GcPreferences, LabTrust, Patient, Specialty, TrustTier } from '../types'
import { post } from '../lib/api'
import { SPECIALTIES, TIERS, displayLab } from '../lib/labTrust'
import { fmtDateTime } from '../lib/clinical'

const EMPTY = { lab: '', specialty: 'all' as Specialty, tier: 'established' as TrustTier, note: '' }

export function LabTrustPanel({ prefs, patients, onClose }: { prefs: GcPreferences; patients: Patient[]; onClose: () => void }) {
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Labs seen in ClinVar submissions, for autocomplete
  const labs = useMemo(
    () => [...new Set(patients.flatMap((p) => p.variants.flatMap((v) => (v.clinvar.submissions ?? []).map((s) => displayLab(s.lab)))))].sort(),
    [patients],
  )

  const edit = (e: LabTrust) => setForm({ lab: e.lab, specialty: e.specialty, tier: e.tier, note: e.note })

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await post('lab-trust', form)
      setForm(EMPTY)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const input = 'rounded border border-slate-300 px-1.5 py-0.5 text-xs'
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-slate-900/30 pt-16" onClick={onClose}>
      <div className="max-h-[80vh] w-[720px] overflow-y-auto rounded bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2">
          <div>
            <div className="text-sm font-semibold text-slate-900">My lab trust</div>
            <div className="text-[11px] text-slate-600">
              A specialty entry beats "all". Labs not listed are <span className="font-medium">standard</span>. The agent re-evaluates cases on the next cycle.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded px-1.5 text-lg leading-none text-slate-500 hover:bg-slate-200">
            ×
          </button>
        </div>

        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-slate-500">
              <th className="px-4 py-1 font-normal">Lab</th>
              <th className="px-2 py-1 font-normal">Specialty</th>
              <th className="px-2 py-1 font-normal">Tier</th>
              <th className="px-2 py-1 font-normal">Note</th>
              <th className="px-2 py-1 font-normal">Set</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {prefs.lab_trust.map((e) => (
              <tr key={`${e.lab}|${e.specialty}`} className="border-t border-slate-100 align-top">
                <td className="px-4 py-1 font-medium text-slate-800">{e.lab}</td>
                <td className="px-2 py-1">{e.specialty}</td>
                <td className="px-2 py-1">{e.tier}</td>
                <td className="px-2 py-1 text-slate-600">{e.note || '—'}</td>
                <td className="whitespace-nowrap px-2 py-1 text-[11px] text-slate-500">{fmtDateTime(e.set_at)}</td>
                <td className="px-2 py-1">
                  <button onClick={() => edit(e)} className="text-[11px] text-blue-700 hover:underline">
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2">
          <label className="flex flex-col text-[11px] text-slate-500">
            Lab
            <input list="lab-names" value={form.lab} onChange={(e) => setForm({ ...form, lab: e.target.value })} className={`${input} w-48`} />
            <datalist id="lab-names">
              {labs.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col text-[11px] text-slate-500">
            Specialty
            <select value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value as Specialty })} className={input}>
              {SPECIALTIES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-[11px] text-slate-500">
            Tier
            <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as TrustTier })} className={input}>
              {TIERS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col text-[11px] text-slate-500">
            Note
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={input} />
          </label>
          <button
            onClick={save}
            disabled={saving || !form.lab.trim()}
            className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-40"
          >
            Save
          </button>
          {error && <div className="w-full text-[11px] text-rose-700">{error}</div>}
        </div>

        <div className="border-t border-slate-200 px-4 py-2">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Change history</h3>
          <ul className="space-y-0.5">
            {[...prefs.trust_history].reverse().map((h, i) => (
              <li key={i} className="text-xs text-slate-700">
                <span className="text-[11px] text-slate-500">{fmtDateTime(h.at)}</span> · <span className="font-medium">{h.lab}</span> ({h.specialty}):{' '}
                {h.old_tier ?? 'unset'} → <span className="font-medium">{h.new_tier}</span>
                {h.note && <span className="text-slate-500"> · {h.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
