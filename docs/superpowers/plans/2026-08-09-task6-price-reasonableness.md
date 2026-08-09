# Task 6: Price Reasonableness (Web Search) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "This is due" only answers half the question people actually have — the other half is "is $X fair for it." Let a user optionally give the total amount quoted and a ZIP, and have a real web-search-grounded model check whether that price looks in-range, high, or low for the audited services on this vehicle.

**Architecture:** A second, separate model call — NOT folded into the main tool-calling loop — made only when both an amount and quote-verdicts exist. Uses `groq/compound-mini` (confirmed working on this account via a live test; the full `groq/compound` variant returned a `413 Request Entity Too Large` on every request on this account/tier and is not used). This model does its own internal web search autonomously — no `tools`/`tool_choice` params, no schema — and is asked to respond with plain JSON matching a fixed shape. The call is wrapped so any failure (timeout, bad JSON, search failure) just omits the result entirely; it never blocks or breaks the primary audit findings, which are already fully computed before this runs.

**Tech Stack:** Same as the rest of the app, same Groq account/key. No test runner — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual checks (curl and browser) against a live dev server.

---

### Task 1: Price reasonableness

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/agent.ts`
- Modify: `src/app/api/agent/route.ts`
- Modify: `src/components/AgentConsole.tsx`

- [ ] **Step 1: Add `PriceAssessment` to `src/lib/types.ts`**

Replace:

```ts
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
  disputeDraft?: string;
  transcribedItems?: string[];
};
```

with:

```ts
export type PriceVerdict = "in_range" | "high" | "low" | "unknown";

export type PriceAssessment = {
  verdict: PriceVerdict;
  explanation: string;
  sources: string[];
};

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
  disputeDraft?: string;
  transcribedItems?: string[];
  priceAssessment?: PriceAssessment;
};
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add the price-research model and function to `agent.ts`**

Replace:

```ts
import type { Findings, FindingsItem, AgentEvent, ChatMessage } from "./types";
```

with:

```ts
import type { Findings, FindingsItem, AgentEvent, ChatMessage, PriceAssessment } from "./types";
```

Replace:

```ts
const VISION_MODEL = "qwen/qwen3.6-27b";
```

with:

```ts
const VISION_MODEL = "qwen/qwen3.6-27b";
// Web-search-grounded model, used only for the optional price-reasonableness
// check. groq/compound (the full multi-tool-call variant) returned a 413 on
// every request on this account/tier — groq/compound-mini works and is
// confirmed (via a live test) to do real web search and return clean JSON
// when asked to. Same Groq account/key, no new vendor.
const PRICE_MODEL = "groq/compound-mini";
```

Add this new function after `fillMissingScheduleItems`, before `export async function* runAgent`:

