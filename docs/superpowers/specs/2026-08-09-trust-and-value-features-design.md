# Trust & value features — design

Date: 2026-08-09

## Context

The app now has a full agentic feature set (severe-duty judgment, dispute
drafting, follow-up chat, vehicle memory, photo intake, price checks). But it
has a credibility hole at its center and is missing the things that would make
someone recommend it.

**The credibility hole:** `src/lib/tools.ts` contains exactly three real
maintenance schedules — `TOYOTA|CAMRY`, `HONDA|CIVIC`, `FORD|F-150`. Every
other vehicle silently falls back to `GENERIC_SCHEDULE` (industry averages).
The app's entire promise is "checked against **your manufacturer's** schedule,"
and today that is literally true for three models. A 2022 Hyundai Elantra gets
generic averages while the UI reports a `scheduleSource` of "Hyundai
manufacturer schedule." Fixing this is prerequisite to everything else — no
added feature matters if the core number is invented.

These five tasks are ordered so trust comes first, then the things that make
the tool worth sharing.

## Verified technical constraints

Checked live before writing this spec:

- **NHTSA recalls API** (`api.nhtsa.gov/recalls/recallsByVehicle`) is free, needs
  no key, and works with `make`/`model`/`modelYear`. Passing `vin=` returns
  `Count: 0` — **VIN-level recall lookup is not available on this endpoint.**
  Results are therefore year/make/model-level and may not apply to every
  production batch. The UI must say so and link to NHTSA's VIN checker.
  (Verified: 2022 Hyundai Elantra → 5 recalls; 2012 Toyota Camry → 2 recalls.)
- **Share payload size**: a representative `Findings` object is 1,187 bytes of
  JSON, 1,584 base64, and **520 bytes gzip+base64** — comfortably URL-safe.
  Browsers provide `CompressionStream("gzip")` natively, so no new dependency
  and no database are needed for sharing.
- **`groq/compound-mini`** already does real web search with cited sources on
  this account (in production use for price checks). Same key, no new vendor.

## Task 1: Real schedule data

**Approach:** web search with cited sources, cached — chosen over hand-authoring
a bigger hardcoded table because a cited source is verifiable by the user,
whereas a table authored from model knowledge has the same trust problem as
today's mock data, just wider.

**Where it goes:** inside the existing `get_maintenance_schedule` tool, not as a
new pre-step. This preserves the agent loop and the reasoning trace (which gets
*more* informative: "Searching for the real 2022 Hyundai Elantra schedule..."),
and requires no restructuring of `runAgent`.

**Design:**
- `getMaintenanceSchedule(make, model, year)` gains a `year` param and becomes
  async. It calls `groq/compound-mini` asking for the manufacturer's published
  service intervals for that exact vehicle, returning items in the existing
  `MaintenanceItem` shape (`service`, `interval_miles`, `category`) plus source
  URLs.
- Bounded with a 20s timeout, consistent with the other model calls. On timeout,
  bad JSON, or an empty result, it falls back to the existing hardcoded table /
  `GENERIC_SCHEDULE` — never errors the audit.
- `ScheduleResult` gains `sources: string[]`. `Findings` gains
  `scheduleSources?: string[]`, rendered as citation links on the schedule card.
- The existing `exactMatch` flag now means "we found a real model-specific
  schedule." Badge copy becomes honest: `Real manufacturer schedule` (with
  source count) vs. `Generic estimate — no model-specific schedule found`.
- **Caching:** client sends a `cachedSchedule` in the request body when it has
  one for this vehicle in `localStorage`; the tool uses it instead of searching.
  On a fresh search, the resulting schedule is returned to the client (via the
  existing `tool_result` event, which the client already receives) and stored
  per vehicle. Repeat audits of the same vehicle skip the search entirely.
  Cache entries carry a timestamp and expire after 90 days.

**Why the cache is client-side:** consistent with the existing vehicle-history
design (no server database, no cost), and schedules are per-vehicle so a
per-user cache has a high hit rate for the common "same car, new quote" case.

## Task 2: Open recalls

**Design:**
- New `nhtsa_recalls` tool in `tools.ts` calling
  `https://api.nhtsa.gov/recalls/recallsByVehicle?make=&model=&modelYear=`,
  returning `{ count, recalls: [{ component, summary, remedy, campaignNumber }] }`,
  capped at the 5 most recent to bound prompt size.
- Added to `TOOL_SCHEMAS` so the agent calls it after the vehicle is identified.
  Because the agent already calls `vin_decode` and `get_maintenance_schedule` in
  sequence, this adds one fast (~1s) HTTP call, not a model round-trip.
