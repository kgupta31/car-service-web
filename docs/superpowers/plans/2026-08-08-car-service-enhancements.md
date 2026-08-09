# Car Service Advisor Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the manufacturer schedule card reliably complete, add manual year/make/model entry as a VIN alternative, add a miles/km toggle, and show a real vehicle photo.

**Architecture:** All changes are additive to the existing three-file flow (`route.ts` → `agent.ts` → `tools.ts` on the server, `AgentConsole.tsx` on the client). No new API routes, no new dependencies, no database. The vehicle photo is a direct client-side `<img>` pointed at imagin.studio's public CDN.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind, framer-motion. No test runner exists in this project (`package.json` has no test script) — verification uses `npx tsc --noEmit`, `npm run lint`, and manual browser checks against the running dev server (`npm run dev`), consistent with how the rest of the codebase is currently verified.

---

### Task 1: Deterministic schedule-completeness safety net

**Files:**
- Modify: `src/lib/tools.ts`
- Modify: `src/lib/agent.ts`

- [ ] **Step 1: Add `computeScheduleItemStatus` to `tools.ts`**

Add this import near the top of `src/lib/tools.ts` (after the existing block comment, before `export type MaintenanceItem`):

```ts
import type { ItemStatus } from "./types";
```

Add this function after `getMaintenanceSchedule` (i.e., right after the closing `}` on what is currently line 130, before the `// ---...` OpenAI tool schemas comment):

```ts
// Deterministic status calc for one schedule item at a given mileage. Used
// as a fallback when the model's own findings.items is missing an entry —
// see fillMissingScheduleItems in agent.ts.
export function computeScheduleItemStatus(
  intervalMiles: number,
  mileage: number
): { status: ItemStatus; milesInfo: string } {
  const lastMultiple = Math.floor(mileage / intervalMiles) * intervalMiles;
  const nextMultiple = lastMultiple + intervalMiles;
  const sinceLast = mileage - lastMultiple;
  const untilNext = nextMultiple - mileage;

  if (lastMultiple > 0 && sinceLast <= 1000) {
    return {
      status: "due_now",
      milesInfo: `due now (passed at ${lastMultiple.toLocaleString()} mi)`,
    };
  }
  if (untilNext <= 1000) {
    return { status: "due_now", milesInfo: `due in ${untilNext.toLocaleString()} miles` };
  }
  if (lastMultiple > 0 && sinceLast > 1000) {
    return { status: "overdue", milesInfo: `${sinceLast.toLocaleString()} miles overdue` };
  }
  return { status: "not_due", milesInfo: `due in ${untilNext.toLocaleString()} miles` };
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Wire the safety net into `agent.ts`**

In `src/lib/agent.ts`, replace the import block (current lines 16-20):

```ts
import OpenAI from "openai";
import { TOOL_SCHEMAS, runTool } from "./tools";
import type { Findings, AgentEvent } from "./types";

export type { Findings, AgentEvent } from "./types";
```

with:

```ts
import OpenAI from "openai";
import { TOOL_SCHEMAS, runTool, computeScheduleItemStatus } from "./tools";
import type { ScheduleResult } from "./tools";
import type { Findings, FindingsItem, AgentEvent } from "./types";

