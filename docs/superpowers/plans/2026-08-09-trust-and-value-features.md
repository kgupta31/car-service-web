# Trust & Value Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app's central claim actually true (real, cited manufacturer schedules instead of three hardcoded models), then add the things that make it worth recommending: free open-recall lookup, DIY cost flags, prioritization, and shareable results.

**Architecture:** All five tasks are additive to the existing flow. Tasks 1, 2, and 4 extend `src/lib/tools.ts` and the agent loop; Task 3 is pure deterministic post-processing; Task 5 is client-only. No new dependencies, no server database, no paid APIs — everything runs on the existing Groq key plus NHTSA's free API and the browser's native `CompressionStream`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind, framer-motion, `openai` SDK against Groq. No test runner exists in this project — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual checks (curl and browser) against a live dev server, consistent with all prior work in this repo.

**Design spec:** `docs/superpowers/specs/2026-08-09-trust-and-value-features-design.md`

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/lib/tools.ts` | Tool implementations + schemas: schedule search, recalls, DIY table, safety-critical tagging | 1, 2, 3, 4 |
| `src/lib/types.ts` | Shared types consumed by server and client | 1, 2, 3, 4 |
| `src/lib/agent.ts` | Agent loop: cache interception, prompt instructions, deterministic post-processing | 1, 2, 3, 4 |
| `src/app/api/agent/route.ts` | Request plumbing for the schedule cache | 1 |
| `src/lib/vehicleHistory.ts` | localStorage: existing audit history + new schedule cache | 1 |
| `src/lib/share.ts` | **New.** gzip+base64url encode/decode of findings | 5 |
| `src/components/AgentConsole.tsx` | All UI rendering | 1, 2, 3, 4, 5 |

**PR boundary:** each task below is its own branch, PR, review cycle, and merge — same flow as the previous six tasks.

---

## Task 1: Real schedule data (searched + cited + cached)

**Files:**
- Modify: `src/lib/tools.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/agent.ts`
- Modify: `src/app/api/agent/route.ts`
- Modify: `src/lib/vehicleHistory.ts`
- Modify: `src/components/AgentConsole.tsx`

- [ ] **Step 1: Add `sources` to `ScheduleResult` and make the schedule lookup searched**

In `src/lib/tools.ts`, replace:

```ts
export type ScheduleResult = {
  make: string;
  model: string;
  exact_match: boolean;
  source: string;
  schedule: MaintenanceItem[];
  error?: string;
};
```

with:

```ts
export type ScheduleResult = {
  make: string;
  model: string;
  exact_match: boolean;
  source: string;
  schedule: MaintenanceItem[];
  sources?: string[];
  error?: string;
};
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Replace `getMaintenanceSchedule` with a searched, cited version**

In `src/lib/tools.ts`, replace the whole function:

```ts
export function getMaintenanceSchedule(make: string, model: string): ScheduleResult {
  const key = `${make.trim().toUpperCase()}|${model.trim().toUpperCase()}`;
  const exact = MOCK_SCHEDULES[key];
  return {
    make,
    model,
    exact_match: !!exact,
    source: exact ? "mocked internal table" : "generic fallback (not model-specific)",
    schedule: exact ?? GENERIC_SCHEDULE,
  };
}
```

with:

```ts
// Falls back through: web search -> small hardcoded table -> generic averages.
// The search is what makes this app's core claim ("your manufacturer's
// schedule") actually true; the table and generic list only exist so a failed
// search degrades instead of erroring.
function fallbackSchedule(make: string, model: string): ScheduleResult {
  const key = `${make.trim().toUpperCase()}|${model.trim().toUpperCase()}`;
  const exact = MOCK_SCHEDULES[key];
  return {
    make,
    model,
    exact_match: !!exact,
    source: exact ? "built-in table" : "generic estimate (not model-specific)",
    schedule: exact ?? GENERIC_SCHEDULE,
  };
}

export async function getMaintenanceSchedule(
  make: string,
  model: string,
  year?: string
): Promise<ScheduleResult> {
  const searched = await searchMaintenanceSchedule(make, model, year);
  return searched ?? fallbackSchedule(make, model);
}

// Web-search the manufacturer's published intervals for this exact vehicle.
// Returns null on any failure so the caller can fall back.
async function searchMaintenanceSchedule(
  make: string,
  model: string,
  year?: string
): Promise<ScheduleResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const vehicle = `${year ? `${year} ` : ""}${make} ${model}`.trim();

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "groq/compound-mini",
        messages: [
          {
            role: "system",
            content:
              "You research manufacturer-published vehicle maintenance schedules. Use web search " +
              "to find the real recommended service intervals for the exact vehicle asked about. " +
              "Respond with ONLY a JSON object, no other text, no markdown fences, matching this " +
              'exact shape: {"schedule": [{"service": string, "interval_miles": number, ' +
              '"category": "routine" | "major"}], "sources": string[]}. Use "routine" for items ' +
              'under 40,000 mile intervals and "major" for longer ones. Include 6-12 items. If you ' +
              'cannot find a real model-specific schedule, return {"schedule": [], "sources": []}.',
          },
          {
            role: "user",
            content: `What is the manufacturer-recommended maintenance schedule for a ${vehicle}?`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.schedule)) return null;

    const schedule: MaintenanceItem[] = parsed.schedule
      .filter(
        (it: unknown): it is { service: string; interval_miles: number; category: string } =>
          !!it &&
          typeof (it as { service?: unknown }).service === "string" &&
          typeof (it as { interval_miles?: unknown }).interval_miles === "number" &&
          Number.isFinite((it as { interval_miles: number }).interval_miles) &&
          (it as { interval_miles: number }).interval_miles > 0
      )
      .map((it) => ({
        service: it.service,
        interval_miles: it.interval_miles,
        category: it.category === "major" ? ("major" as const) : ("routine" as const),
      }));

    if (schedule.length === 0) return null;

    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.filter((s: unknown): s is string => typeof s === "string")
      : [];

    return {
      make,
      model,
      exact_match: true,
      source: `${make} manufacturer schedule (researched)`,
      schedule,
      sources,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Pass `year` through the tool schema and `runTool`**

In `src/lib/tools.ts`, replace:

```ts
        properties: {
          make: { type: "string", description: "Vehicle make, e.g. 'Toyota'." },
          model: { type: "string", description: "Vehicle model, e.g. 'Camry'." },
        },
        required: ["make", "model"],
