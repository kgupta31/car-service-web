"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Car,
  Gauge,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Terminal,
  Sparkles,
  ArrowRight,
  Wrench,
} from "lucide-react";
import type { AgentEvent, Findings } from "@/lib/types";
import { kmToMiles, milesToKm, convertMilesInfoToKm } from "@/lib/units";
import { VehicleIcon } from "@/components/VehicleIcon";

type TraceLine = { id: number; label: string };

const STATUS_META: Record<
  Findings["items"][number]["status"],
  { label: string; color: string; dot: string }
> = {
  overdue: { label: "Overdue", color: "text-danger border-danger/30 bg-danger/10", dot: "bg-danger" },
  due_now: { label: "Due now", color: "text-warn border-warn/30 bg-warn/10", dot: "bg-warn" },
  not_due: { label: "Not due yet", color: "text-ok border-ok/30 bg-ok/10", dot: "bg-ok" },
};

const VERDICT_META: Record<
  Findings["quoteVerdicts"][number]["verdict"],
  { label: string; color: string; Icon: typeof CheckCircle2 }
> = {
  justified: { label: "Justified", color: "text-ok border-ok/30 bg-ok/10", Icon: CheckCircle2 },
  premature: { label: "Premature", color: "text-warn border-warn/30 bg-warn/10", Icon: AlertTriangle },
  not_on_schedule: { label: "Not on schedule", color: "text-danger border-danger/30 bg-danger/10", Icon: XCircle },
};

