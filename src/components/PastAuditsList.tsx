"use client";

import { useState } from "react";
import { History, ChevronDown } from "lucide-react";
import type { AuditRecord } from "@/lib/vehicleHistory";

export function PastAuditsList({ audits }: { audits: AuditRecord[] }) {
  const [open, setOpen] = useState(false);
  if (audits.length === 0) return null;

  return (
    <div className="glass rounded-2xl mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-white/60">
          <History className="size-3.5 text-accent" />
          Past audits for this vehicle ({audits.length})
        </div>
        <ChevronDown className={`size-3.5 text-white/40 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {[...audits].reverse().map((a, i) => (
            <div key={i} className="rounded-lg bg-white/[0.03] border border-white/10 p-3 text-xs text-white/50">
              <span className="text-white/70">{new Date(a.timestamp).toLocaleDateString()}</span> at{" "}
              {a.mileage.toLocaleString()} miles
              {a.quoteVerdicts.length > 0 && (
                <span> — {a.quoteVerdicts.map((qv) => `${qv.item} (${qv.verdict})`).join(", ")}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