export type { Findings, AgentEvent } from "./types";
```

Add this helper after `getClient()` (i.e., after the closing `}` currently on line 115, before `export async function* runAgent`):

```ts
function normalizeServiceName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Safety net: the system prompt instructs the model to return a status for
// every item in the manufacturer schedule, but nothing enforces that. Fill
// in anything it dropped so the UI always shows the complete schedule.
function fillMissingScheduleItems(
  findings: Findings,
  schedule: ScheduleResult | null,
  mileage: number
): Findings {
  if (!schedule || schedule.schedule.length === 0) return findings;

  const existing = findings.items.map((it) => normalizeServiceName(it.service));

  const missing = schedule.schedule.filter((si) => {
    const n = normalizeServiceName(si.service);
    return !existing.some((en) => en.includes(n) || n.includes(en));
  });

  if (missing.length === 0) return findings;

  const added: FindingsItem[] = missing.map((si) => {
    const { status, milesInfo } = computeScheduleItemStatus(si.interval_miles, mileage);
    return { service: si.service, category: si.category, status, milesInfo };
  });

  return { ...findings, items: [...findings.items, ...added] };
}
```

- [ ] **Step 4: Track the last schedule result and merge on final**

In `runAgent`, right after the line `const MAX_TURNS = 8;` (currently line 126), add:

```ts
let lastSchedule: ScheduleResult | null = null;
```

Then, inside the `for (const tc of toolCalls)` loop, right after the existing line:

```ts
yield { type: "tool_result", name: tc.function.name, result };
```

add:

```ts
if (tc.function.name === "get_maintenance_schedule") {
  lastSchedule = result as ScheduleResult;
}
```

Then replace the `present_findings` branch:

```ts
if (tc.function.name === "present_findings") {
  yield { type: "final", findings: args as Findings };
  return;
}
```

with:

```ts
if (tc.function.name === "present_findings") {
  const findings = fillMissingScheduleItems(args as Findings, lastSchedule, (args as Findings).mileage);
  yield { type: "final", findings };
  return;
}
```

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open `http://localhost:3000`, submit a VIN with a mileage and a quote listing only 1-2 services (e.g. `Cabin air filter`). Confirm the "Manufacturer maintenance schedule" card at the bottom shows *every* item from the schedule (routine oil changes, tire rotation, etc.), not just the quoted ones.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tools.ts src/lib/agent.ts
git commit -m "$(cat <<'EOF'
Guarantee complete manufacturer schedule via deterministic fallback merge

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Manual year/make/model entry

**Files:**
- Modify: `src/app/api/agent/route.ts`
- Modify: `src/lib/agent.ts`
- Modify: `src/components/AgentConsole.tsx`

- [ ] **Step 1: Update `route.ts` to accept either a VIN or manual vehicle info**

Replace the whole `buildUserMessage` function and the `POST` function body in `src/app/api/agent/route.ts` with:

```ts
import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

type VehicleInput = { vin: string } | { manual: { year: string; make: string; model: string } };

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

export async function POST(req: NextRequest) {
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

  const resolvedMode = mode === "manual" ? "manual" : "vin";

  let vehicleInput: VehicleInput;

  if (resolvedMode === "vin") {
    if (!vin || typeof vin !== "string" || vin.trim().length !== 17) {
      return new Response(JSON.stringify({ error: "Provide a full 17-character VIN." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    vehicleInput = { vin: vin.trim().toUpperCase() };
  } else {
    if (!year || !make || !model) {
      return new Response(JSON.stringify({ error: "Provide year, make, and model." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    vehicleInput = { manual: { year: year.trim(), make: make.trim(), model: model.trim() } };
  }

  if (typeof mileage !== "number" || mileage < 0) {
    return new Response(JSON.stringify({ error: "Provide a valid mileage." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const quoteItems = (quote || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const userMessage = buildUserMessage(vehicleInput, mileage, quoteItems);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        for await (const event of runAgent(userMessage)) {
          send(event);
        }
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Tell the agent it's allowed to skip VIN decoding**

In `src/lib/agent.ts`, in `SYSTEM_PROMPT`, replace:

```
1. Call vin_decode to confirm make/model/year.
```

with:

```
1. Call vin_decode to confirm make/model/year — unless the user already told you the
   year/make/model directly (no VIN given), in which case skip this step.
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Add mode state and tabs to `AgentConsole.tsx`**

In `src/components/AgentConsole.tsx`, replace the state block (current lines 41-48):

```ts
  const [vin, setVin] = useState("");
  const [mileage, setMileage] = useState<string>("60000");
  const [quote, setQuote] = useState("");
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [findings, setFindings] = useState<Findings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const traceIdRef = useRef(0);
```

with:

```ts
  const [mode, setMode] = useState<"vin" | "manual">("vin");
  const [vin, setVin] = useState("");
  const [manualYear, setManualYear] = useState("");
  const [manualMake, setManualMake] = useState("");
  const [manualModel, setManualModel] = useState("");
  const [mileage, setMileage] = useState<string>("60000");
  const [quote, setQuote] = useState("");
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [findings, setFindings] = useState<Findings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const traceIdRef = useRef(0);
```

Replace the `vinValid` line:

```ts
  const vinValid = vin.trim().length === 17;
```

with:

```ts
  const vinValid = vin.trim().length === 17;
  const manualValid =
    /^\d{4}$/.test(manualYear.trim()) && manualMake.trim().length > 0 && manualModel.trim().length > 0;
  const canSubmit = mode === "vin" ? vinValid : manualValid;
```