```ts
// Separate, best-effort call — never blocks or breaks the primary audit.
// Returns null on any failure (bad JSON, network error, no verdict) so the
// caller can just skip attaching a priceAssessment.
async function assessPriceReasonableness(
  client: OpenAI,
  vehicle: Findings["vehicle"],
  quoteVerdicts: Findings["quoteVerdicts"],
  amountQuoted: number,
  zip: string
): Promise<PriceAssessment | null> {
  if (quoteVerdicts.length === 0) return null;

  const itemsList = quoteVerdicts.map((qv) => qv.item).join(", ");
  const prompt =
    `Search the web for typical price ranges for the following car repair/maintenance services: ` +
    `${itemsList}, for a ${vehicle.year} ${vehicle.make} ${vehicle.model}` +
    `${zip ? ` near ZIP ${zip}` : ""} in the US. The customer was quoted a total of $${amountQuoted}. ` +
    `Say whether that total looks in-range, high, or low compared to typical prices, with a brief ` +
    `explanation and 1-3 source URLs.`;

  try {
    const response = await client.chat.completions.create({
      model: PRICE_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a car repair pricing research assistant. Use web search to find real, current " +
            "typical prices. Respond with ONLY a JSON object, no other text, no markdown fences, " +
            'matching this exact shape: {"verdict": "in_range" | "high" | "low" | "unknown", ' +
            '"explanation": string, "sources": string[]}.',
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = response.choices[0].message.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.verdict !== "string" || typeof parsed.explanation !== "string") {
      return null;
    }

    return {
      verdict: parsed.verdict,
      explanation: parsed.explanation,
      sources: Array.isArray(parsed.sources) ? parsed.sources.filter((s: unknown) => typeof s === "string") : [],
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Thread `amountQuoted`/`zip` through `runAgent` and call the price check**

Replace:

```ts
export async function* runAgent(userMessage: string, quoteImage?: string): AsyncGenerator<AgentEvent> {
```

with:

```ts
export async function* runAgent(
  userMessage: string,
  quoteImage?: string,
  amountQuoted?: number,
  zip?: string
): AsyncGenerator<AgentEvent> {
```

Replace the `present_findings` branch:

```ts
      if (tc.function.name === "present_findings") {
        // Some tool-calling models (e.g. qwen3.6-27b, used for the vision path) serialize
        // booleans as Python-style "True"/"False" strings instead of JSON booleans. Coerce
        // defensively so downstream code always sees a real boolean, regardless of model.
        const rawFindings = args as Omit<Findings, "exactMatch"> & { exactMatch: boolean | string };
        if (typeof rawFindings.exactMatch === "string") {
          rawFindings.exactMatch = rawFindings.exactMatch.trim().toLowerCase() === "true";
        }
        const findings = fillMissingScheduleItems(rawFindings as Findings, lastSchedule, rawFindings.mileage);
        yield { type: "final", findings };
        return;
      }
```

with:

```ts
      if (tc.function.name === "present_findings") {
        // Some tool-calling models (e.g. qwen3.6-27b, used for the vision path) serialize
        // booleans as Python-style "True"/"False" strings instead of JSON booleans. Coerce
        // defensively so downstream code always sees a real boolean, regardless of model.
        const rawFindings = args as Omit<Findings, "exactMatch"> & { exactMatch: boolean | string };
        if (typeof rawFindings.exactMatch === "string") {
          rawFindings.exactMatch = rawFindings.exactMatch.trim().toLowerCase() === "true";
        }
        const findings = fillMissingScheduleItems(rawFindings as Findings, lastSchedule, rawFindings.mileage);

        if (amountQuoted && amountQuoted > 0) {
          const priceAssessment = await assessPriceReasonableness(
            client,
            findings.vehicle,
            findings.quoteVerdicts,
            amountQuoted,
            zip || ""
          );
          if (priceAssessment) {
            findings.priceAssessment = priceAssessment;
          }
        }

        yield { type: "final", findings };
        return;
      }
```

- [ ] **Step 6: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Thread `amountQuoted`/`zip` through the API route**

In `src/app/api/agent/route.ts`, replace the body-parsing block:

```ts
  const body = await req.json();
  const { mode, vin, year, make, model, mileage, quote, drivingConditions, historyNote, quoteImage } = body as {
    mode?: "vin" | "manual";
    vin?: string;
    year?: string;
    make?: string;
    model?: string;
    mileage?: number;
    quote?: string;
    drivingConditions?: string;
    historyNote?: string;
    quoteImage?: string;
  };
```

with:

```ts
  const body = await req.json();
  const {
    mode,
    vin,
    year,
    make,
    model,
    mileage,
    quote,
    drivingConditions,
    historyNote,
    quoteImage,
    amountQuoted,
    zip,
  } = body as {
    mode?: "vin" | "manual";
    vin?: string;
    year?: string;
    make?: string;
    model?: string;
    mileage?: number;
    quote?: string;
    drivingConditions?: string;
    historyNote?: string;
    quoteImage?: string;
    amountQuoted?: number;
    zip?: string;
  };

  const validAmountQuoted =
    typeof amountQuoted === "number" && Number.isFinite(amountQuoted) && amountQuoted > 0
      ? amountQuoted
      : undefined;
  const trimmedZip = typeof zip === "string" ? zip.trim() : "";
```

Replace the `runAgent` call:

```ts
        for await (const event of runAgent(userMessage, quoteImage)) {
```

with:

```ts
        for await (const event of runAgent(userMessage, quoteImage, validAmountQuoted, trimmedZip)) {
```

(`amountQuoted`/`zip` are supplementary and best-effort — an invalid/missing value simply means the price check is skipped, not a 400. This matches the "never blocks the core audit" design.)

- [ ] **Step 8: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 9: Add the amount/ZIP fields and price-assessment card to `AgentConsole.tsx`**

Add the new icons to the existing `lucide-react` import. Replace:

```ts
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
} from "lucide-react";
```

with:

```ts
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
  DollarSign,
  MapPin,
  Search,
  ExternalLink,
} from "lucide-react";
```

Add state for the new fields. Replace:

```ts
  const [drivingConditions, setDrivingConditions] = useState("");
```

with:

```ts
  const [drivingConditions, setDrivingConditions] = useState("");
  const [amountQuoted, setAmountQuoted] = useState("");
  const [zip, setZip] = useState("");
```

Include them in the request body. Replace:

```ts
    const effectiveQuote = quoteMode === "photo" ? "" : quote;
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
              }
        ),
      });
```

with:

```ts
    const effectiveQuote = quoteMode === "photo" ? "" : quote;
    const effectiveQuoteImage = quoteMode === "photo" ? quoteImage || undefined : undefined;
    const parsedAmount = Number(amountQuoted);
    const effectiveAmountQuoted =
      amountQuoted.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0
        ? parsedAmount
        : undefined;

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
                amountQuoted: effectiveAmountQuoted,
                zip: zip.trim(),
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
                amountQuoted: effectiveAmountQuoted,
                zip: zip.trim(),
              }
        ),
      });