```

with:

```ts
        properties: {
          make: { type: "string", description: "Vehicle make, e.g. 'Toyota'." },
          model: { type: "string", description: "Vehicle model, e.g. 'Camry'." },
          year: { type: "string", description: "Model year, e.g. '2022'. Include it when known." },
        },
        required: ["make", "model"],
```

Then replace:

```ts
    if (name === "get_maintenance_schedule") {
      return getMaintenanceSchedule(input.make as string, input.model as string);
    }
```

with:

```ts
    if (name === "get_maintenance_schedule") {
      return await getMaintenanceSchedule(
        input.make as string,
        input.model as string,
        input.year as string | undefined
      );
    }
```

- [ ] **Step 5: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Add `scheduleSources` to `Findings`**

In `src/lib/types.ts`, replace:

```ts
  transcribedItems?: string[];
  priceAssessment?: PriceAssessment;
};
```

with:

```ts
  transcribedItems?: string[];
  priceAssessment?: PriceAssessment;
  scheduleSources?: string[];
};
```

- [ ] **Step 7: Intercept the schedule tool call with the client-supplied cache, and attach sources**

In `src/lib/agent.ts`, replace:

```ts
export async function* runAgent(
  userMessage: string,
  transcribedItems?: string[],
  amountQuoted?: number,
  zip?: string
): AsyncGenerator<AgentEvent> {
```

with:

```ts
export async function* runAgent(
  userMessage: string,
  transcribedItems?: string[],
  amountQuoted?: number,
  zip?: string,
  cachedSchedule?: ScheduleResult
): AsyncGenerator<AgentEvent> {
```

Then replace:

```ts
      yield { type: "tool_call", name: tc.function.name, input: args };
      const result = await runTool(tc.function.name, args);
      yield { type: "tool_result", name: tc.function.name, result };

      if (tc.function.name === "get_maintenance_schedule") {
        lastSchedule = result as ScheduleResult;
      }
```

with:

```ts
      yield { type: "tool_call", name: tc.function.name, input: args };
      // A client-supplied cached schedule skips the (slow) web search entirely.
      // Cache is keyed per vehicle on the client — see vehicleHistory.ts.
      const usingCache = tc.function.name === "get_maintenance_schedule" && !!cachedSchedule;
      const result = usingCache ? cachedSchedule : await runTool(tc.function.name, args);
      yield { type: "tool_result", name: tc.function.name, result };

      if (tc.function.name === "get_maintenance_schedule") {
        lastSchedule = result as ScheduleResult;
      }
```

Then, in the `present_findings` branch, replace:

```ts
        // transcribedItems comes from the dedicated transcribeQuoteImage() call, not
        // the model — it's authoritative and overrides anything the model guessed.
        if (transcribedItems && transcribedItems.length > 0) {
          findings.transcribedItems = transcribedItems;
        }
```

with:

```ts
        // transcribedItems comes from the dedicated transcribeQuoteImage() call, not
        // the model — it's authoritative and overrides anything the model guessed.
        if (transcribedItems && transcribedItems.length > 0) {
          findings.transcribedItems = transcribedItems;
        }

        // Provenance comes from the tool result, not the model, so the UI can be
        // honest about whether this was a real researched schedule or a fallback.
        if (lastSchedule) {
          findings.exactMatch = lastSchedule.exact_match;
          findings.scheduleSource = lastSchedule.source;
          if (lastSchedule.sources && lastSchedule.sources.length > 0) {
            findings.scheduleSources = lastSchedule.sources;
          }
        }
```

- [ ] **Step 8: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 9: Thread `cachedSchedule` through the API route**

In `src/app/api/agent/route.ts`, add the import. Replace:

```ts
import { runAgent, transcribeQuoteImage } from "@/lib/agent";
```

with:

```ts
import { runAgent, transcribeQuoteImage } from "@/lib/agent";
import type { ScheduleResult } from "@/lib/tools";
```

Replace the destructuring block:

```ts
    quoteImage,
    amountQuoted,
    zip,
  } = body as {
```

with:

```ts
    quoteImage,
    amountQuoted,
    zip,
    cachedSchedule,
  } = body as {
```

and inside the same type annotation, replace:

```ts
    amountQuoted?: number;
    zip?: string;
  };
```

with:

```ts
    amountQuoted?: number;
    zip?: string;
    cachedSchedule?: ScheduleResult;
  };
