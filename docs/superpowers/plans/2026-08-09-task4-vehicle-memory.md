# Task 4: Vehicle Memory Across Visits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember past audits for a given vehicle (by VIN, or by year+make+model for manual entries) in the browser's `localStorage`, so returning users see their audit history and the agent can flag likely duplicate billing when a previously-flagged item reappears in a new quote — a structural capability a stateless static computation can't have.

**Architecture:** Purely client-side storage (no database, no server-side persistence, no new env vars). A new `src/lib/vehicleHistory.ts` module owns the storage shape and read/write/summarize helpers. `AgentConsole.tsx` reads history to display it and to build a compact text summary sent to the server as part of the existing request body (`historyNote`), and writes to it after every successful audit. The server just threads `historyNote` into the prompt like `drivingConditions` already is — no new route, no new tool.

**Tech Stack:** Same as the rest of the app. No test runner — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual checks against a live dev server (including actually reloading the page to confirm `localStorage` persistence survives a refresh).

---

### Task 1: Vehicle memory

**Files:**
- Create: `src/lib/vehicleHistory.ts`
- Create: `src/components/PastAuditsList.tsx`
- Modify: `src/lib/agent.ts`
- Modify: `src/app/api/agent/route.ts`
- Modify: `src/components/AgentConsole.tsx`

- [ ] **Step 1: Create the vehicle-history storage module**

Create `src/lib/vehicleHistory.ts`:

```ts
import type { Findings, QuoteVerdict } from "./types";

export type AuditRecord = {
  timestamp: number;
  mileage: number;
  quoteVerdicts: QuoteVerdict[];
  summary: string;
};

export type VehicleHistory = {
  vehicle: { year: string; make: string; model: string };
  audits: AuditRecord[];
};

const STORAGE_PREFIX = "serviceaudit:history:";
const MAX_AUDITS_PER_VEHICLE = 10;

// A VIN identifies a vehicle uniquely; without one, year+make+model is the
// best available proxy (imprecise across owners of the same model, but
// this is a client-only convenience feature, not a source of truth).
export function vehicleIdentifier(
  mode: "vin" | "manual",
  vin: string,
  year: string,
  make: string,
  model: string
): string | null {
  if (mode === "vin") {
    const trimmed = vin.trim().toUpperCase();
    return trimmed.length === 17 ? trimmed : null;
  }
  const y = year.trim();
  const mk = make.trim();
  const md = model.trim();
  if (!y || !mk || !md) return null;
  return `${y}|${mk}|${md}`.toUpperCase();
}

function storageKey(identifier: string): string {
  return `${STORAGE_PREFIX}${identifier}`;
}

export function getVehicleHistory(identifier: string | null): VehicleHistory | null {
  if (!identifier || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(identifier));
    if (!raw) return null;
    return JSON.parse(raw) as VehicleHistory;
  } catch {
    return null;
  }
}

export function saveAuditToHistory(identifier: string | null, findings: Findings): void {
  if (!identifier || typeof window === "undefined") return;
  try {
    const existing = getVehicleHistory(identifier);
    const record: AuditRecord = {
      timestamp: Date.now(),
      mileage: findings.mileage,
      quoteVerdicts: findings.quoteVerdicts,
      summary: findings.summary,
    };
    const audits = [...(existing?.audits ?? []), record].slice(-MAX_AUDITS_PER_VEHICLE);
    const history: VehicleHistory = {
      vehicle: {
        year: findings.vehicle.year,
        make: findings.vehicle.make,
        model: findings.vehicle.model,
      },
      audits,
    };
    window.localStorage.setItem(storageKey(identifier), JSON.stringify(history));
  } catch {
    // localStorage unavailable or full — this is a nicety, not core functionality.
  }
}

export function summarizeHistoryForPrompt(history: VehicleHistory | null): string {
  if (!history || history.audits.length === 0) return "";
  const lines = history.audits.map((a) => {
    const date = new Date(a.timestamp).toLocaleDateString();
    const items =
      a.quoteVerdicts.length > 0
        ? a.quoteVerdicts.map((qv) => `${qv.item} (${qv.verdict})`).join(", ")
        : "no quote given";
    return `- ${date} at ${a.mileage.toLocaleString()} miles: ${items}`;
  });
  return lines.join("\n");
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Create the "Past audits" collapsible list component**

Create `src/components/PastAuditsList.tsx`:

```tsx
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
```

- [ ] **Step 4: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Add the duplicate-billing instruction and thread `historyNote` in `agent.ts`**

In `src/lib/agent.ts`, in `SYSTEM_PROMPT`, replace the final instruction line:

```
8. Finish by calling present_findings with the full structured result — this IS your final answer,
   do not also write a text response after it. Include a concise plain-English summary sentence.`;
```