```

Add the two new fields to the form JSX, right after the driving-conditions field. Replace:

```tsx
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

with:

```tsx
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
              <DollarSign className="size-4 text-accent" />
              Amount quoted <span className="text-white/30 font-normal">(optional)</span>
            </label>
            <input
              type="number"
              min={0}
              value={amountQuoted}
              onChange={(e) => setAmountQuoted(e.target.value)}
              placeholder="189.99"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition"
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
```

- [ ] **Step 10: Add price-verdict styling and the "Is the price fair?" card in `ResultsView`**

Add a metadata map next to the existing `VERDICT_META`. Replace:

```ts
const VERDICT_META: Record<
  Findings["quoteVerdicts"][number]["verdict"],
  { label: string; color: string; Icon: typeof CheckCircle2 }
> = {
  justified: { label: "Justified", color: "text-ok border-ok/30 bg-ok/10", Icon: CheckCircle2 },
  premature: { label: "Premature", color: "text-warn border-warn/30 bg-warn/10", Icon: AlertTriangle },
  not_on_schedule: { label: "Not on schedule", color: "text-danger border-danger/30 bg-danger/10", Icon: XCircle },
};
```

with:

```ts
const VERDICT_META: Record<
  Findings["quoteVerdicts"][number]["verdict"],
  { label: string; color: string; Icon: typeof CheckCircle2 }
> = {
  justified: { label: "Justified", color: "text-ok border-ok/30 bg-ok/10", Icon: CheckCircle2 },
  premature: { label: "Premature", color: "text-warn border-warn/30 bg-warn/10", Icon: AlertTriangle },
  not_on_schedule: { label: "Not on schedule", color: "text-danger border-danger/30 bg-danger/10", Icon: XCircle },
};

const PRICE_VERDICT_META: Record<
  NonNullable<Findings["priceAssessment"]>["verdict"],
  { label: string; color: string }
> = {
  in_range: { label: "Looks fair", color: "text-ok border-ok/30 bg-ok/10" },
  high: { label: "Looks high", color: "text-danger border-danger/30 bg-danger/10" },
  low: { label: "Looks low", color: "text-accent border-accent/30 bg-accent/10" },
  unknown: { label: "Uncertain", color: "text-white/50 border-white/20 bg-white/5" },
};
```

Destructure `priceAssessment` in `ResultsView`. Replace:

```ts
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
  } = findings;
```

with:

```ts
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
    priceAssessment,
  } = findings;
```

Add the card right after the "Quote audit" card, before the "Dispute draft" card. Replace:

```tsx
      {/* Dispute draft, if the model produced one */}
```

with:

```tsx
      {/* Price reasonableness, if an amount was given and the model produced an assessment */}
      {priceAssessment && (
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Search className="size-4 text-accent" />
              Is the price fair?
            </div>
            <span
              className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${PRICE_VERDICT_META[priceAssessment.verdict].color}`}
            >
              {PRICE_VERDICT_META[priceAssessment.verdict].label}
            </span>
          </div>
          <p className="text-sm text-white/70 leading-relaxed">{priceAssessment.explanation}</p>
          {priceAssessment.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {priceAssessment.sources.map((source, i) => (
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
        </div>
      )}

      {/* Dispute draft, if the model produced one */}
```

- [ ] **Step 11: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 12: Manual verification**

Run: `npm run dev`. Test via curl first (faster iteration than the browser for this):
  1. Submit a request with a quote, an `amountQuoted`, and a `zip` directly to `/api/agent` and confirm the final `findings` includes a `priceAssessment` with a real `verdict`/`explanation`/non-empty `sources` array (real URLs, not placeholders).
  2. Submit the same request WITHOUT `amountQuoted` and confirm `priceAssessment` is absent — no extra latency, no error.
  3. Submit with an `amountQuoted` but NO quote items (`quoteVerdicts` ends up empty) and confirm `priceAssessment` is still absent (the function short-circuits when there's nothing to price-check).
  Then do at least one real browser pass: fill in the amount/ZIP fields, submit, and confirm the "Is the price fair?" card renders correctly with a verdict badge and clickable source links (hostname-only labels, opening in a new tab).
  Kill the dev server when done.

- [ ] **Step 13: Commit**

```bash
git add src/lib/types.ts src/lib/agent.ts src/app/api/agent/route.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Add price-reasonableness check via web search (groq/compound-mini)

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

Manually confirm: VIN mode, manual entry mode, km/mi toggle, severe-duty badge, dispute-draft card, vehicle memory, follow-up chat, and photo intake all still work exactly as before when the amount/ZIP fields are left blank — price reasonableness is purely additive and never blocks the primary audit even if the price-research call fails or times out.
