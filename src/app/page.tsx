import AgentConsole from "@/components/AgentConsole";
import { ShieldCheck, Zap, GitBranch } from "lucide-react";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Background layers */}
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 noise" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[560px] w-[900px] rounded-full bg-accent/20 blur-[140px]" />
      <div className="absolute top-40 right-0 h-[400px] w-[500px] rounded-full bg-accent-2/10 blur-[140px]" />

      <div className="relative">
        {/* Nav */}
        <header className="max-w-5xl mx-auto px-6 pt-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="" className="size-7" />
            <span className="font-semibold tracking-tight">ServiceAudit Agent</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <span className="size-1.5 rounded-full bg-ok animate-pulse" />
              Free · open-weight model · no signup
            </span>
          </div>
        </header>

        {/* Hero */}
        <section className="max-w-3xl mx-auto px-6 pt-16 sm:pt-20 pb-10 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/50 mb-6">
            <Zap className="size-3 text-accent" />
            An actual AI agent — not a lookup table
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1]">
            Know what your car
            <br />
            <span className="text-gradient">actually needs.</span>
          </h1>
          <p className="mt-5 text-white/50 text-base sm:text-lg leading-relaxed max-w-xl mx-auto">
            Give it your VIN and mileage. The agent decodes your vehicle, pulls the
            real maintenance schedule, and — if a shop already sent you a quote —
            tells you exactly what&apos;s justified and what&apos;s padding.
          </p>
        </section>

        {/* Console */}
        <section className="px-6 pb-16">
          <AgentConsole />
        </section>

        {/* Trust strip */}
        <section className="max-w-3xl mx-auto px-6 pb-24">
          <div className="grid sm:grid-cols-3 gap-4 text-xs text-white/40">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-accent shrink-0" />
              Reasons over manufacturer intervals, not fixed rules
            </div>
            <div className="flex items-center gap-2">
              <GitBranch className="size-4 text-accent shrink-0" />
              Live VIN decode via NHTSA&apos;s public database
            </div>
            <div className="flex items-center gap-2">
              <Zap className="size-4 text-accent shrink-0" />
              Runs on an open-weight model, free to operate
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