```

Add validation right after `const trimmedZip = ...`:

```ts
  // Client-supplied cache: only trust it if it's shaped correctly. A malformed
  // cache just means we do the search, never an error.
  const validCachedSchedule =
    cachedSchedule &&
    typeof cachedSchedule === "object" &&
    Array.isArray(cachedSchedule.schedule) &&
    cachedSchedule.schedule.length > 0
      ? cachedSchedule
      : undefined;
```

Replace the `runAgent` call:

```ts
        for await (const event of runAgent(userMessage, transcribedItems, validAmountQuoted, trimmedZip)) {
```

with:

```ts
        for await (const event of runAgent(
          userMessage,
          transcribedItems,
          validAmountQuoted,
          trimmedZip,
          validCachedSchedule
        )) {
```

- [ ] **Step 10: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 11: Add schedule caching to `vehicleHistory.ts`**

In `src/lib/vehicleHistory.ts`, replace:

```ts
import type { Findings, QuoteVerdict } from "./types";
```

with:

```ts
import type { Findings, QuoteVerdict } from "./types";
import type { ScheduleResult } from "./tools";
```

Replace:

```ts
const STORAGE_PREFIX = "serviceaudit:history:";
const MAX_AUDITS_PER_VEHICLE = 10;
```

with:

```ts
const STORAGE_PREFIX = "serviceaudit:history:";
const SCHEDULE_PREFIX = "serviceaudit:schedule:";
const MAX_AUDITS_PER_VEHICLE = 10;
const SCHEDULE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
```

Add these two functions at the end of the file:

```ts
type CachedSchedule = { savedAt: number; schedule: ScheduleResult };

// Researching a schedule costs a slow web search, and a given vehicle's
// schedule doesn't change — so cache it per vehicle and skip the search on
// repeat audits. Expires after 90 days in case our research improves.
export function getCachedSchedule(identifier: string | null): ScheduleResult | undefined {
  if (!identifier || typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(`${SCHEDULE_PREFIX}${identifier}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CachedSchedule;
    if (!parsed?.schedule || !Array.isArray(parsed.schedule.schedule)) return undefined;
    if (Date.now() - parsed.savedAt > SCHEDULE_TTL_MS) return undefined;
    return parsed.schedule;
  } catch {
    return undefined;
  }
}

export function saveCachedSchedule(identifier: string | null, schedule: ScheduleResult): void {
  if (!identifier || typeof window === "undefined") return;
  // Only cache real researched schedules — caching a generic fallback would
  // lock the user out of getting a better answer later.
  if (!schedule?.exact_match || !Array.isArray(schedule.schedule) || schedule.schedule.length === 0) {
    return;
  }
  try {
    const payload: CachedSchedule = { savedAt: Date.now(), schedule };
    window.localStorage.setItem(`${SCHEDULE_PREFIX}${identifier}`, JSON.stringify(payload));
  } catch {
    // localStorage unavailable or full — caching is an optimization, not core.
  }
}
```

- [ ] **Step 12: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 13: Wire the cache and source citations into `AgentConsole.tsx`**

Add to the `vehicleHistory` import. Replace:

```ts
import {
  vehicleIdentifier,
  getVehicleHistory,
  saveAuditToHistory,
  summarizeHistoryForPrompt,
  type AuditRecord,
} from "@/lib/vehicleHistory";
```

with:

```ts
import {
  vehicleIdentifier,
  getVehicleHistory,
  saveAuditToHistory,
  summarizeHistoryForPrompt,
  getCachedSchedule,
  saveCachedSchedule,
  type AuditRecord,
} from "@/lib/vehicleHistory";
import type { ScheduleResult } from "@/lib/tools";
```

Read the cache before the request. Replace:

```ts
    const effectiveQuote = quoteMode === "photo" ? "" : quote;
```

with:

```ts
    const cachedSchedule = getCachedSchedule(identifier);
    const effectiveQuote = quoteMode === "photo" ? "" : quote;
```

Add it to both request bodies. Replace:

```ts
                quoteImage: effectiveQuoteImage,
                amountQuoted: effectiveAmountQuoted,
                zip: zip.trim(),
              }
            : {
```

with:

```ts
                quoteImage: effectiveQuoteImage,
                amountQuoted: effectiveAmountQuoted,
                zip: zip.trim(),
                cachedSchedule,
              }
            : {
```

and replace (the second, manual-mode occurrence, which is followed by the closing of the ternary):

```ts
                quoteImage: effectiveQuoteImage,
                amountQuoted: effectiveAmountQuoted,
                zip: zip.trim(),
              }
        ),
```

with:

```ts
                quoteImage: effectiveQuoteImage,
                amountQuoted: effectiveAmountQuoted,
                zip: zip.trim(),
                cachedSchedule,
              }
        ),
```

Save freshly-researched schedules from the tool result. Replace:

```ts
          } else if (event.type === "tool_result") {
            pushTrace(`✓ ${event.name} returned a result`);
          } else if (event.type === "final") {
```

with:

```ts
          } else if (event.type === "tool_result") {
            pushTrace(`✓ ${event.name} returned a result`);
            if (event.name === "get_maintenance_schedule") {
              saveCachedSchedule(identifier, event.result as ScheduleResult);
            }
          } else if (event.type === "final") {
```

Make the trace label honest about what the tool is doing. Replace:

```ts
            const label =
              event.name === "vin_decode"
                ? `Decoding VIN ${String(event.input.vin ?? "")}...`
                : `Looking up maintenance schedule for ${event.input.make} ${event.input.model}...`;
```

with:

```ts
            const label =
              event.name === "vin_decode"
                ? `Decoding VIN ${String(event.input.vin ?? "")}...`
                : `Researching the real ${[event.input.year, event.input.make, event.input.model]
                    .filter(Boolean)
                    .join(" ")} maintenance schedule...`;
```

- [ ] **Step 14: Replace the schedule badge with honest provenance, and render citations**

In `ResultsView`, destructure the new field. Replace:

```ts
    transcribedItems,
    priceAssessment,
  } = findings;
```

with:

```ts
    transcribedItems,
    priceAssessment,
    scheduleSources,
  } = findings;
```

Replace the badge:

```tsx
          {!exactMatch && (
            <div className="text-xs px-3 py-1.5 rounded-full border border-warn/30 bg-warn/10 text-warn">
              Generic schedule estimate — not model-exact
            </div>
          )}
```

with:

```tsx
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
```

Render the citations under the schedule card. Replace:

```tsx
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm font-semibold">Manufacturer maintenance schedule</div>
          <div className="text-[11px] text-white/30">{scheduleSource}</div>
        </div>
```

with:

```tsx
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
```

- [ ] **Step 15: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 16: Manual verification**

Run `npm run dev`, then:
1. Submit a vehicle **not** in the hardcoded table (e.g. manual entry: 2022, Hyundai, Elantra) with a quote. Confirm: the trace says "Researching the real 2022 Hyundai Elantra maintenance schedule...", the badge reads "Real manufacturer schedule · N sources", the schedule items look Hyundai-specific (not the generic list), and source links render as clickable hostnames.
2. Submit the **same vehicle again**. Confirm it's noticeably faster (cache hit — no search) and still shows the real schedule. Verify in DevTools that `localStorage` has a `serviceaudit:schedule:` key.
3. Submit a nonsense vehicle (manual entry: 2020, Zzz, Qqq). Confirm it degrades to "Generic estimate — no model-specific schedule found" rather than erroring, and that no `serviceaudit:schedule:` key is written for it.
4. Regression: confirm VIN mode, photo mode, follow-up chat, and price check all still work.

Kill the dev server when done.

- [ ] **Step 17: Commit**

```bash
git add src/lib/tools.ts src/lib/types.ts src/lib/agent.ts src/app/api/agent/route.ts src/lib/vehicleHistory.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Research real manufacturer schedules instead of using mock data

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Open recalls (NHTSA)

**Files:**
- Modify: `src/lib/tools.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/agent.ts`
- Modify: `src/components/AgentConsole.tsx`

> **Order matters here:** `RecallItem` is declared once in `types.ts` (Step 1)
> and imported by `tools.ts` (Step 2), so the shared shape has a single source
> of truth and the intermediate `tsc` checks pass.

- [ ] **Step 1: Add recall types to `types.ts`**

In `src/lib/types.ts`, add above the `Findings` type:

```ts
export type RecallItem = {
  component: string;
  summary: string;
  remedy: string;
  campaignNumber: string;
};

export type RecallSummary = {
  count: number;
  items: RecallItem[];
};
```

and inside `Findings`, replace:

```ts
  scheduleSources?: string[];
};
```

with:

```ts
  scheduleSources?: string[];
  recalls?: RecallSummary;
};
```

- [ ] **Step 2: Add the recalls tool to `tools.ts`**

Extend the existing type import at the top of `src/lib/tools.ts`. Replace:

```ts
import type { ItemStatus } from "./types";
```

with:

```ts
import type { ItemStatus, RecallItem } from "./types";
```

Then add after the `vinDecode` function:

```ts
export type RecallResult = {
  count: number;
  recalls: RecallItem[];
  error?: string;
};

const MAX_RECALLS = 5;

// NHTSA's free recalls API. Note: it only accepts make/model/modelYear —
// passing a VIN returns zero results — so these are model-level recalls that
// may not apply to every production batch. The UI must say so.
export async function getRecalls(
  make: string,
  model: string,
  year: string
): Promise<RecallResult> {
  const url =
    `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}` +
    `&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;

  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { count: 0, recalls: [], error: `HTTP ${res.status}` };

    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];

    const recalls: RecallItem[] = results.slice(0, MAX_RECALLS).map((r: Record<string, unknown>) => ({
      component: typeof r.Component === "string" ? r.Component : "Unspecified",
      summary: typeof r.Summary === "string" ? r.Summary : "",
      remedy: typeof r.Remedy === "string" ? r.Remedy : "",
      campaignNumber: typeof r.NHTSACampaignNumber === "string" ? r.NHTSACampaignNumber : "",
    }));

    return { count: results.length, recalls };
  } catch (e) {
    return { count: 0, recalls: [], error: (e as Error).message };
  }
}
```

- [ ] **Step 3: Register the tool schema and dispatch**

In `TOOL_SCHEMAS`, add this entry after the `get_maintenance_schedule` entry (inside the array, before the closing `];`):

```ts
  {
    type: "function" as const,
    function: {
      name: "nhtsa_recalls",
      description:
        "Look up open safety recalls for a vehicle from NHTSA's free database. Recall repairs " +
        "are free at any dealer, so always call this once you know the year, make, and model.",
      parameters: {
        type: "object",
        properties: {
          make: { type: "string", description: "Vehicle make, e.g. 'Hyundai'." },
          model: { type: "string", description: "Vehicle model, e.g. 'Elantra'." },
          year: { type: "string", description: "Model year, e.g. '2022'." },
        },
        required: ["make", "model", "year"],
      },
    },
  },
```

In `runTool`, add before the `return { error: \`Unknown tool: ${name}\` };` line:

```ts
    if (name === "nhtsa_recalls") {
      return await getRecalls(input.make as string, input.model as string, input.year as string);
    }
```

- [ ] **Step 4: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Attach recalls server-side and prompt the agent to fetch them**

In `src/lib/agent.ts`, replace the import:

```ts
import type { ScheduleResult } from "./tools";
```

with:

```ts
import type { ScheduleResult, RecallResult } from "./tools";
```

Add tracking next to `lastSchedule`. Replace:

```ts
  let lastSchedule: ScheduleResult | null = null;
```

with:

```ts
  let lastSchedule: ScheduleResult | null = null;
  let lastRecalls: RecallResult | null = null;
```

Capture the result. Replace:

```ts
      if (tc.function.name === "get_maintenance_schedule") {
        lastSchedule = result as ScheduleResult;
      }
```

with:

```ts
      if (tc.function.name === "get_maintenance_schedule") {
        lastSchedule = result as ScheduleResult;
      }
      if (tc.function.name === "nhtsa_recalls") {
        lastRecalls = result as RecallResult;
      }
```

Attach to findings — replace:

```ts
        // Provenance comes from the tool result, not the model, so the UI can be
        // honest about whether this was a real researched schedule or a fallback.
        if (lastSchedule) {
```

with:

```ts
        // Recall data comes straight from NHTSA, not the model — never let the
        // model paraphrase or invent safety recalls.
        if (lastRecalls && lastRecalls.count > 0) {
          findings.recalls = { count: lastRecalls.count, items: lastRecalls.recalls };
        }

        // Provenance comes from the tool result, not the model, so the UI can be
        // honest about whether this was a real researched schedule or a fallback.
        if (lastSchedule) {
```

Add the prompt instruction. In `SYSTEM_PROMPT`, replace:

```
5. Be direct and specific with numbers. This is a tool for someone about to spend real money.
```

with:

```
5. Call nhtsa_recalls with the year, make, and model to check for open safety recalls. Recall
   repairs are free at any dealer, so this matters to the user regardless of their quote. If any
   are found, mention them in the summary — but describe them as recalls reported for this
   year/make/model, NOT as confirmed for their specific car (the lookup is not VIN-exact).
6. Be direct and specific with numbers. This is a tool for someone about to spend real money.
```

and renumber the remaining instructions 6→7, 7→8, 8→9, 9→10 (the final `present_findings` step becomes 10).

- [ ] **Step 6: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Render the recalls card**

In `src/components/AgentConsole.tsx`, add `ShieldAlert` to the `lucide-react` import (append it to the existing list, before the closing brace).

Destructure it. Replace:

```ts
    scheduleSources,
  } = findings;
```

with:

```ts
    scheduleSources,
    recalls,
  } = findings;
```

Insert the card directly after the "Summary callout" block and before the "What we read from the photo" block. Replace:

```tsx
      {/* What we read from the photo, if one was uploaded */}
```

with:

```tsx
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
```

- [ ] **Step 8: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 9: Manual verification**

Run `npm run dev`, then:
1. Submit 2022 / Hyundai / Elantra (known to have 5 recalls). Confirm the recalls card appears directly under "Bottom line", shows the count, lists components with campaign numbers and remedies, and includes the "confirm with your VIN at NHTSA" link.
2. Confirm the card copy does **not** claim the user's specific car is affected.
3. Submit a vehicle with no recalls (try 2026 / Toyota / Camry). Confirm no recalls card renders at all.
4. Regression: schedule research (Task 1), photo mode, and price check still work.

Kill the dev server when done.

- [ ] **Step 10: Commit**

```bash
git add src/lib/tools.ts src/lib/types.ts src/lib/agent.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Add free NHTSA open-recall lookup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: DIY flags

**Files:**
- Modify: `src/lib/tools.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/agent.ts`
- Modify: `src/components/AgentConsole.tsx`

> **Order matters here:** the shared `DiyInfo` type is declared once in
> `types.ts` and imported by `tools.ts`, so `types.ts` is edited first —
> otherwise the intermediate `tsc` check would fail on a missing import.

- [ ] **Step 1: Add `DiyInfo` and the `diy` fields to `types.ts`**

In `src/lib/types.ts`, add above `FindingsItem`:

```ts
export type DiyInfo = {
  partCostRange: string;
  minutes: number;
  note: string;
};
```

Replace:

```ts
export type FindingsItem = {
  service: string;
  category: "routine" | "major";
  status: ItemStatus;
  milesInfo: string;
};
```

with:

```ts
export type FindingsItem = {
  service: string;
  category: "routine" | "major";
  status: ItemStatus;
  milesInfo: string;
  diy?: DiyInfo;
};
```

Replace:

```ts
export type QuoteVerdict = {
  item: string;
  verdict: Verdict;
  explanation: string;
};
```

with:

```ts
export type QuoteVerdict = {
  item: string;
  verdict: Verdict;
  explanation: string;
  diy?: DiyInfo;
};
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add the DIY table and matcher to `tools.ts`**

Extend the existing type import at the top of `src/lib/tools.ts`. Replace:

```ts
import type { ItemStatus } from "./types";
```

with:

```ts
import type { ItemStatus, DiyInfo } from "./types";
```

Then add at the end of `src/lib/tools.ts`:

```ts
// Deliberately hardcoded and deliberately conservative. This is NOT model-
// judged: an LLM deciding "you can DIY your brakes" is a safety hazard.
// Only genuinely trivial, non-safety-critical items belong here.
const DIY_SERVICES: { match: string; info: DiyInfo }[] = [
  {
    match: "cabinairfilter",
    info: { partCostRange: "$12-25", minutes: 10, note: "Usually behind the glovebox, no tools." },
  },
  {
    match: "engineairfilter",
    info: { partCostRange: "$15-30", minutes: 10, note: "Airbox clips open by hand on most cars." },
  },
  {
    match: "wiperblade",
    info: { partCostRange: "$20-40", minutes: 5, note: "Clip on and off, no tools." },
  },
  {
    match: "keyfobbattery",
    info: { partCostRange: "$3-8", minutes: 5, note: "A coin cell and a small screwdriver." },
  },
  {
    match: "battery",
    info: { partCostRange: "$120-200", minutes: 20, note: "Two terminals and a hold-down clamp." },
  },
];

// Reuses the same normalization the schedule matcher uses so "Cabin Air Filter
// Replacement" and "cabin air filter" both hit.
export function findDiyInfo(serviceName: string): DiyInfo | undefined {
  const n = serviceName.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Skip anything mentioning brakes/tires/steering even if another keyword
  // matches — those are never DIY recommendations from this app.
  if (/brake|tire|steer|suspension|airbag|coolant|transmission/.test(n)) return undefined;
  const hit = DIY_SERVICES.find((d) => n.includes(d.match));
  return hit?.info;
}
```

- [ ] **Step 4: Apply DIY flags deterministically in `agent.ts`**

Replace the import:

```ts
import { TOOL_SCHEMAS, runTool, computeScheduleItemStatus } from "./tools";
```

with:

```ts
import { TOOL_SCHEMAS, runTool, computeScheduleItemStatus, findDiyInfo } from "./tools";
```

Add this function right after `fillMissingScheduleItems`:

```ts
// Computed in code, not asked of the model — same reason as
// fillMissingScheduleItems: deterministic beats hoping the model complies.
function applyDiyFlags(findings: Findings): Findings {
  return {
    ...findings,
    items: findings.items.map((it) => {
      const diy = findDiyInfo(it.service);
      return diy ? { ...it, diy } : it;
    }),
    quoteVerdicts: findings.quoteVerdicts.map((qv) => {
      const diy = findDiyInfo(qv.item);
      return diy ? { ...qv, diy } : qv;
    }),
  };
}
```

Apply it. Replace:

```ts
        const findings = fillMissingScheduleItems(rawFindings as Findings, lastSchedule, rawFindings.mileage);
```

with:

```ts
        const findings = applyDiyFlags(
          fillMissingScheduleItems(rawFindings as Findings, lastSchedule, rawFindings.mileage)
        );
```

- [ ] **Step 5: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Render DIY badges**

In `src/components/AgentConsole.tsx`, add `Hammer` to the `lucide-react` import.

In the quote-audit card, replace:

```tsx
                  <p className="text-xs text-white/50 mt-1.5 leading-relaxed">{qv.explanation}</p>
                </motion.div>
```

with:

```tsx
                  <p className="text-xs text-white/50 mt-1.5 leading-relaxed">{qv.explanation}</p>
                  {qv.diy && (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-ok/30 bg-ok/10 px-2.5 py-1 text-[11px] text-ok">
                      <Hammer className="size-3" />
                      DIY-able · ~{qv.diy.partCostRange} part · {qv.diy.minutes} min
                      <span className="text-ok/60">— {qv.diy.note}</span>
                    </div>
                  )}
                </motion.div>
```

In the schedule card, replace:

```tsx
                  <span className="text-[11px] text-white/40">
                    {unit === "km" ? convertMilesInfoToKm(item.milesInfo) : item.milesInfo}
                  </span>
                </div>
              </motion.div>
```

with:

```tsx
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
```

- [ ] **Step 7: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, then:
1. Submit any vehicle with the quote `Cabin air filter, Wiper blades, Brake fluid`. Confirm DIY badges appear on the cabin air filter and wiper blades lines with cost and time, and that **no** DIY badge appears on brake fluid.
2. Confirm DIY badges also appear on matching items in the manufacturer-schedule card.
3. Regression: schedule research and recalls still work.

Kill the dev server when done.

- [ ] **Step 9: Commit**

```bash
git add src/lib/tools.ts src/lib/types.ts src/lib/agent.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Flag DIY-able services with part cost and time

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Prioritization

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/agent.ts`
- Modify: `src/components/AgentConsole.tsx`

- [ ] **Step 1: Add priority types**

In `src/lib/types.ts`, add above `FindingsItem`:

```ts
export type Priority = "safety" | "soon" | "can_wait";
```

Replace:

```ts
export type FindingsItem = {
  service: string;
  category: "routine" | "major";
  status: ItemStatus;
  milesInfo: string;
  diy?: DiyInfo;
};
```

with:

```ts
export type FindingsItem = {
  service: string;
  category: "routine" | "major";
  status: ItemStatus;
  milesInfo: string;
  diy?: DiyInfo;
  priority?: Priority;
};
```

Inside `Findings`, replace:

```ts
  recalls?: RecallSummary;
};
```

with:

```ts
  recalls?: RecallSummary;
  actionPlan?: string;
};
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add priority to the tool schema and prompt**

In `src/lib/agent.ts`, in `PRESENT_FINDINGS_TOOL`, replace:

```ts
              status: { type: "string", enum: ["overdue", "due_now", "not_due"] },
              milesInfo: { type: "string" },
            },
            required: ["service", "category", "status", "milesInfo"],
```

with:

```ts
              status: { type: "string", enum: ["overdue", "due_now", "not_due"] },
              milesInfo: { type: "string" },
              priority: { type: "string", enum: ["safety", "soon", "can_wait"] },
            },
            required: ["service", "category", "status", "milesInfo"],
```

and replace:

```ts
        transcribedItems: { type: "array", items: { type: "string" } },
      },
```

with:

```ts
        transcribedItems: { type: "array", items: { type: "string" } },
        actionPlan: { type: "string" },
      },
