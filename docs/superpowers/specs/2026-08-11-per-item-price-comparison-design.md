# Per-item price comparison — design

Date: 2026-08-11

## Context

The app currently has one price check: if the user enters a single total
`amountQuoted`, `assessPriceReasonableness` does a web search (via
`groq/compound-mini`) and returns one overall verdict — `in_range` / `high` /
`low` / `unknown` — for the whole quote. That's useful but coarse: it can't
tell the user *which* line item is the problem, and it requires typing a
total the user may not have broken out by service.

The ask: compare what the dealer charged for each service against what that
service typically costs elsewhere, per line item — not just one number for
the whole quote.

## Decisions made (brainstorming)

- **Price input**: add an optional `$` field per quoted service (not just one
  total), *and* auto-extract a price from the quote photo when one's visibly
  printed next to a line item. Both together — typed entry as the baseline,
  photo extraction as a convenience that pre-fills it.
- **Search strategy**: one batched web-search call covering every quoted
  service at once, same cost/shape as today's single price check — not one
  search per item. Cost scaling with quote length was the deciding factor,
  given this account's Groq quota has been the project's main operational
  constraint all session.
- **Trigger**: runs whenever the user lists quoted services at all, price
  optional. A typical-price range has value even with no dealer price to
  compare against (e.g. "cabin air filters typically run $40-75" is useful on
  its own) — so this isn't gated behind "did they type a price," only behind
  "did they list any services."
- **Replaces, doesn't add to**, the existing single overall verdict.
  `PriceAssessment` and `assessPriceReasonableness` go away entirely. Any
  bottom-line stat about pricing (e.g. "2 of 5 items priced above typical
  range") is computed deterministically in code from the per-item data, the
  same way `buildFactualHighlights` already does for overdue counts and
  recalls — never asked of the model as a separate judgment.

## Design

### Data flow

`assessItemPrices(quoteVerdicts, vehicle, zip)` replaces
`assessPriceReasonableness`. One `groq/compound-mini` call, given the full
list of quoted service names plus vehicle + region, asking for a typical
price range **per service** — not a verdict, just researched numbers:

```
{ items: [{ service: string, typicalLow: number, typicalHigh: number }], sources: string[] }
```

Bounded by the same 15s timeout as today's call. Returns `null` on any
failure (bad JSON, timeout, empty result) — the audit never errors because of
this, same as every other best-effort call in this app.

The **verdict** (over / under / in-range / unknown) per item is computed in
code by comparing the user's entered `priceQuoted` against the returned
range — not asked of the model. This matches how DIY flags, safety priority,
and the quote-verdict safety net already work: the model researches facts,
code does the arithmetic and judgment on money.

### Type changes

`QuoteVerdict` (`src/lib/types.ts`) gains:

```ts
priceQuoted?: number;
priceComparison?: {
  typicalLow: number;
  typicalHigh: number;
  verdict: "over" | "under" | "in_range" | "unknown";
  sources: string[];
};
```

`PriceAssessment` type is deleted. `Findings.priceAssessment` field is
deleted.

### Request contract change

The `quote` field in the `/api/agent` request body changes from a
comma-separated string to a structured array:

```ts
quote: { service: string; price?: number }[]
```

This is the one real breaking-ish change in this feature. Positional/parsed
pairing (e.g. "Oil change - $80, Cabin filter") was considered and rejected —
too fragile, ambiguous to parse, and this app already prefers structured
fields over parsing free text wherever the UI can just ask directly (see:
separate year/make/model fields instead of a single text box).

Route validation (`src/app/api/agent/route.ts`) applies the same caps
already in place for quote items — `MAX_QUOTE_ITEMS` (20), each service name
capped at `MAX_QUOTE_ITEM_LENGTH` (200 chars) — plus a new check: `price`, if
present, must be a finite positive number, otherwise dropped (not rejected —
same "malformed optional input degrades gracefully" pattern used everywhere
else in this route).

`buildUserMessage` renders each item with its price inline when given:

```
My dealership/shop has proposed the following services:
- Oil change ($80)
- Cabin air filter replacement
```

### Photo extraction

**Correction found while writing the implementation plan:** the original
draft of this section assumed extracted items get shown as editable rows
before the user submits. They don't — photo mode and typed-item mode are
already mutually exclusive single-submission flows today (`quoteMode: "text"
| "photo"` in `AgentConsole.tsx`); the photo is transcribed server-side as
part of the one request that also runs the full audit, and transcribed items
are only ever shown afterward, read-only, in the existing "Read from your
photo" section. Adding a pre-submit preview/edit round-trip would be a
materially bigger UI change than this feature calls for, so this design does
not add one — it follows the existing pattern instead.

`transcribeQuoteImage`'s vision prompt/schema extends from
`{ items: string[] }` to `{ items: [{ service: string, price: number | null }] }`.
Extracted `{service, price}` pairs flow straight into the audit exactly like
extracted item *names* already do today — no user edit step. The existing
"Read from your photo" section gets extended to also show the extracted
price next to each line, still read-only. `price: null` just means no price
comparison badge shows for that item (same as manual entry with no price
typed).

### UI

In typed-entry mode (`quoteMode === "text"`), the quote-entry textarea
becomes a dynamic list: one row per service, each with a name field and an
optional `$` field, plus add/remove row controls. Photo mode is untouched
apart from what's described above (its own upload UI, unaffected). The
"Amount quoted" field is removed — the sum of itemized prices already gives
the total, so a separate field is redundant. ZIP/region is unchanged (still
used to localize the price search).

Each item in the results view gets a small inline badge next to its
verdict, mirroring the existing DIY-badge visual pattern:

- Price given, range found, and it's outside the range: `$80 quoted · typical
  $45-70 · 30% over` in the app's existing warning color.
- Price given and in range: `$55 quoted · typical $45-70 · in range` in a
  neutral/positive tone.
- No price given, range found: `typical $45-70` — reference only, no
  over/under claim, since there's no dealer price for *that specific line*
  to compare against.
- No range found for that item (search failed, or nothing relevant found):
  no badge — same silent graceful-degradation already used for DIY flags and
  schedule sources.

A one-line disclaimer near the price section states these are general
web-search ranges, not a specific local shop's quote — same honesty
requirement already applied to the recalls feature ("reported for this
year/make/model," never "your car has"). `sources` from the batched search
response are rendered once, as a shared citation list under the disclaimer
(clickable hostname links, same pattern as the schedule card's sources) —
not per item, since the search itself isn't per item.

### Bottom-line integration

`buildFactualHighlights` (in `src/lib/agent.ts`, added for the
summary-fallback fix) gains one more fact type: when one or more items have
`priceComparison.verdict === "over"`, append `"N item(s) priced above
typical range"` to the deterministic highlights attached to the summary —
consistent with how overdue counts, recall counts, and flagged quote items
are already surfaced there.

## Out of scope

- No real-time competitor-shop pricing API (doesn't exist for free) — this
  is general web-search-derived typical ranges, same caveat as the schedule
  and recall features.
- No migration for old shared links (`?r=` URLs generated before this
  change) — they'll still decode fine (`decodeFindings`'s shape check
  doesn't touch `priceAssessment`), just won't show the new price-comparison
  UI, since the field it depended on is gone. Treated as an acceptable
  edge case for an ephemeral share link, not a data-loss issue.
- No change to the existing schedule-research, recalls, DIY-flag, or
  prioritization features beyond what's listed above.