- `Findings` gains `recalls?: { count: number; items: RecallItem[] }`.
- **UI placement: directly under the "Bottom line" summary, above the quote
  audit.** Open recalls are safety-relevant and repaired free — they outrank a
  pricing dispute in importance.
- **Honesty requirement (non-negotiable in copy):** results are year/make/model
  level, not VIN-exact. Card copy: *"N recalls reported for the {year} {make}
  {model}. Recall repairs are free at any dealer — confirm yours is affected
  using your VIN at NHTSA."* with a link to `nhtsa.gov/recalls`. The card must
  not say "your car has N recalls."
- No card renders when `count` is 0.

## Task 3: DIY flags

**Deliberately not LLM-judged.** A model deciding "you can DIY your brakes" is a
safety hazard. This is a small, conservative, hardcoded table.

**Design:**
- `DIY_SERVICES` table in `tools.ts`: keyed by normalized service name, each with
  `partCostRange` (e.g. `"$12-25"`), `minutes`, and a short `note`. Initial set
  limited to genuinely trivial items: cabin air filter, engine air filter, wiper
  blades, key fob battery, 12V battery.
- Matched **deterministically** server-side (reusing the existing
  `normalizeServiceName` helper) against both `quoteVerdicts` items and schedule
  `items` after findings are assembled — same "compute it in code, don't ask the
  model" pattern as `fillMissingScheduleItems`.
- `QuoteVerdict` and `FindingsItem` each gain `diy?: { partCostRange: string;
  minutes: number; note: string }`.
- Renders as a small inline badge — *"DIY-able · ~$15 part · 5 min"* — next to
  the quoted item. This is the highest-shareability output in the app: a $80
  quoted line sitting next to a $15 badge.
- Explicitly excludes anything safety-critical regardless of apparent
  simplicity.

## Task 4: Prioritization

**Design:**
- `MaintenanceItem` gains a `safetyCritical: boolean` field in the schedule data
  (brakes, tires, steering, suspension, lights) — set deterministically by
  keyword match in `tools.ts`, not by the model, so safety ranking can't be
  hallucinated away.
- `FindingsItem` gains `priority?: "safety" | "soon" | "can_wait"`, and
  `Findings` gains `actionPlan?: string`.
- The model assigns `priority` (this genuinely needs judgment — weighing
  overdue-ness against safety-criticality against the user's driving pattern),
  but with a hard prompt constraint: anything flagged `safetyCritical` **and**
  overdue/due-now must be `"safety"`. A server-side guard enforces this after
  the fact, same defensive pattern as the `exactMatch` coercion.
- `actionPlan` is 1-3 sentences: what to do first and what can wait, referencing
  concrete items.
- Renders as a "Do this first" card grouping items by priority, placed after the
  quote audit.

## Task 5: Shareable link

**Design:**
- `src/lib/share.ts`: `encodeFindings(findings)` → gzip via
  `CompressionStream("gzip")` → base64url; `decodeFindings(param)` → inverse,
  returning `null` on any malformed input.
- "Copy share link" button in the results header, alongside the existing
  dispute-draft copy button, producing `{origin}/?r=<payload>`.
- On load, `AgentConsole` checks for `?r=`; if present and decodable, renders the
  findings read-only with a banner: *"Viewing a shared audit"* and a button to
  start a fresh one. Malformed/corrupt payload → ignore the param silently and
  show the normal form.
- Shared views are **not** written to the viewer's `localStorage` vehicle
  history — it isn't their car.
- Size guard: if an encoded payload exceeds 8,000 characters (well past the
  measured 520 bytes, but possible with many quote items plus a long dispute
  draft), fall back to a "couldn't create a share link for this result" message
  rather than emitting a broken URL.

## Cross-cutting concerns

**Latency.** Task 1 adds a web search to the first audit of any new vehicle
(~6s), Task 2 adds ~1s. Current worst case is ~7-10s against a 60s Vercel Hobby
ceiling, so headroom is fine. The schedule cache makes repeat audits of the same
vehicle no slower than today. All new external calls are individually bounded by
timeouts.

**Groq quota.** Two web searches per audit worst case (schedule + price), on a
shared free key. The schedule cache is the main mitigation — a returning user
pays zero searches for schedule. Price search remains opt-in (only when an
amount is entered).

**Honesty.** Two places where the implementation must not overstate: recall
precision (year/make/model, not VIN) and schedule provenance (searched vs.
generic fallback). Both are explicit UI copy requirements above, not
nice-to-haves.

## Out of scope

- No user accounts, no server-side database, no paid APIs or new vendors.
- No email/SMS reminders (would require paid infrastructure).
- No shop recommendations or reviews (can't be sourced credibly for free).
- No changes to the existing photo-intake, follow-up-chat, or price-check
  features beyond adding the new fields above.