with:

```
8. If the user's message includes prior audit history for this vehicle, check whether any
   currently-quoted item was already flagged as "premature" or "not_on_schedule" in a past audit
   at a similar mileage (within ~2,000 miles). If so, explicitly call this out as likely duplicate
   billing in the summary — the same or a different shop may be re-quoting something already
   flagged.
9. Finish by calling present_findings with the full structured result — this IS your final answer,
   do not also write a text response after it. Include a concise plain-English summary sentence.`;
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Thread `historyNote` through the API route**

In `src/app/api/agent/route.ts`, replace the `buildUserMessage` signature and body:

```ts
function buildUserMessage(
  vehicle: VehicleInput,
  mileage: number,
  quoteItems: string[],
  drivingConditions: string
): string {
  let msg: string;
  if ("vin" in vehicle) {
    msg = `My VIN is ${vehicle.vin} and my current mileage is ${mileage}.\n`;
  } else {
    const { year, make, model } = vehicle.manual;
    msg =
      `My vehicle is a ${year} ${make} ${model}. I don't have the VIN, so skip vin_decode and go ` +
      `straight to looking up the maintenance schedule for this make/model. My current mileage is ${mileage}.\n`;
  }

  if (quoteItems.length > 0) {
    const items = quoteItems.map((s) => `- ${s.trim()}`).join("\n");
    msg +=
      `\nMy dealership/shop has proposed the following services:\n${items}\n\n` +
      "Tell me which of these are actually justified right now, which are premature, " +
      "and which aren't on the manufacturer schedule at all.";
  } else {
    msg +=
      "\nNo quote was given to me yet. Just tell me what's overdue, what's due now, " +
      "and what's coming up soon based on my mileage.";
  }

  if (drivingConditions.trim().length > 0) {
    msg += `\n\nHere's how I actually drive this vehicle: ${drivingConditions.trim()}`;
  }

  return msg;
}
```

with:

```ts
function buildUserMessage(
  vehicle: VehicleInput,
  mileage: number,
  quoteItems: string[],
  drivingConditions: string,
  historyNote: string
): string {
  let msg: string;
  if ("vin" in vehicle) {
    msg = `My VIN is ${vehicle.vin} and my current mileage is ${mileage}.\n`;
  } else {
    const { year, make, model } = vehicle.manual;
    msg =
      `My vehicle is a ${year} ${make} ${model}. I don't have the VIN, so skip vin_decode and go ` +
      `straight to looking up the maintenance schedule for this make/model. My current mileage is ${mileage}.\n`;
  }

  if (quoteItems.length > 0) {
    const items = quoteItems.map((s) => `- ${s.trim()}`).join("\n");
    msg +=
      `\nMy dealership/shop has proposed the following services:\n${items}\n\n` +
      "Tell me which of these are actually justified right now, which are premature, " +
      "and which aren't on the manufacturer schedule at all.";
  } else {
    msg +=
      "\nNo quote was given to me yet. Just tell me what's overdue, what's due now, " +
      "and what's coming up soon based on my mileage.";
  }

  if (drivingConditions.trim().length > 0) {
    msg += `\n\nHere's how I actually drive this vehicle: ${drivingConditions.trim()}`;
  }

  if (historyNote.trim().length > 0) {
    msg += `\n\nThis vehicle has prior audit history:\n${historyNote.trim()}`;
  }

  return msg;
}
```

Then update the `POST` handler. Replace:

```ts
  const body = await req.json();
  const { mode, vin, year, make, model, mileage, quote, drivingConditions } = body as {
    mode?: "vin" | "manual";
    vin?: string;
    year?: string;
    make?: string;
    model?: string;
    mileage?: number;
    quote?: string;
    drivingConditions?: string;
  };
```

with:

```ts
  const body = await req.json();
  const { mode, vin, year, make, model, mileage, quote, drivingConditions, historyNote } = body as {
    mode?: "vin" | "manual";
    vin?: string;
    year?: string;
    make?: string;
    model?: string;
    mileage?: number;
    quote?: string;
    drivingConditions?: string;
    historyNote?: string;
  };
```

And replace the `buildUserMessage` call:

```ts
  const userMessage = buildUserMessage(vehicleInput, mileage, quoteItems, drivingConditions || "");
```

with:

```ts
  const userMessage = buildUserMessage(
    vehicleInput,
    mileage,
    quoteItems,
    drivingConditions || "",
    historyNote || ""
  );
