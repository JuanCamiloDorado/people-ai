import { Loader2 } from "lucide-react";

export function CandidatePortalSkeleton() {
  return (
    <div
      role="status"
      aria-label="Cargando portal de contratación"
      className="min-h-screen bg-[#f8fafd] text-slate-800 antialiased font-['Schibsted_Grotesk',sans-serif] pb-20 pt-6 sm:pt-8 px-4 sm:px-6"
    >
      <div className="mx-auto max-w-[1080px]">
        {/* ========================================================================= */}
        {/* HERO BANNER SKELETON                                                      */}
        {/* ========================================================================= */}
        <header className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#04519f] via-[#0144a0] to-[#012f73] p-8 sm:p-11 text-white shadow-[0_22px_48px_-24px_rgba(1,47,115,0.6)]">
          {/* Subtle geometric dot grid pattern in top-right */}
          <div
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-1/2 opacity-25"
            style={{
              backgroundImage:
                "radial-gradient(rgba(255, 255, 255, 0.8) 1.2px, transparent 1.2px)",
              backgroundSize: "22px 22px",
              WebkitMaskImage:
                "linear-gradient(255deg, rgba(0,0,0,1) 0%, transparent 65%)",
              maskImage:
                "linear-gradient(255deg, rgba(0,0,0,1) 0%, transparent 65%)",
            }}
          />

          <div className="relative z-10 animate-pulse">
            {/* Tagline and loading indicator */}
            <div className="flex items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-2.5">
                <div className="h-3.5 w-36 sm:w-44 rounded-full bg-white/25" />
                <span className="h-[1px] w-16 sm:w-24 bg-white/20" />
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-[#d3e3f9] backdrop-blur-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#a9c8f0]" />
                <span className="hidden sm:inline">Cargando expediente...</span>
              </div>
            </div>

            {/* Title & Subtitle */}
            <div className="h-9 sm:h-11 w-48 sm:w-64 rounded-xl bg-white/30 mb-3" />
            <div className="h-5 sm:h-6 w-72 sm:w-96 max-w-full rounded-lg bg-white/20 mb-8" />

            {/* Metadata row */}
            <div className="mt-8 flex flex-wrap gap-y-4 gap-x-10 border-t border-white/20 pt-6">
              <div className="space-y-2">
                <div className="h-2.5 w-14 rounded-full bg-white/20" />
                <div className="h-5 w-36 rounded-lg bg-white/25" />
              </div>
              <div className="space-y-2">
                <div className="h-2.5 w-16 rounded-full bg-white/20" />
                <div className="h-5 w-28 rounded-lg bg-white/25" />
              </div>
              <div className="space-y-2">
                <div className="h-2.5 w-20 rounded-full bg-white/20" />
                <div className="h-5 w-32 rounded-lg bg-white/25" />
              </div>
            </div>

            {/* Notice banner */}
            <div className="mt-7 flex items-start gap-3.5 border-l-[3.5px] border-[#f0b429]/50 pl-3.5">
              <div className="h-4 w-full max-w-xl rounded-md bg-white/15" />
            </div>
          </div>
        </header>

        {/* ========================================================================= */}
        {/* TWO-COLUMN LAYOUT SKELETON                                                */}
        {/* ========================================================================= */}
        <div className="mt-6 flex flex-col lg:flex-row items-start gap-6">
          {/* LEFT SIDEBAR SKELETON */}
          <aside className="w-full lg:w-[310px] shrink-0 flex flex-col gap-4">
            {/* Progress Card Skeleton */}
            <div className="rounded-2xl bg-gradient-to-br from-[#04519f] via-[#0144a0] to-[#012f73] p-5.5 text-white shadow-[0_16px_34px_-22px_rgba(1,47,115,0.55)] animate-pulse">
              <div className="flex items-center gap-4">
                <div className="h-[62px] w-[62px] shrink-0 rounded-full bg-white/20" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-28 rounded bg-white/30" />
                  <div className="h-3 w-36 rounded bg-white/20" />
                </div>
              </div>

              {/* Requirement quick checklist skeleton */}
              <div className="mt-5 space-y-2.5 border-t border-white/20 pt-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="h-4 w-4 rounded-full bg-white/20 shrink-0" />
                    <div className="h-3.5 rounded bg-white/20 flex-1" />
                  </div>
                ))}
              </div>
            </div>

            {/* Action Box Skeleton */}
            <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm space-y-3 animate-pulse">
              <div className="h-12 w-full rounded-xl bg-slate-200/80" />
              <div className="h-3 w-44 mx-auto rounded bg-slate-100" />
            </div>

            {/* Contact Help Skeleton */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-2 animate-pulse">
              <div className="h-4 w-28 rounded bg-slate-200" />
              <div className="h-3 w-full rounded bg-slate-100" />
              <div className="pt-2 space-y-1.5">
                <div className="h-3 w-40 rounded bg-slate-100" />
                <div className="h-3 w-32 rounded bg-slate-100" />
              </div>
            </div>
          </aside>

          {/* MAIN CONTENT AREA SKELETON */}
          <main className="min-w-0 flex-1 w-full space-y-5">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm animate-pulse space-y-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5 flex-1">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 font-mono text-xs font-semibold text-slate-300 shrink-0">
                      0{i}
                    </div>
                    <div className="space-y-2.5 flex-1">
                      <div className="h-5 w-48 sm:w-64 rounded-md bg-slate-200" />
                      <div className="h-3.5 w-full max-w-md rounded bg-slate-100" />
                      {/* Format tags */}
                      <div className="flex gap-2 pt-1">
                        <div className="h-5 w-12 rounded-full bg-slate-100" />
                        <div className="h-5 w-16 rounded-full bg-slate-100" />
                        <div className="h-5 w-20 rounded-full bg-slate-100" />
                      </div>
                    </div>
                  </div>
                  <div className="h-9 w-28 rounded-xl bg-slate-100 shrink-0" />
                </div>
              </div>
            ))}
          </main>
        </div>
      </div>
    </div>
  );
}

export default CandidatePortalSkeleton;
