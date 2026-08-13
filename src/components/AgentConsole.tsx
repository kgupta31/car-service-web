"use client";

import { useEffect, useRef, useState } from "react";
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
  Copy,
  Check,
  Image as ImageIcon,
  X,
  MapPin,
  Search,
  ExternalLink,
  ShieldAlert,
  Hammer,
  ListChecks,
  Share2,
} from "lucide-react";
import type { AgentEvent, Findings } from "@/lib/types";
import { kmToMiles, milesToKm, convertMilesInfoToKm } from "@/lib/units";
import { compressImageToDataUrl } from "@/lib/image";
import { encodeFindings, decodeFindings } from "@/lib/share";
import { VehicleIcon } from "@/components/VehicleIcon";
import { FollowupChat } from "@/components/FollowupChat";
import { PastAuditsList } from "@/components/PastAuditsList";
import {
  vehicleIdentifier,
  historyIdentifier,
  getVehicleHistory,
  saveAuditToHistory,
  summarizeHistoryForPrompt,
  getCachedSchedule,
  saveCachedSchedule,
  type AuditRecord,
} from "@/lib/vehicleHistory";
import type { ScheduleResult } from "@/lib/tools";

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

function priceComparisonBadge(
  pc: NonNullable<Findings["quoteVerdicts"][number]["priceComparison"]>,
  priceQuoted: number | undefined
): { text: string; color: string } {
  const range = `typical $${Math.round(pc.typicalLow).toLocaleString()}-${Math.round(
    pc.typicalHigh
  ).toLocaleString()}`;
  if (pc.verdict === "unknown" || priceQuoted === undefined) {
    return { text: range, color: "text-white/50 border-white/20 bg-white/5" };
  }
  const quotedText = `$${Math.round(priceQuoted).toLocaleString()} quoted · ${range}`;
  if (pc.verdict === "over") {
    return { text: `${quotedText} · over typical range`, color: "text-danger border-danger/30 bg-danger/10" };
  }
  if (pc.verdict === "under") {
    return { text: `${quotedText} · under typical range`, color: "text-accent border-accent/30 bg-accent/10" };
  }
  return { text: `${quotedText} · in range`, color: "text-ok border-ok/30 bg-ok/10" };
}

const PRIORITY_META: Record<"safety" | "soon" | "can_wait", { label: string; color: string }> = {
  safety: { label: "Do first — safety", color: "text-danger border-danger/30 bg-danger/10" },
  soon: { label: "Soon", color: "text-warn border-warn/30 bg-warn/10" },
  can_wait: { label: "Can wait", color: "text-ok border-ok/30 bg-ok/10" },
};

