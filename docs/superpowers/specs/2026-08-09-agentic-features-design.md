# Agentic features — design

Date: 2026-08-09

## Context

The current agent loop is mostly deterministic: decode VIN → look up schedule →
compare against a user-typed quote → emit structured findings. Most of that
could be (and partly already is, via `fillMissingScheduleItems`) plain code.
This pass adds six features that require genuine LLM judgment, tool use mid-
reasoning, or multi-turn interaction — the things a static site or a fixed
API pipeline can't do.

**Constraint validated via research:** everything below runs on the existing
`GROQ_API_KEY` with no new vendor:
- `meta-llama/llama-4-scout-17b-16e-instruct` — native vision, up to 5 images,
  hosted by Groq — powers photo intake (Task 5).
- `groq/compound` — a Groq-hosted compound system with a built-in
  `web_search` tool (backed by Tavily internally, no separate key needed) —
  powers price-reasonableness (Task 6).
- "Vehicle memory" (Task 4) uses browser `localStorage`, not a database —
  zero infra, zero cost, consistent with the standing "no unnecessary bills"
  constraint.

Tasks are independent of each other and are built/PR'd/merged one at a time,
easiest first.

## Task 1: Severe-duty driving-condition judgment

**Problem:** Manufacturers publish two schedules — "normal" and "severe"
(towing, dusty/off-road, short trips, extreme temps, extensive idling). Which
one applies is a judgment call from a free-text description of how someone
drives, not a lookup.

**Design:**
- Add an optional "Driving conditions" textarea to the form (placeholder:
  "e.g. I tow a small trailer most weekends, lots of short trips in winter").
- Pass it through to the agent's user message when non-empty.
- System prompt gets a new instruction: if driving-condition info is given,
  reason about whether it qualifies as "severe" duty per common manufacturer
  definitions, and if so, tighten intervals accordingly (roughly: routine
  service intervals typically halve under severe duty — this is a
  reasoning instruction for the model, not a hardcoded rule) and say so
  explicitly in the summary.
- `Findings` gets one new optional field: `dutyClassification?: "normal" |
  "severe"` with a one-sentence `dutyReason` — surfaced in the UI as a small
  badge on the vehicle-summary card.
- No new tools, no new UI complexity beyond one textarea + one badge.

## Task 2: Dispute message drafting

**Problem:** A verdict ("this is padding") is information; most people don't
know how to turn that into pushback at the counter.