```

In `SYSTEM_PROMPT`, replace the final instruction (currently numbered 10 after Task 2's renumbering):

```
10. Finish by calling present_findings with the full structured result — this IS your final answer,
    do not also write a text response after it. Include a concise plain-English summary sentence.`;
```

with:

```
10. Assign each schedule item a priority: "safety" for anything safety-critical that is overdue or
    due now (brakes, tires, steering, suspension, lights), "soon" for other overdue/due-now items,
    and "can_wait" for items that are not due yet. Then write a 1-3 sentence actionPlan saying what
    to do first and what can wait, referencing concrete items and numbers.
11. Finish by calling present_findings with the full structured result — this IS your final answer,
    do not also write a text response after it. Include a concise plain-English summary sentence.`;
```

- [ ] **Step 4: Enforce safety priority deterministically**

In `src/lib/agent.ts`, add after `applyDiyFlags`:

```ts
const SAFETY_CRITICAL = /brake|tire|steer|suspension|headlight|taillight|wiper/;

// The model assigns priority (it needs judgment), but a safety-critical item
// that's actually due must never be ranked below convenience work — enforce
// that in code rather than trusting the prompt.
function enforceSafetyPriority(findings: Findings): Findings {
  return {
    ...findings,
    items: findings.items.map((it) => {
      const isDue = it.status === "overdue" || it.status === "due_now";
      if (isDue && SAFETY_CRITICAL.test(it.service.toLowerCase())) {
        return { ...it, priority: "safety" as const };
      }
      return it.priority ? it : { ...it, priority: isDue ? ("soon" as const) : ("can_wait" as const) };
    }),
  };
}
```

Apply it. Replace:

```ts
        const findings = applyDiyFlags(
          fillMissingScheduleItems(rawFindings as Findings, lastSchedule, rawFindings.mileage)
        );