```

- [ ] **Step 8: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Wire history into `AgentConsole.tsx`**

Add the `useEffect` import. Replace:

```ts
import { useRef, useState } from "react";
```

with:

```ts
import { useEffect, useRef, useState } from "react";
```

Add the new imports after the existing `VehicleIcon`/`FollowupChat` imports. Replace:

```ts
import { VehicleIcon } from "@/components/VehicleIcon";
import { FollowupChat } from "@/components/FollowupChat";
```

with:

```ts
import { VehicleIcon } from "@/components/VehicleIcon";
import { FollowupChat } from "@/components/FollowupChat";
import { PastAuditsList } from "@/components/PastAuditsList";
import {
  vehicleIdentifier,
  getVehicleHistory,
  saveAuditToHistory,
  summarizeHistoryForPrompt,
  type AuditRecord,
} from "@/lib/vehicleHistory";
```

Add `pastAudits` state and an effect that loads history whenever the identified vehicle changes. Replace:

```ts
  const [error, setError] = useState<string | null>(null);
  const traceIdRef = useRef(0);

  const vinValid = vin.trim().length === 17;
```

with:

```ts
  const [error, setError] = useState<string | null>(null);
  const [pastAudits, setPastAudits] = useState<AuditRecord[]>([]);
  const traceIdRef = useRef(0);

  useEffect(() => {
    const identifier = vehicleIdentifier(mode, vin, manualYear, manualMake, manualModel);
    setPastAudits(getVehicleHistory(identifier)?.audits ?? []);
  }, [mode, vin, manualYear, manualMake, manualModel]);

  const vinValid = vin.trim().length === 17;
```

Compute the identifier/history-note in `runAgent` and use it in both the request body and the `final` handler. Replace:

```ts
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
```

with:

```ts
    const mileageMiles = unit === "km" ? kmToMiles(Number(mileage)) : Number(mileage);
    const identifier = vehicleIdentifier(mode, vin, manualYear, manualMake, manualModel);
    const historyNote = summarizeHistoryForPrompt(getVehicleHistory(identifier));

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "vin"
            ? { mode, vin: vin.trim(), mileage: mileageMiles, quote, drivingConditions, historyNote }
            : {
                mode,
                year: manualYear.trim(),
                make: manualMake.trim(),
                model: manualModel.trim(),
                mileage: mileageMiles,
                quote,
                drivingConditions,
                historyNote,
              }
        ),
      });
```

Save to history when a `final` event lands. Replace:

```ts
          } else if (event.type === "final") {
            pushTrace("✓ Compiling findings...");
            setFindings(event.findings);
          } else if (event.type === "error") {
```

with:

```ts
          } else if (event.type === "final") {
            pushTrace("✓ Compiling findings...");
            setFindings(event.findings);
            saveAuditToHistory(identifier, event.findings);
            setPastAudits(getVehicleHistory(identifier)?.audits ?? []);
          } else if (event.type === "error") {
```

- [ ] **Step 10: Render the past-audits list above the form**

Replace:

```tsx
  return (
    <div className="w-full max-w-3xl mx-auto">
      <form
```

with:

```tsx
  return (
    <div className="w-full max-w-3xl mx-auto">
      <PastAuditsList audits={pastAudits} />
      <form
```

- [ ] **Step 11: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 12: Manual verification**

Run: `npm run dev`. In the browser:
  1. Submit an audit for a specific VIN with a quote that includes an item you expect to be flagged `premature` or `not_on_schedule`.
  2. Reload the page (full refresh, not just client navigation) and enter the SAME VIN again (don't submit yet) — confirm the "Past audits for this vehicle (1)" collapsible appears above the form, and expanding it shows the correct date/mileage/verdict summary from step 1.
  3. Submit a second audit for the same VIN, at a similar mileage, with the SAME quote item that was flagged premature/not-on-schedule before. Confirm the new audit's summary explicitly calls out likely duplicate billing.
  4. Confirm a completely different VIN shows no past-audits list (empty history).
  Kill the dev server when done.

- [ ] **Step 13: Commit**

```bash
git add src/lib/vehicleHistory.ts src/components/PastAuditsList.tsx src/lib/agent.ts src/app/api/agent/route.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Add vehicle memory across visits via localStorage

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 2: Regression check**

Manually confirm: the main VIN/manual-entry flow, km/mi toggle, severe-duty badge, dispute-draft card, follow-up chat, and full schedule card all still work exactly as before — vehicle memory is purely additive and degrades gracefully (no crash) if `localStorage` is unavailable (e.g. private browsing with storage disabled — the `try/catch` guards in `vehicleHistory.ts` should make this a silent no-op, not an error).