export default function AgentConsole() {
  const [mode, setMode] = useState<"vin" | "manual">("vin");
  const [vin, setVin] = useState("");
  const [manualYear, setManualYear] = useState("");
  const [manualMake, setManualMake] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [mileage, setMileage] = useState<string>("60000");
  const [unit, setUnit] = useState<"mi" | "km">("mi");
  const [quoteRows, setQuoteRows] = useState<{ service: string; price: string }[]>([
    { service: "", price: "" },
  ]);
  const [quoteMode, setQuoteMode] = useState<"text" | "photo">("text");
  const [quoteImage, setQuoteImage] = useState<string | null>(null);
  const [quoteImageError, setQuoteImageError] = useState<string | null>(null);
  const [compressingImage, setCompressingImage] = useState(false);
  const [drivingConditions, setDrivingConditions] = useState("");
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [findings, setFindings] = useState<Findings | null>(null);
  const [isSharedView, setIsSharedView] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastAudits, setPastAudits] = useState<AuditRecord[]>([]);
  const traceIdRef = useRef(0);
  const quoteImageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // History is VIN-only — year/make/model isn't a safe match since many
    // people own the same model. See historyIdentifier in vehicleHistory.ts.
    setPastAudits(getVehicleHistory(historyIdentifier(mode, vin))?.audits ?? []);
  }, [mode, vin]);

  // A shared audit arrives as ?r=<compressed findings>. Render it read-only;
  // never write someone else's car into this browser's vehicle history.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("r");
    if (!param) return;
    decodeFindings(param).then((shared) => {
      if (shared) {
        setFindings(shared);
        setIsSharedView(true);
      }
    });
  }, []);

  const vinValid = vin.trim().length === 17;
  const manualValid =
    /^\d{4}$/.test(manualYear.trim()) && manualMake.trim().length > 0 && manualModel.trim().length > 0;
  const vehicleValid = mode === "vin" ? vinValid : manualValid;
  const photoModeReady = quoteMode !== "photo" || (Boolean(quoteImage) && !compressingImage);
  const canSubmit = vehicleValid && photoModeReady;

  async function handleQuoteImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setQuoteImageError(null);
    setCompressingImage(true);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setQuoteImage(dataUrl);
    } catch (err) {
      setQuoteImageError((err as Error).message);
      setQuoteImage(null);
    } finally {
      setCompressingImage(false);
      // Reset so re-selecting the same file (e.g. after "Remove") still fires onChange —
      // browsers skip the event if the input's value string is unchanged.
      if (quoteImageInputRef.current) quoteImageInputRef.current.value = "";
    }
  }

  function updateQuoteRow(index: number, field: "service" | "price", value: string) {
    setQuoteRows((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function addQuoteRow() {
    setQuoteRows((rows) => [...rows, { service: "", price: "" }]);
  }

  function removeQuoteRow(index: number) {
    setQuoteRows((rows) => (rows.length === 1 ? rows : rows.filter((_, i) => i !== index)));
  }

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
    // Schedule caching is safe to key by year/make/model (same manufacturer
    // schedule for every unit); history is VIN-only — see historyIdentifier.
    const identifier = vehicleIdentifier(mode, vin, manualYear, manualMake, manualModel);
    const historyNote = summarizeHistoryForPrompt(getVehicleHistory(historyIdentifier(mode, vin)));
    const cachedSchedule = getCachedSchedule(identifier);
    const effectiveQuote =
      quoteMode === "photo"
        ? []
        : quoteRows
            .map((r) => ({
              service: r.service.trim(),
              price:
                r.price.trim().length > 0 && Number.isFinite(Number(r.price)) && Number(r.price) > 0
                  ? Number(r.price)
                  : undefined,
            }))
            .filter((r) => r.service.length > 0);
    const effectiveQuoteImage = quoteMode === "photo" ? quoteImage || undefined : undefined;

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "vin"
            ? {
                mode,
                vin: vin.trim(),
                mileage: mileageMiles,
                quote: effectiveQuote,
                drivingConditions,
                historyNote,
                quoteImage: effectiveQuoteImage,
                zip: zip.trim(),
                cachedSchedule,
              }
            : {
                mode,
                year: manualYear.trim(),
                make: manualMake.trim(),
                model: manualModel.trim(),
                mileage: mileageMiles,
                quote: effectiveQuote,
                drivingConditions,
                historyNote,
                quoteImage: effectiveQuoteImage,
                zip: zip.trim(),
                cachedSchedule,
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
      let settled = false;

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
                : `Researching the real ${[event.input.year, event.input.make, event.input.model]
                    .filter(Boolean)
                    .join(" ")} maintenance schedule...`;
            pushTrace(label);
          } else if (event.type === "tool_result") {
            pushTrace(`✓ ${event.name} returned a result`);
            if (event.name === "get_maintenance_schedule") {
              saveCachedSchedule(identifier, event.result as ScheduleResult);
            }
          } else if (event.type === "final") {
            pushTrace("✓ Compiling findings...");
            setFindings(event.findings);
            const historyId = historyIdentifier(mode, vin);
            saveAuditToHistory(historyId, event.findings);
            setPastAudits(getVehicleHistory(historyId)?.audits ?? []);
            settled = true;
          } else if (event.type === "error") {
            setError(event.message);
            settled = true;
          }
        }
      }

      // The connection can close (function timeout, crash, network drop) without
      // ever sending a final/error event. Without this, the UI would just sit on
      // the trace forever with no result and no explanation.
      if (!settled) {
        setError(
          "The request was cut off before finishing — this can happen when a photo or price " +
            "lookup takes too long. Try again, or leave the photo/price fields empty for a faster result."
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      {isSharedView && (
        <div className="glass rounded-2xl mb-4 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-white/60">You&apos;re viewing a shared audit.</div>
          <a
            href="/"
            className="text-xs font-medium text-accent hover:underline"
          >
            Run your own →
          </a>
        </div>
      )}
      <PastAuditsList audits={pastAudits} />
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
              <p className="sm:col-span-3 text-[11px] text-white/30">
                Without a VIN, audit history is shared across any vehicle with this same year/make/model.
              </p>
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
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 text-sm font-medium text-white/70">
                <FileText className="size-4 text-accent" />
                Dealer / shop quote <span className="text-white/30 font-normal">(optional)</span>
              </label>
              <div className="flex rounded-lg border border-white/10 overflow-hidden text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setQuoteMode("text");
                    setQuoteImage(null);
                    setQuoteImageError(null);
                  }}
                  className={`px-2 py-1 transition ${
                    quoteMode === "text" ? "bg-accent/20 text-accent" : "text-white/40"
                  }`}
                >
                  Type it in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuoteMode("photo");
                    setQuoteRows([{ service: "", price: "" }]);
                  }}
                  className={`px-2 py-1 transition ${
                    quoteMode === "photo" ? "bg-accent/20 text-accent" : "text-white/40"
                  }`}
                >
                  Upload a photo
                </button>
              </div>
            </div>
            {quoteMode === "text" ? (
              <div className="space-y-2">
                {quoteRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={row.service}
                      onChange={(e) => updateQuoteRow(i, "service", e.target.value)}
                      placeholder={i === 0 ? "e.g. Transmission flush" : "Another service"}
                      className="flex-1 min-w-0 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition placeholder:text-white/20"
                    />
                    <div className="relative w-20 sm:w-28 shrink-0">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm pointer-events-none">
                        $
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={row.price}
                        onChange={(e) => updateQuoteRow(i, "price", e.target.value)}
                        placeholder="optional"
                        className="w-full rounded-xl bg-white/5 border border-white/10 pl-6 pr-3 py-2.5 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition placeholder:text-white/20"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeQuoteRow(i)}
                      disabled={quoteRows.length === 1}
                      className="shrink-0 text-white/30 hover:text-white/60 disabled:opacity-20 disabled:cursor-not-allowed transition p-1"
                      aria-label="Remove this service"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addQuoteRow} className="text-xs text-accent hover:underline">
                  + Add another service
                </button>
              </div>
            ) : (
              <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
                <label className="inline-flex items-center gap-2 text-xs text-white/60 cursor-pointer">
                  <ImageIcon className="size-4 text-accent" />
                  Choose a photo of your quote
                  <input
                    ref={quoteImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleQuoteImageChange}
                    className="hidden"
                  />
                </label>
                {compressingImage && <p className="text-xs text-white/40 mt-2">Processing image...</p>}
                {quoteImageError && <p className="text-xs text-danger mt-2">{quoteImageError}</p>}
                {quoteImage && !compressingImage && (
                  <div className="mt-3 flex items-center gap-3">
                    <img
                      src={quoteImage}
                      alt="Quote preview"
                      className="h-16 w-16 object-cover rounded-lg border border-white/10"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setQuoteImage(null);
                        if (quoteImageInputRef.current) quoteImageInputRef.current.value = "";
                      }}
                      className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition"
                    >
                      <X className="size-3.5" />
                      Remove
                    </button>
                  </div>
                )}
              </div>
            )}
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

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-white/70 mb-2">
              <MapPin className="size-4 text-accent" />
              ZIP / region <span className="text-white/30 font-normal">(optional)</span>
            </label>
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="94105"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition"
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
        {quoteMode === "photo" && !photoModeReady && !compressingImage && (
          <p className="mt-2 text-[11px] text-white/30">Choose a photo of your quote to continue.</p>
        )}
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
            isSharedView={isSharedView}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ResultsView({
  findings,
  unit,
  isSharedView,
}: {
  findings: Findings;
  unit: "mi" | "km";
  isSharedView?: boolean;
}) {
  const {
    vehicle,
    mileage,
    items,
    quoteVerdicts,
    summary,
    exactMatch,
    scheduleSource,
    disputeDraft,
    transcribedItems,
    scheduleSources,
    recalls,
    actionPlan,
  } = findings;
  // All items share one batched search, so sources are the same across
  // every priceComparison that has any — take the first, not per item.
  const priceSources = quoteVerdicts.find((qv) => qv.priceComparison)?.priceComparison?.sources ?? [];
  const displayMileage = unit === "km" ? milesToKm(mileage) : mileage;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copyDisputeDraft() {
    if (!disputeDraft) return;
    try {
      await navigator.clipboard.writeText(disputeDraft);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  }

  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");

  async function copyShareLink() {
    const encoded = await encodeFindings(findings);
    if (!encoded) {
      setShareState("failed");
      setTimeout(() => setShareState("idle"), 2000);
      return;
    }
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?r=${encoded}`);
      setShareState("copied");
    } catch {
      setShareState("failed");
    }
    setTimeout(() => setShareState("idle"), 2000);
  }

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
          {!isSharedView && (
            <button
              type="button"
              onClick={copyShareLink}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 transition"
            >
              <Share2 className="size-3.5" />
              {shareState === "copied" ? "Link copied" : shareState === "failed" ? "Couldn't share" : "Share"}
            </button>
          )}
          {findings.dutyClassification === "severe" && (
            <div
              className="text-xs px-3 py-1.5 rounded-full border border-warn/30 bg-warn/10 text-warn"
              title={findings.dutyReason}
            >
              Severe-duty driving
            </div>
          )}
          {exactMatch ? (
            <div className="text-xs px-3 py-1.5 rounded-full border border-ok/30 bg-ok/10 text-ok">
              Real manufacturer schedule
              {scheduleSources && scheduleSources.length > 0
                ? ` · ${scheduleSources.length} source${scheduleSources.length === 1 ? "" : "s"}`
                : ""}
            </div>
          ) : (
            <div className="text-xs px-3 py-1.5 rounded-full border border-warn/30 bg-warn/10 text-warn">
              Generic estimate — no model-specific schedule found
            </div>
          )}
        </div>
      </div>

      {/* Summary callout */}
      <div className="glass rounded-2xl p-6 border-l-2 border-l-accent/50">
        <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">Bottom line</div>
        <p className="text-white/90 leading-relaxed">{summary}</p>
      </div>

      {/* Open recalls — safety-relevant and free to fix, so it outranks pricing */}
      {recalls && recalls.count > 0 && (
        <div className="glass rounded-2xl p-6 border-l-2 border-l-danger/50">
          <div className="flex items-center gap-2 text-sm font-semibold mb-2">
            <ShieldAlert className="size-4 text-danger" />
            {recalls.count} open recall{recalls.count === 1 ? "" : "s"} reported for this model
          </div>
          <p className="text-xs text-white/50 leading-relaxed mb-4">
            Recall repairs are <span className="text-white/80">free at any dealer</span>. This lookup
            is by year/make/model, so it may not apply to every car built that year —{" "}
            <a
              href="https://www.nhtsa.gov/recalls"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline inline-flex items-center gap-1"
            >
              confirm with your VIN at NHTSA
              <ExternalLink className="size-3" />
            </a>
            .
          </p>
          {recalls.count > recalls.items.length && (
            <p className="text-[11px] text-white/30 mb-3">
              Showing the {recalls.items.length} most recent of {recalls.count} — see all at NHTSA.
            </p>
          )}
          <div className="space-y-2.5">
            {recalls.items.map((r, i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium text-sm">{r.component}</div>
                  {r.campaignNumber && (
                    <span className="shrink-0 text-[11px] text-white/30 font-mono">
                      {r.campaignNumber}
                    </span>
                  )}
                </div>
                {r.summary && (
                  <p className="text-xs text-white/50 mt-1.5 leading-relaxed">{r.summary}</p>
                )}
                {r.remedy && (
                  <p className="text-xs text-ok/70 mt-1.5 leading-relaxed">Remedy: {r.remedy}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What we read from the photo, if one was uploaded */}
      {transcribedItems && transcribedItems.length > 0 && (
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center gap-2 text-sm font-semibold mb-3">
            <ImageIcon className="size-4 text-accent" />
            Read from your photo
          </div>
          <ul className="text-xs text-white/50 space-y-1 list-disc list-inside">
            {transcribedItems.map((item, i) => (
              <li key={i}>
                {item.service}
                {item.price !== undefined ? ` — $${item.price.toLocaleString()}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

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
                  <div className="mt-2 flex flex-wrap gap-2">
                    {qv.diy && (
                      <div className="inline-flex items-center gap-1.5 rounded-lg border border-ok/30 bg-ok/10 px-2.5 py-1 text-[11px] text-ok">
                        <Hammer className="size-3" />
                        DIY-able · ~{qv.diy.partCostRange} part · {qv.diy.minutes} min
                        <span className="text-ok/60">— {qv.diy.note}</span>
                      </div>
                    )}
                    {qv.priceComparison &&
                      (() => {
                        const badge = priceComparisonBadge(qv.priceComparison, qv.priceQuoted);
                        return (
                          <div
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${badge.color}`}
                          >
                            <Search className="size-3" />
                            {badge.text}
                          </div>
                        );
                      })()}
                  </div>
                </motion.div>
              );
            })}
          </div>
          {priceSources.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-[11px] text-white/30 mb-2">
                Typical price ranges are from web search, not a specific local shop's quote.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {priceSources.map((source, i) => (
                  <a
                    key={i}
                    href={source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-white/40 hover:text-accent transition"
                  >
                    <ExternalLink className="size-3" />
                    {(() => {
                      try {
                        return new URL(source).hostname.replace(/^www\./, "");
                      } catch {
                        return source;
                      }
                    })()}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Dispute draft, if the model produced one */}
      {disputeDraft && (
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-accent" />
              What to say
            </div>
            <button
              type="button"
              onClick={copyDisputeDraft}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 transition"
            >
              {copyState === "copied" && <Check className="size-3.5 text-ok" />}
              {copyState === "failed" && <AlertTriangle className="size-3.5 text-danger" />}
              {copyState === "idle" && <Copy className="size-3.5" />}
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
            </button>
          </div>
          <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">{disputeDraft}</p>
        </div>
      )}

      {/* Prioritized action plan */}
      {actionPlan && (
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center gap-2 text-sm font-semibold mb-3">
            <ListChecks className="size-4 text-accent" />
            Do this first
          </div>
          <p className="text-sm text-white/70 leading-relaxed mb-4">{actionPlan}</p>
          <div className="space-y-2">
            {(["safety", "soon"] as const).map((level) => {
              const group = items.filter((it) => it.priority === level);
              if (group.length === 0) return null;
              return (
                <div key={level} className="flex items-start gap-3 flex-wrap">
                  <span
                    className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border ${PRIORITY_META[level].color}`}
                  >
                    {PRIORITY_META[level].label}
                  </span>
                  <span className="text-xs text-white/60 leading-relaxed">
                    {group.map((it) => it.service).join(", ")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Full schedule status */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div className="text-sm font-semibold">Manufacturer maintenance schedule</div>
          <div className="text-[11px] text-white/30">{scheduleSource}</div>
        </div>
        {scheduleSources && scheduleSources.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1">
            {scheduleSources.map((source, i) => (
              <a
                key={i}
                href={source}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-white/40 hover:text-accent transition"
              >
                <ExternalLink className="size-3" />
                {(() => {
                  try {
                    return new URL(source).hostname.replace(/^www\./, "");
                  } catch {
                    return source;
                  }
                })()}
              </a>
            ))}
          </div>
        )}
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
                {item.diy && (
                  <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-ok/80">
                    <Hammer className="size-3" />
                    DIY ~{item.diy.partCostRange} · {item.diy.minutes} min
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>

      <FollowupChat findings={findings} />
    </motion.div>
  );
}