```

with:

```ts
        const findings = enforceSafetyPriority(
          applyDiyFlags(
            fillMissingScheduleItems(rawFindings as Findings, lastSchedule, rawFindings.mileage)
          )
        );
```

- [ ] **Step 5: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Render the "Do this first" card**

In `src/components/AgentConsole.tsx`, add `ListChecks` to the `lucide-react` import.

Add a priority metadata map next to `PRICE_VERDICT_META`:

```ts
const PRIORITY_META: Record<"safety" | "soon" | "can_wait", { label: string; color: string }> = {
  safety: { label: "Do first — safety", color: "text-danger border-danger/30 bg-danger/10" },
  soon: { label: "Soon", color: "text-warn border-warn/30 bg-warn/10" },
  can_wait: { label: "Can wait", color: "text-ok border-ok/30 bg-ok/10" },
};
```

Destructure the new field. Replace:

```ts
    recalls,
  } = findings;
```

with:

```ts
    recalls,
    actionPlan,
  } = findings;
```

Insert the card immediately before the "Full schedule status" card. Replace:

```tsx
      {/* Full schedule status */}
```

with:

```tsx
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
```

- [ ] **Step 7: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, then:
1. Submit a vehicle at high mileage (e.g. 2018 / Honda / Civic at 95,000) so several items are overdue. Confirm the "Do this first" card appears with an action plan sentence and grouped items.
2. Confirm any overdue brake/tire item is grouped under "Do first — safety", not "Soon".
3. Confirm items that aren't due don't appear in the card (only safety/soon groups render).
4. Regression: recalls, DIY badges, and schedule research still work.

Kill the dev server when done.

- [ ] **Step 9: Commit**

```bash
git add src/lib/types.ts src/lib/agent.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Prioritize findings by safety and urgency with an action plan

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Shareable link

