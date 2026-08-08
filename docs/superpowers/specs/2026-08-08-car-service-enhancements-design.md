# Car service advisor — enhancements design

Date: 2026-08-08

## Context

The app (VIN + mileage + optional dealer quote → agent-generated maintenance
verdict) works end-to-end. Four improvements are requested:

1. The "Manufacturer maintenance schedule" card should reliably list every
   schedule item, not just the ones that happen to match a dealer quote.
2. Show an actual photo of the vehicle in the UI.
3. Let users who don't know their VIN enter year/make/model instead.
4. Let users enter/read mileage in km instead of miles.

## 1. Reliable full schedule

**Problem:** `agent.ts`'s system prompt instructs the model to return a status
for every item in the manufacturer schedule, but nothing enforces this. The
model may only emit items relevant to the dealer quote (observed: 4 of a
fuller schedule shown).

**Fix:** Deterministic server-side safety net in `agent.ts`.

- While the agent loop runs, capture the `ScheduleResult` returned by the
  `get_maintenance_schedule` tool call (the last one, if called more than
  once).
- When the model emits `present_findings`, before yielding the `final`
  event: for every item in the captured schedule whose `service` name has no
  reasonably-matching entry in `findings.items` (case-insensitive substring
  match is enough — same looseness the prompt already asks the model to use
  for quote matching), compute its status deterministically and append it.
- Status computation, given `interval_miles` and current `mileage`:
  - `lastMultiple = floor(mileage / interval) * interval`
  - `nextMultiple = lastMultiple + interval`
  - `sinceLast = mileage - lastMultiple`, `untilNext = nextMultiple - mileage`
  - if `lastMultiple > 0 && sinceLast <= 1000` → `overdue`-adjacent window is
    already past; treat as `due_now`, milesInfo `"due now (passed at Xk mi)"`
  - else if `untilNext <= 1000` → `due_now`, milesInfo `"due in N miles"`
  - else if `lastMultiple > 0 && sinceLast > 1000` → this window's due point
    already passed by more than the grace window → `overdue`, milesInfo
    `"N miles overdue"` (N = sinceLast)
  - else → `not_due`, milesInfo `"due in N miles"` (N = untilNext)
- This only fills gaps; items the model already returned are left as-is
  (the model's own reasoning wins there).
- No changes to the tool schemas or the prompt's intent — this is a
  belt-and-suspenders correctness fix, not a behavior change.

## 2. Vehicle photo

- New optional env var `NEXT_PUBLIC_IMAGIN_CUSTOMER_KEY`, defaulting to
  imagin.studio's public demo key (`"hello"`) so it works with zero setup;
  documented in `.env.local.example` with a note to get a real free key from
  imagin.studio for production use.
- In `ResultsView`'s vehicle-summary card, once `findings.vehicle` is known,
  render:
  `https://cdn.imagin.studio/getImage?customer=<key>&make=<make>&modelFamily=<model>&modelYear=<year>&angle=01`
- `onError` on the `<img>` swaps to the existing gradient+`Car`-icon square
  (covers unrecognized makes/models, key issues, or network failure) —
  implemented as local `imageFailed` state per results view, not a global
  flag.
- No new API route: this is a direct client-side image URL, no key is
  secret-worthy (public demo tier), so `NEXT_PUBLIC_` prefix is fine.

## 3. Manual year/make/model entry

- `AgentConsole` gets a `mode: 'vin' | 'manual'` state, defaulting to
  `'vin'`, switched via two tab buttons above the form.
- `'vin'` mode: unchanged — single VIN input.
- `'manual'` mode: three text inputs — Year (numeric, 4 digits), Make,
  Model — replacing the VIN input. Mileage and dealer-quote fields are
  shared between both modes.
- Submit validation: `vinValid` (17 chars) gates the button in `'vin'` mode;
  in `'manual'` mode the button is gated on year/make/model all being
  non-empty and year being a plausible 4-digit number.
- POST body becomes `{ mode, vin?, year?, make?, model?, mileage, quote }`.
- `route.ts`: branch on `mode`. For `'manual'`, skip VIN-format validation,
  validate year/make/model presence instead, and build a different user
  message that gives the agent the vehicle info directly and tells it to
  skip `vin_decode` and call `get_maintenance_schedule` right away.
- `runAgent`'s system prompt gets one added sentence: if the user message
  already states year/make/model directly, skip the VIN decode step.
- No changes to `present_findings`'s shape — `vehicle.trim`/`engine` will
  simply be absent for manual entries, which the schema already allows
  (`trim` optional).

## 4. Miles/km toggle

- `AgentConsole` gets `unit: 'mi' | 'km'` state (small toggle next to the
  mileage input), defaulting to `'mi'`.
- The mileage `<input>` always displays/accepts a number in the currently
  selected unit. Internally, before submit, convert to miles
  (`km * 0.621371`, rounded) if `unit === 'km'` — the agent and mock
  schedule data stay mile-based throughout.
- In `ResultsView`, when `unit === 'km'`: convert the displayed odometer
  reading, and convert the numeric portion of each `milesInfo` string for
  display (regex-extract the leading number, convert, rebuild the string
  with "km" swapped in for "miles"/"mi"). If a `milesInfo` string doesn't
  match the expected numeric pattern, display it unmodified rather than
  breaking — the conversion is a display nicety, not something to hard-fail
  on. `findings` itself is never mutated; conversion happens at render time,
  keyed off `unit`, so the toggle can flip after results are back without
  refetching.

## Out of scope

- No persistence, no history of past lookups.
- No make/model autocomplete or dropdown (plain text fields, consistent
  with the existing quote textarea's plain-text style).
- No trim-specific or multi-angle vehicle images.
- No unit conversion inside the model/prompt — it stays mile-only; km is a
  pure UI-layer concern.
