export function TopBar({ clinic, department, gcName, onLabTrust }: { clinic: string; department: string; gcName: string; onLabTrust: () => void }) {
  return (
    <header className="flex h-10 items-center gap-4 border-b border-slate-700 bg-slate-800 px-4 text-slate-100">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-semibold tracking-wide">VUS Watch</span>
        <span className="text-xs text-slate-300">
          {department} — {clinic}
        </span>
      </div>
      <span className="rounded border border-amber-400 bg-amber-300 px-2 py-px text-[11px] font-bold tracking-wider text-amber-950">
        FICTIONAL DEMO DATA
      </span>
      <button
        onClick={onLabTrust}
        className="ml-auto rounded border border-slate-500 px-2 py-0.5 text-xs text-slate-100 hover:bg-slate-700"
      >
        My lab trust
      </button>
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
        {gcName}
      </div>
    </header>
  )
}
