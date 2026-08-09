# Task 1: Severe-Duty Driving-Condition Judgment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user optionally describe their driving conditions (towing, dusty climate, short trips, etc.) and have the agent judge whether that qualifies as "severe duty" per common manufacturer definitions, tightening its read of the maintenance schedule and saying so explicitly — a genuine judgment call from free text, not a lookup.

**Architecture:** Purely additive. One new optional form field → one new optional field in the POST body → one new sentence of user-message context → one new system-prompt instruction → two new optional fields on the `present_findings` tool schema and the `Findings` type → one new badge in the results UI. No new tools, no new routes, no new dependencies.

**Tech Stack:** Same as the rest of the app (Next.js App Router, TypeScript, the existing Groq/OpenAI-SDK agent loop). No test runner exists in this project — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual checks against a live dev server, consistent with prior work in this codebase.

---

### Task 1: Severe-duty judgment

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/agent.ts`
- Modify: `src/app/api/agent/route.ts`
- Modify: `src/components/AgentConsole.tsx`

- [ ] **Step 1: Add the new fields to the `Findings` type**

In `src/lib/types.ts`, replace:

```ts
export type Findings = {
  vehicle: { year: string; make: string; model: string; trim?: string };
  mileage: number;
  scheduleSource: string;
  exactMatch: boolean;
  items: FindingsItem[];
  quoteVerdicts: QuoteVerdict[];
  summary: string;
};
```

with:

```ts
export type DutyClassification = "normal" | "severe";

export type Findings = {
  vehicle: { year: string; make: string; model: string; trim?: string };
  mileage: number;
  scheduleSource: string;
  exactMatch: boolean;
  items: FindingsItem[];
  quoteVerdicts: QuoteVerdict[];
  summary: string;
  dutyClassification?: DutyClassification;
  dutyReason?: string;
};
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors (nothing consumes the new optional fields yet, so this should be a no-op change type-wise).

- [ ] **Step 3: Add the system-prompt instruction and tool-schema fields in `agent.ts`**

In `src/lib/agent.ts`, in `SYSTEM_PROMPT`, the numbered list currently ends at item 6 with:

```
6. Finish by calling present_findings with the full structured result — this IS your final answer,
   do not also write a text response after it. Include a concise plain-English summary sentence.`;
```

Replace that whole line block with:

```
6. If the user described their driving conditions, judge whether that qualifies as "severe duty"
   under common manufacturer definitions — frequent towing/hauling, dusty or off-road conditions,
   extensive idling or very short trips (under ~10 minutes), extreme heat or cold, or heavy
   stop-and-go traffic. If it qualifies, say so explicitly and note that routine intervals
   (oil changes, fluid services) are commonly halved under severe-duty schedules — mention this
   in the summary and set dutyClassification to "severe" with a one-sentence dutyReason. If no
   driving-condition info was given, or it doesn't meet any severe-duty criteria, set
   dutyClassification to "normal".
7. Finish by calling present_findings with the full structured result — this IS your final answer,
   do not also write a text response after it. Include a concise plain-English summary sentence.`;
```

- [ ] **Step 4: Add the two new properties to `PRESENT_FINDINGS_TOOL`'s schema**

In the same file, in `PRESENT_FINDINGS_TOOL`, replace:

```ts
        summary: { type: "string" },
      },
      required: ["vehicle", "mileage", "scheduleSource", "exactMatch", "items", "quoteVerdicts", "summary"],
```

with:

```ts
        summary: { type: "string" },
        dutyClassification: { type: "string", enum: ["normal", "severe"] },
        dutyReason: { type: "string" },
      },
      required: ["vehicle", "mileage", "scheduleSource", "exactMatch", "items", "quoteVerdicts", "summary"],
```

(Leave `dutyClassification`/`dutyReason` out of `required` — the model should still be able to answer even if it has nothing meaningful to say there, e.g. no driving-condition info was given.)

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Thread `drivingConditions` through the API route**

In `src/app/api/agent/route.ts`, replace the `buildUserMessage` signature and body:

```ts
function buildUserMessage(vehicle: VehicleInput, mileage: number, quoteItems: string[]): string {
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
  return msg;
}
```

with:

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

Then update the `POST` handler. Replace:

```ts
  const body = await req.json();
  const { mode, vin, year, make, model, mileage, quote } = body as {
    mode?: "vin" | "manual";
    vin?: string;
    year?: string;
    make?: string;
    model?: string;
    mileage?: number;
    quote?: string;
  };
```

with:

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

And replace the `buildUserMessage` call:

```ts
  const userMessage = buildUserMessage(vehicleInput, mileage, quoteItems);
```

with:

```ts
  const userMessage = buildUserMessage(vehicleInput, mileage, quoteItems, drivingConditions || "");
```

- [ ] **Step 7: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Add the form field and wire it into the request body in `AgentConsole.tsx`**

In `src/components/AgentConsole.tsx`, add state next to the existing `quote` state. Replace:

```ts
  const [quote, setQuote] = useState("");
```

with:

```ts
  const [quote, setQuote] = useState("");
  const [drivingConditions, setDrivingConditions] = useState("");
```

Replace the fetch body construction:

```ts
        body: JSON.stringify(
          mode === "vin"
            ? { mode, vin: vin.trim(), mileage: mileageMiles, quote }
            : {
                mode,
                year: manualYear.trim(),
                make: manualMake.trim(),
                model: manualModel.trim(),
                mileage: mileageMiles,
                quote,
              }
        ),
```

with:

```ts
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
```

- [ ] **Step 9: Add the textarea to the form JSX**

Replace the dealer-quote `<div className="sm:col-span-2">...</div>` block (the one containing the `FileText` icon and quote textarea) — specifically, insert a new field right after it, still inside the same `<div className="grid sm:grid-cols-2 gap-4">` grid. Replace:

```tsx
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
        </div>
```

with:

```tsx
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
```

- [ ] **Step 10: Render the duty-classification badge in `ResultsView`**

Replace the vehicle-summary card's closing structure. Replace:

```tsx
        {!exactMatch && (
          <div className="text-xs px-3 py-1.5 rounded-full border border-warn/30 bg-warn/10 text-warn">
            Generic schedule estimate — not model-exact
          </div>
        )}
      </div>
```

with:

```tsx
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
```

- [ ] **Step 11: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 12: Manual verification**

Run: `npm run dev` (confirm `pwd`/`git branch --show-current` first if working in a worktree), open the app, fill in a VIN and mileage, and in the new "Driving conditions" field enter something clearly severe-duty (e.g. "I tow a boat every weekend and do a lot of short trips in the cold"). Submit and confirm:
  - The summary mentions severe duty.
  - The "Severe-duty driving" badge appears on the vehicle-summary card.
  Then submit again with the field left blank and confirm the badge does NOT appear and nothing else regresses (VIN mode and manual mode both still work, quote audit still works).

- [ ] **Step 13: Commit**

```bash
git add src/lib/types.ts src/lib/agent.ts src/app/api/agent/route.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Add severe-duty driving-condition judgment

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

Manually confirm, against the dev server: VIN mode still works end-to-end, manual entry mode still works, the km/mi toggle still works, the full manufacturer-schedule card is still complete, and the dealer-quote audit still renders when a quote is given — all independent of whether driving conditions are filled in.
