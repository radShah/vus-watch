import { useEffect, useRef, useState } from 'react'
import raw from '../../data/caseload.json'
import type { Caseload, Patient } from '../types'
import { isBenignReclassification, letterImagePath, letterVideoPath, proteinPosition } from '../lib/letters'

const gcName = (raw as unknown as Caseload).gc.name

/** Draft recontact letter for a VUS now called benign or likely benign, with its FLUX header image. For GC review. */
export function LetterPreview({ patient: p }: { patient: Patient }) {
  const v = p.variants.find(isBenignReclassification)
  const [imageMissing, setImageMissing] = useState(false)
  const [videoMissing, setVideoMissing] = useState(false)
  const [videoEnded, setVideoEnded] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const video = v && letterVideoPath(p.id, v.clinvar.variation_id)
  const videoSrc = video?.src
  // The dev server answers a missing file with index.html, so check it's really a video.
  useEffect(() => {
    if (!videoSrc) return
    fetch(videoSrc, { method: 'HEAD' })
      .then((r) => setVideoMissing(!r.ok || !r.headers.get('content-type')?.startsWith('video/')))
      .catch(() => setVideoMissing(true))
  }, [videoSrc])
  if (!v) return null
  const firstName = p.name.split(' ')[0]
  const pos = proteinPosition(v)
  const [, cdna, protein] = v.hgvs.match(/:(c\.[^ ]+)(?: \((p\.[^)]+)\))?/) ?? []

  return (
    <section className="border-b border-slate-200 px-4 py-3">
      <h3 className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Draft letter</h3>
      <p className="mb-1.5 text-[11px] text-amber-800">
        Draft: sent only after counselor approval. In production, triggered by the testing lab's amended report.
      </p>
      <div className="overflow-hidden rounded border border-slate-200">
        {imageMissing ? (
          <p className="bg-slate-50 px-2 py-3 text-[11px] text-slate-500">
            No image yet. Run <code>npx tsx src/agent/fluxLetterImage.ts</code>.
          </p>
        ) : (
          <div className="bg-[#f4eddb]">
            <p className="px-3 pt-2.5 text-center text-xs text-slate-800">
              Your <strong>{v.gene}</strong> variant: {cdna ?? v.hgvs}
              {protein && ` (${protein})`}
              {pos && (
                <span className="text-slate-500">
                  {' '}
                  · position {pos.pos.toLocaleString()} of {pos.length.toLocaleString()}
                </span>
              )}
            </p>
            {!videoMissing ? (
              <>
                <div className="relative">
                  <video
                    ref={videoRef}
                    src={video!.src}
                    poster={video!.poster}
                    aria-label={`Your ${v.gene} variant: the question mark on it becomes a check as new evidence arrives`}
                    className="block w-full"
                    autoPlay
                    muted
                    playsInline
                    onEnded={() => setVideoEnded(true)}
                    onError={() => setVideoMissing(true)}
                  />
                  {videoEnded && (
                    <button
                      type="button"
                      className="absolute right-2 bottom-2 rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-slate-700 shadow-sm hover:bg-white"
                      onClick={() => {
                        setVideoEnded(false)
                        void videoRef.current?.play()
                      }}
                    >
                      ↻ Replay
                    </button>
                  )}
                </div>
                <p className="px-3 pb-3 text-center text-[11px] leading-tight">
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">
                    {v.reported_classification.date.slice(0, 4)} · {v.reported_classification.lab} · <strong>Uncertain</strong>
                  </span>
                  <span className="px-1.5 text-slate-500">→</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-900">
                    {v.clinvar.last_evaluated?.slice(0, 4) ?? 'Now'} · updated · <strong>{v.clinvar.classification}</strong>
                  </span>
                </p>
              </>
            ) : (
              <>
                <img
                  src={letterImagePath(p.id, v.clinvar.variation_id)}
                  alt={`Your ${v.gene} variant: uncertain in ${v.reported_classification.date.slice(0, 4)}, now ${v.clinvar.classification.toLowerCase()}`}
                  className="block w-full"
                  onError={() => setImageMissing(true)}
                />
                {/* Pills sit under the image's two cards (each ~44% wide, ~3% in from the edges). */}
                <div className="grid grid-cols-2 gap-[6%] px-[3%] pb-3 text-center text-[11px] leading-tight">
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">
                    {v.reported_classification.date.slice(0, 4)} · {v.reported_classification.lab} · <strong>Uncertain</strong>
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-900">
                    {v.clinvar.last_evaluated?.slice(0, 4) ?? 'Now'} · updated · <strong>{v.clinvar.classification}</strong>
                  </span>
                </div>
              </>
            )}
          </div>
        )}
        <div className="space-y-2 px-3 py-2 text-xs leading-relaxed text-slate-800">
          <p>Dear {firstName},</p>
          <p>
            The laboratory that performed your genetic test has updated the result for your {v.gene} variant. It was
            previously reported as a variant of uncertain significance (VUS) and is now classified as{' '}
            <strong>{v.clinvar.classification.toLowerCase()}</strong>, meaning it is not expected to increase your risk.
          </p>
          <p>Your care should continue to be guided by your personal and family history.</p>
          <p>If you'd like to talk this through, you can schedule a visit with us. Otherwise, no action is needed.</p>
          <p>
            Sincerely,
            <br />
            {gcName}
          </p>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {videoMissing
          ? "Image: the agent draws this patient's gene and variant position exactly, FLUX.2 [pro] paints it, and the agent redraws the ? and ✓ on top."
          : "Video: the agent draws the first frame (? on this patient's variant) and the last (✓), FLUX.2 [pro] paints both, and FLUX 3 Video animates between them."}
      </p>
    </section>
  )
}