- [ ] **Step 5: Branch `runAgent`'s validation and request body on `mode`**

Replace:

```ts
  async function runAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!vinValid) return;
```

with:

```ts
  async function runAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
```

Replace the fetch body:

```ts
        body: JSON.stringify({ vin: vin.trim(), mileage: Number(mileage), quote }),
```

with:

```ts
        body: JSON.stringify(
          mode === "vin"
            ? { mode, vin: vin.trim(), mileage: Number(mileage), quote }
            : {
                mode,
                year: manualYear.trim(),
                make: manualMake.trim(),
                model: manualModel.trim(),
                mileage: Number(mileage),
                quote,
              }
        ),
```

- [ ] **Step 6: Add the tab toggle and manual fields to the form JSX**

Replace the VIN input block:

```tsx
        <div className="grid sm:grid-cols-2 gap-4">
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
```

with:

```tsx
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
```

- [ ] **Step 7: Update the submit button's disabled condition**

Replace:

```tsx
          disabled={!vinValid || loading}
```

with:

```tsx
          disabled={!canSubmit || loading}
```

- [ ] **Step 8: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 9: Manual verification**

Run: `npm run dev`, open `http://localhost:3000`, switch to "By Year/Make/Model", enter `2022`, `Toyota`, `Camry`, a mileage, and submit. Confirm the trace shows a `get_maintenance_schedule` call with no `vin_decode` call, and the results card shows the right vehicle.

- [ ] **Step 10: Commit**

```bash
git add src/app/api/agent/route.ts src/lib/agent.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Add manual year/make/model entry as a VIN alternative

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Miles/km toggle

**Files:**
- Create: `src/lib/units.ts`
- Modify: `src/components/AgentConsole.tsx`

- [ ] **Step 1: Create the conversion helpers**

Create `src/lib/units.ts`:

```ts
const MILES_PER_KM = 0.621371;

export function kmToMiles(km: number): number {
  return Math.round(km * MILES_PER_KM);
}

export function milesToKm(miles: number): number {
  return Math.round(miles / MILES_PER_KM);
}