**Design:**
- `present_findings` gets one new field: `disputeDraft?: string` — a short,
  polite, specific message the model drafts when at least one quote item is
  `premature` or `not_on_schedule`, citing the manufacturer schedule numbers
  directly (e.g. "My manual/schedule shows transmission service at 60,000
  miles; I'm at 32,000, so this is premature by 28,000 miles — can you
  clarify what's prompting it now?").
- UI: a new card ("What to say") shown only when `disputeDraft` is present,
  with a "Copy" button (`navigator.clipboard.writeText`).
- System prompt instruction added: after computing quote verdicts, if any
  are not `justified`, draft this message as part of the same
  `present_findings` call — no extra round trip.

## Task 3: Follow-up conversational chat

**Problem:** The interaction is one-shot. Real questions ("why do you think
this is padding?", "what should I ask them?") need a follow-up turn that
still has the full context (vehicle, schedule, quote, prior findings).

**Design:**
- New `/api/agent/followup` route (SSE, mirrors `/api/agent`'s streaming
  shape) that takes `{ findings: Findings, history: {role, content}[],
  question: string }` and re-invokes the model with a system prompt scoped to
  "answer follow-up questions about this specific audit," seeded with the
  original findings as context (no new tool calls needed — the schedule/
  verdict data is already known).
- UI: once `findings` exists, show a small chat box below the results
  (bubble list + input). Session-only state (no persistence beyond the page
  — Task 4 handles cross-visit memory separately). Reuses the existing SSE
  streaming/trace-rendering pattern already built for the main flow.
- Turn cap (e.g. 6 exchanges) to bound cost per session, enforced client-side
  by disabling the input past the cap.

## Task 4: Vehicle memory across visits (localStorage)

**Problem:** Nothing is remembered between visits, so a repeat/duplicate
charge across visits can't be caught, and users have to re-enter everything
each time.

**Design:**
- On a successful `final` event, save a compact record `{ vin, vehicle,
  mileage, timestamp, quoteVerdicts, summary }` to `localStorage` under a
  namespaced key, keyed by VIN (or by year+make+model for manual-entry
  vehicles), capped at the last 10 audits per vehicle.
- Before submitting a new request for a VIN/vehicle with prior history,
  include a compact summary of past audits in the user message ("Note: this
  vehicle was audited before — on <date> at <mileage>, <service> was quoted
  and flagged as <verdict>"), and add a system-prompt instruction to flag
  likely duplicate billing when a previously-flagged-premature item
  reappears in a new quote at a similar mileage.
- UI: a small "Past audits for this vehicle" collapsible list (dates,
  mileage, one-line summary) shown above the form when history exists for
  the entered VIN — pure client-side read, no backend change needed to
  display it.
- Privacy: entirely client-side, nothing sent to any server except the
  compact text folded into the existing prompt; document this in the UI
  ("stored only in your browser").

## Task 5: Photo/invoice intake (vision)

**Problem:** Manually retyping a paper quote's line items is the single
biggest friction point for actually using this tool in the moment (standing
at the dealership counter).

**Design:**
- Add an "Upload a photo of your quote" option next to the existing
  comma-separated quote textarea (either/or, not both).
- Client: read the image as a data URL, send as part of the POST body
  (`quoteImage?: string`, base64 data URL — size-capped, e.g. 4MB, with a
  client-side resize/compress pass before encoding to keep requests small).
- Server: when `quoteImage` is present, switch the model for this request to
  `meta-llama/llama-4-scout-17b-16e-instruct` and include the image in the
  first user message using the OpenAI-compatible `image_url` content-part
  format; instruct the model to first transcribe visible line items/prices
  from the image, then proceed with the normal audit flow using the
  transcribed items as the quote.
- `Findings` gets an optional `transcribedItems?: string[]` so the UI can
  show "Here's what we read from your photo" for the user to sanity-check
  against garbled OCR.
- Fallback: if the model reports it couldn't read the image clearly, surface
  that as a normal `error` event rather than guessing.

## Task 6: Price reasonableness (web search)

**Problem:** "This is due" doesn't answer "is $800 fair for it" — that needs
current, real-world data, which is exactly a retrieval task.

**Design:**
- Per-line-item pricing is overkill for v1. Instead, add one optional
  "Amount quoted ($)" field (total) and one optional "ZIP / region" field
  to the form.
- New server step: when both are present, after the normal findings are
  computed, make a second, separate call to `groq/compound` (not the main
  tool-calling model) with a tightly scoped prompt: "search for typical
  price range for `<justified/premature line items>` for a `<year make
  model>` near `<ZIP>`, and say whether `<amount>` looks in-range, high, or
  low, with 1-2 cited sources." This is a separate call (not folded into the
  main agent loop) so a slow/failed web search never blocks the core
  schedule audit from returning.
- `Findings` gets an optional `priceAssessment?: { verdict: "in_range" |
  "high" | "low" | "unknown"; explanation: string; sources: string[] }`.
- UI: a "Is the price fair?" card, shown only when present, rendered after
  the dealer-quote-audit card. Sources rendered as small linked citations.
- If the second call fails or times out, omit `priceAssessment` entirely
  (already-returned findings aren't blocked or delayed by it) — implemented
  as a fire-after step, not inline in the streaming loop.

## Out of scope (all tasks)

- No user accounts/auth, no server-side database, no payment/paid tiers.
- No mobile app — web only.
- Task 3's chat and Task 6's price search are both capped/bounded to control
  Groq usage on a shared free-tier key (turn caps, single non-retrying
  search call).