**Files:**
- Create: `src/lib/share.ts`
- Modify: `src/components/AgentConsole.tsx`

- [ ] **Step 1: Create the encoder/decoder**

Create `src/lib/share.ts`:

```ts
import type { Findings } from "./types";

// Findings compress to roughly 500 bytes gzipped+base64 (measured), which fits
// comfortably in a URL — so sharing needs no database and no server. Uses the
// browser's native CompressionStream, so no dependency either.
const MAX_ENCODED_LENGTH = 8000;

export async function encodeFindings(findings: Findings): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const json = JSON.stringify(findings);
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
    const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return encoded.length > MAX_ENCODED_LENGTH ? null : encoded;
  } catch {
    return null;
  }
}

export async function decodeFindings(param: string): Promise<Findings | null> {
  if (typeof window === "undefined") return null;
  try {
    const base64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const json = await new Response(stream).text();
    const parsed = JSON.parse(json);
    // Shape check — a corrupt or hand-edited param must not crash the page.
    if (!parsed?.vehicle?.make || !Array.isArray(parsed.items)) return null;
    return parsed as Findings;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add share state and the shared-view banner**

In `src/components/AgentConsole.tsx`, add `Share2` to the `lucide-react` import.

Then add the share import. Replace:

```ts
import { compressImageToDataUrl } from "@/lib/image";
```

with:

```ts
import { compressImageToDataUrl } from "@/lib/image";
import { encodeFindings, decodeFindings } from "@/lib/share";
```

Add state next to the existing `findings` state. Replace:

```ts
  const [findings, setFindings] = useState<Findings | null>(null);