// Converts the leading number in strings like "3,600 miles" or "2,400 miles
// overdue" to km for display. Returns the string unchanged if it doesn't
// match the expected "<number> mile(s)/mi ..." pattern — display-only
// conversion, never worth hard-failing on.
export function convertMilesInfoToKm(milesInfo: string): string {
  const match = milesInfo.match(/^([\d,]+)\s*(miles?|mi)\b(.*)$/i);
  if (!match) return milesInfo;
  const miles = Number(match[1].replace(/,/g, ""));
  if (Number.isNaN(miles)) return milesInfo;
  return `${milesToKm(miles).toLocaleString()} km${match[3]}`;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add unit state and the toggle UI to `AgentConsole.tsx`**

Add the import at the top of `src/components/AgentConsole.tsx`:

```ts
import { kmToMiles, milesToKm, convertMilesInfoToKm } from "@/lib/units";
```

Add `unit` state next to `mileage` (in the state block from Task 2 Step 4):

```ts
  const [mileage, setMileage] = useState<string>("60000");
  const [unit, setUnit] = useState<"mi" | "km">("mi");
```

Replace the mileage label/input block:

```tsx
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-white/70 mb-2">
              <Gauge className="size-4 text-accent" />
              Current mileage
            </label>
            <input
              type="number"
              min={0}
              max={500000}
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition"
            />
          </div>
```

with:

```tsx
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
```

- [ ] **Step 4: Convert to miles before sending to the agent**

In the fetch body built in Task 2 Step 5, replace both `Number(mileage)` occurrences with a single computed value. Add this line right before the `const res = await fetch(...)` call:

```ts
    const mileageMiles = unit === "km" ? kmToMiles(Number(mileage)) : Number(mileage);
```

Then replace the two `mileage: Number(mileage)` occurrences in the body with `mileage: mileageMiles`.

- [ ] **Step 5: Pass `unit` down to `ResultsView` and reset per-vehicle display state**

Replace:

```tsx
      <AnimatePresence>{findings && <ResultsView findings={findings} />}</AnimatePresence>
```

with:

```tsx
      <AnimatePresence>
        {findings && (
          <ResultsView
            key={`${findings.vehicle.year}-${findings.vehicle.make}-${findings.vehicle.model}`}
            findings={findings}
            unit={unit}
          />
        )}
      </AnimatePresence>
```

- [ ] **Step 6: Convert displayed values inside `ResultsView`**

Replace the function signature:

```ts
function ResultsView({ findings }: { findings: Findings }) {
  const { vehicle, mileage, items, quoteVerdicts, summary, exactMatch, scheduleSource } = findings;
```

with:

```ts
function ResultsView({ findings, unit }: { findings: Findings; unit: "mi" | "km" }) {
  const { vehicle, mileage, items, quoteVerdicts, summary, exactMatch, scheduleSource } = findings;
  const displayMileage = unit === "km" ? milesToKm(mileage) : mileage;
```

Replace the odometer line:

```tsx
            <div className="text-sm text-white/40">{mileage.toLocaleString()} miles on the odometer</div>
```

with:

```tsx
            <div className="text-sm text-white/40">
              {displayMileage.toLocaleString()} {unit === "mi" ? "miles" : "km"} on the odometer
            </div>
```

Replace the `milesInfo` display in the full-schedule grid:

```tsx
                  <span className="text-[11px] text-white/40">{item.milesInfo}</span>
```

with:

```tsx
                  <span className="text-[11px] text-white/40">
                    {unit === "km" ? convertMilesInfoToKm(item.milesInfo) : item.milesInfo}
                  </span>
```

- [ ] **Step 7: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, submit a lookup with unit set to "km" and a value like `96000`, confirm the request still resolves sensibly (compare against submitting the equivalent mileage in miles) and the results card shows km-labeled distances.

- [ ] **Step 9: Commit**

```bash
git add src/lib/units.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Add miles/km toggle for mileage input and results display

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Vehicle photo

**Files:**
- Modify: `src/components/AgentConsole.tsx`
- Modify: `.env.local.example`
- Modify: `.env.local`

- [ ] **Step 1: Document the env var**

Append to `.env.local.example`:

```
# Optional: powers the vehicle photo. Get a free key at https://www.imagin.studio/
# Falls back to the public demo key ("hello", watermarked) if unset.
NEXT_PUBLIC_IMAGIN_CUSTOMER_KEY=hello
```

Append the same line to `.env.local` (the file created earlier in this project, already gitignored).

- [ ] **Step 2: Render the photo with a graceful fallback**

In `src/components/AgentConsole.tsx`, inside `ResultsView`, add this line right after `const displayMileage = ...`:

```ts
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = `https://cdn.imagin.studio/getImage?customer=${
    process.env.NEXT_PUBLIC_IMAGIN_CUSTOMER_KEY || "hello"
  }&make=${encodeURIComponent(vehicle.make)}&modelFamily=${encodeURIComponent(
    vehicle.model
  )}&modelYear=${encodeURIComponent(vehicle.year)}&angle=01`;
```

Replace the vehicle-summary icon square:

```tsx
          <div className="size-12 rounded-xl bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center shrink-0">
            <Car className="size-6 text-black" />
          </div>
```

with:

```tsx
          {!imageFailed ? (
            <img
              src={imageUrl}
              alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              className="size-12 rounded-xl object-cover shrink-0 bg-white/5"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="size-12 rounded-xl bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center shrink-0">
              <Car className="size-6 text-black" />
            </div>
          )}
```

Note: `key={...vehicle...}` was already added on `ResultsView` in Task 3 Step 5, so `imageFailed` correctly resets to `false` whenever a new vehicle's results come in — no separate effect needed.

- [ ] **Step 3: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev` (restart it if it was already running, so the new env var is picked up), submit a lookup for a common vehicle (e.g. Toyota Camry). Confirm a real car photo renders in the vehicle-summary card. Then submit an obscure/fake make/model via manual entry (e.g. "Zzz" / "Foo") and confirm it falls back to the gradient+icon square instead of a broken image.

- [ ] **Step 5: Commit**

```bash
git add src/components/AgentConsole.tsx .env.local.example
git commit -m "$(cat <<'EOF'
Show vehicle photo via imagin.studio with icon fallback

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Final full-app pass

**Files:** none (verification only)

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 2: End-to-end manual walkthrough**

Run: `npm run dev`. In the browser, exercise: VIN mode with a quote → manual mode without a quote → km toggle → confirm vehicle photo and full schedule card all render correctly together in at least one combined run (e.g., manual entry + km + a quote).