export default function AgentConsole() {
  const [mode, setMode] = useState<"vin" | "manual">("vin");
  const [vin, setVin] = useState("");
  const [manualYear, setManualYear] = useState("");
  const [manualMake, setManualMake] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [mileage, setMileage] = useState<string>("60000");
  const [unit, setUnit] = useState<"mi" | "km">("mi");
  const [quote, setQuote] = useState("");
  const [drivingConditions, setDrivingConditions] = useState("");
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [findings, setFindings] = useState<Findings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const traceIdRef = useRef(0);

  const vinValid = vin.trim().length === 17;
  const manualValid =
    /^\d{4}$/.test(manualYear.trim()) && manualMake.trim().length > 0 && manualModel.trim().length > 0;
  const canSubmit = mode === "vin" ? vinValid : manualValid;

  async function runAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setTrace([]);
    setFindings(null);
    setError(null);

    const pushTrace = (label: string) => {
      traceIdRef.current += 1;
      setTrace((prev) => [...prev, { id: traceIdRef.current, label }]);
    };

    const mileageMiles = unit === "km" ? kmToMiles(Number(mileage)) : Number(mileage);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "vin"
            ? { mode, vin: vin.trim(), mileage: mileageMiles, quote, drivingConditions }
            : {
                mode,
                year: manualYear.trim(),
                make: manualMake.trim(),
                model: manualModel.trim(),
                mileage: mileageMiles,
                quote,
                drivingConditions,
              }
        ),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const event = JSON.parse(line.slice(5)) as AgentEvent;

          if (event.type === "tool_call") {
            const label =
              event.name === "vin_decode"
                ? `Decoding VIN ${String(event.input.vin ?? "")}...`
                : `Looking up maintenance schedule for ${event.input.make} ${event.input.model}...`;
            pushTrace(label);
          } else if (event.type === "tool_result") {
            pushTrace(`✓ ${event.name} returned a result`);
          } else if (event.type === "final") {
            pushTrace("✓ Compiling findings...");
            setFindings(event.findings);
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <form
        onSubmit={runAgent}
        className="glass rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/40"
      >
        <div className="flex items-center gap-1.5 mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-1 w-fit">
          <button
            type="button"
            onClick={() => setMode("vin")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              mode === "vin" ? "bg-accent/20 text-accent" : "text-white/40 hover:text-white/70"
            }`}
          >
            By VIN
          </button>
          <button
            type="button"
            onClick={() => setMode("manual")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              mode === "manual" ? "bg-accent/20 text-accent" : "text-white/40 hover:text-white/70"
            }`}
          >
            By Year/Make/Model
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {mode === "vin" ? (
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm font-medium text-white/70 mb-2">
                <Car className="size-4 text-accent" />
                VIN <span className="text-white/30 font-normal">(17 characters)</span>
              </label>
              <input
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                maxLength={17}
                placeholder="4T1BF1FK5CU123456"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 font-mono tracking-wider text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition placeholder:text-white/20"
              />
              <div className="mt-1.5 h-1 w-full rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent to-accent-2 transition-all duration-300"
                  style={{ width: `${Math.min(100, (vin.trim().length / 17) * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="sm:col-span-2 grid grid-cols-3 gap-3">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-white/70 mb-2">
                  <Car className="size-4 text-accent" />
                  Year
                </label>
                <input
                  value={manualYear}
                  onChange={(e) => setManualYear(e.target.value)}
                  maxLength={4}
                  placeholder="2022"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition placeholder:text-white/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-white/70 mb-2 block">Make</label>
                <input
                  value={manualMake}
                  onChange={(e) => setManualMake(e.target.value)}
                  placeholder="Hyundai"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition placeholder:text-white/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-white/70 mb-2 block">Model</label>
                <input
                  value={manualModel}
                  onChange={(e) => setManualModel(e.target.value)}
                  placeholder="Elantra"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition placeholder:text-white/20"
                />
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 text-sm font-medium text-white/70">
                <Gauge className="size-4 text-accent" />
                Current {unit === "mi" ? "mileage" : "kilometers"}
              </label>
              <div className="flex rounded-lg border border-white/10 overflow-hidden text-[11px]">
                <button
                  type="button"
                  onClick={() => setUnit("mi")}
                  className={`px-2 py-1 transition ${unit === "mi" ? "bg-accent/20 text-accent" : "text-white/40"}`}
                >
                  mi
                </button>
                <button
                  type="button"
                  onClick={() => setUnit("km")}
                  className={`px-2 py-1 transition ${unit === "km" ? "bg-accent/20 text-accent" : "text-white/40"}`}
                >
                  km
                </button>
              </div>
            </div>
            <input
              type="number"
              min={0}
              max={800000}
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 text-sm font-medium text-white/70 mb-2">
              <FileText className="size-4 text-accent" />
              Dealer / shop quote <span className="text-white/30 font-normal">(optional, comma-separated)</span>
            </label>
            <textarea
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              rows={2}
              placeholder="Transmission flush, Timing belt replacement, Cabin air filter, Wiper blades"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition resize-none placeholder:text-white/20"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 text-sm font-medium text-white/70 mb-2">
              <Gauge className="size-4 text-accent" />
              Driving conditions <span className="text-white/30 font-normal">(optional)</span>
            </label>
            <textarea
              value={drivingConditions}
              onChange={(e) => setDrivingConditions(e.target.value)}
              rows={2}
              placeholder="e.g. I tow a small trailer most weekends, lots of short trips in winter"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition resize-none placeholder:text-white/20"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!canSubmit || loading}
          className="mt-6 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-2 px-6 py-3 text-sm font-semibold text-black disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] transition"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="size-4" />
              Run the agent
              <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </form>

      <AnimatePresence>
        {trace.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass rounded-2xl mt-4 p-5 font-mono text-xs text-white/60"
          >
            <div className="flex items-center gap-2 text-white/40 mb-2 text-[11px] uppercase tracking-wider">
              <Terminal className="size-3.5" />
              Agent reasoning trace
            </div>
            <div className="space-y-1.5">
              {trace.map((t, i) => (
                <motion.div
                  key={`${t.id}-${i}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-start gap-2"
                >
                  <span className="text-accent/70">›</span>
                  <span>{t.label}</span>
                </motion.div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-white/30">
                  <span className="text-accent/70">›</span>
                  <span className="inline-flex gap-1">
                    <span className="size-1 rounded-full bg-white/40 animate-bounce [animation-delay:-0.3s]" />
                    <span className="size-1 rounded-full bg-white/40 animate-bounce [animation-delay:-0.15s]" />
                    <span className="size-1 rounded-full bg-white/40 animate-bounce" />
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-4 rounded-2xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger"
        >
          {error}
        </motion.div>
      )}

      <AnimatePresence>
        {findings && (
          <ResultsView
            key={`${findings.vehicle.year}-${findings.vehicle.make}-${findings.vehicle.model}`}
            findings={findings}
            unit={unit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ResultsView({ findings, unit }: { findings: Findings; unit: "mi" | "km" }) {
  const { vehicle, mileage, items, quoteVerdicts, summary, exactMatch, scheduleSource } = findings;
  const displayMileage = unit === "km" ? milesToKm(mileage) : mileage;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mt-6 space-y-5"
    >
      {/* Vehicle summary */}
      <div className="glass rounded-2xl p-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <VehicleIcon model={vehicle.model} className="size-12" />
          <div>
            <div className="text-lg font-semibold">
              {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.trim ? `· ${vehicle.trim}` : ""}
            </div>
            <div className="text-sm text-white/40">
              {displayMileage.toLocaleString()} {unit === "mi" ? "miles" : "km"} on the odometer
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {findings.dutyClassification === "severe" && (
            <div
              className="text-xs px-3 py-1.5 rounded-full border border-warn/30 bg-warn/10 text-warn"
              title={findings.dutyReason}
            >
              Severe-duty driving
            </div>
          )}
          {!exactMatch && (
            <div className="text-xs px-3 py-1.5 rounded-full border border-warn/30 bg-warn/10 text-warn">
              Generic schedule estimate — not model-exact
            </div>
          )}
        </div>
      </div>

      {/* Summary callout */}
      <div className="glass rounded-2xl p-6 border-l-2 border-l-accent/50">
        <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">Bottom line</div>
        <p className="text-white/90 leading-relaxed">{summary}</p>
      </div>

      {/* Quote audit, if a quote was given */}
      {quoteVerdicts.length > 0 && (
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center gap-2 text-sm font-semibold mb-4">
            <Wrench className="size-4 text-accent" />
            Dealer quote audit
          </div>
          <div className="space-y-2.5">
            {quoteVerdicts.map((qv, i) => {
              const meta = VERDICT_META[qv.verdict];
              const Icon = meta.Icon;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium text-sm">{qv.item}</div>
                    <span
                      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${meta.color}`}
                    >
                      <Icon className="size-3" />
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-xs text-white/50 mt-1.5 leading-relaxed">{qv.explanation}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Full schedule status */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold">Manufacturer maintenance schedule</div>
          <div className="text-[11px] text-white/30">{scheduleSource}</div>
        </div>
        <div className="grid sm:grid-cols-2 gap-2.5">
          {items.map((item, i) => {
            const meta = STATUS_META[item.status];
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">{item.service}</div>
                  <span className={`shrink-0 size-2 rounded-full mt-1.5 ${meta.dot}`} />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${meta.color}`}>
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-white/40">
                    {unit === "km" ? convertMilesInfoToKm(item.milesInfo) : item.milesInfo}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