```

with:

```ts
  const [findings, setFindings] = useState<Findings | null>(null);
  const [isSharedView, setIsSharedView] = useState(false);
```

Add a load-time effect right after the existing `useEffect`:

```ts
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
```

- [ ] **Step 4: Render the shared-view banner above the form**

Replace:

```tsx
    <div className="w-full max-w-3xl mx-auto">
      <PastAuditsList audits={pastAudits} />
```

with:

```tsx
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
```

- [ ] **Step 5: Add the share button to the results view**

Pass the flag down. Replace:

```tsx
          <ResultsView
            key={`${findings.vehicle.year}-${findings.vehicle.make}-${findings.vehicle.model}`}
            findings={findings}
            unit={unit}
          />
```

with:

```tsx
          <ResultsView
            key={`${findings.vehicle.year}-${findings.vehicle.make}-${findings.vehicle.model}`}
            findings={findings}
            unit={unit}
            isSharedView={isSharedView}
          />
```

Update the signature. Replace:

```ts
function ResultsView({ findings, unit }: { findings: Findings; unit: "mi" | "km" }) {
```

with:

```ts
function ResultsView({
  findings,
  unit,
  isSharedView,
}: {
  findings: Findings;
  unit: "mi" | "km";
  isSharedView?: boolean;
}) {
```

Add share state and handler right after the existing `copyState` declaration:

```ts
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
```

Add the button to the vehicle-summary card's badge row. Replace:

```tsx
        <div className="flex items-center gap-2 flex-wrap">
          {findings.dutyClassification === "severe" && (
```

with:

```tsx
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
```

- [ ] **Step 6: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run `npm run dev`, then:
1. Run any audit. Click "Share" and confirm the button reads "Link copied".
2. Paste the copied URL into a new tab. Confirm: the shared audit renders with all cards, the "You're viewing a shared audit" banner appears, the Share button is hidden, and the "Run your own →" link returns to a clean form.
3. Confirm the shared view did **not** add an entry to that browser's "Past audits" list.
4. Visit `/?r=garbage` and confirm the page loads the normal form with no error and no crash.
5. Regression: all previous features still work on a normal (non-shared) run.

Kill the dev server when done.

- [ ] **Step 8: Commit**

```bash
git add src/lib/share.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Add shareable audit links via URL-compressed findings

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: succeeds with no type or lint errors.

- [ ] **Step 2: Combined end-to-end check**

Run `npm run dev` and exercise one request that hits everything at once: VIN mode, a photo quote, driving conditions, an amount and ZIP. Confirm the result includes a researched schedule with citations, a recalls card (if applicable), DIY badges, a "Do this first" card, a price assessment, a dispute draft, and a working Share button — and that the whole request completes well under 60 seconds.

- [ ] **Step 3: Latency check**

Time the same request twice (second run = warm schedule cache). Confirm the second is meaningfully faster and that neither approaches the 60s Vercel Hobby ceiling.
