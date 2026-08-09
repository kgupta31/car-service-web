# Task 2: Dispute Message Drafting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the agent finds at least one dealer-quoted item that isn't fully justified, have it draft a short, specific, ready-to-send message the user can hand to the shop — turning a verdict into an action, not just information.

**Architecture:** Purely additive, same shape as Task 1. One new optional field on `present_findings`'s schema and on `Findings` → one new system-prompt instruction → one new "What to say" card in the results UI with a copy-to-clipboard button. No new tools, no new routes, no new dependencies.

**Tech Stack:** Same as the rest of the app. No test runner — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual checks against a live dev server.

---

### Task 1: Dispute drafting

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/agent.ts`
- Modify: `src/components/AgentConsole.tsx`

- [ ] **Step 1: Add `disputeDraft` to the `Findings` type**

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
  dutyClassification?: DutyClassification;
  dutyReason?: string;
};
```

with:

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
};
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add the system-prompt instruction in `agent.ts`**

In `src/lib/agent.ts`, in `SYSTEM_PROMPT`, replace the final instruction line:

```
7. Finish by calling present_findings with the full structured result — this IS your final answer,
   do not also write a text response after it. Include a concise plain-English summary sentence.`;
```

with:

```
7. If ANY quote item's verdict is "premature" or "not_on_schedule", draft a short, polite,
   specific message the user could say or send to the shop pushing back on it — cite the exact
   manufacturer-schedule numbers (e.g. "My schedule shows transmission service at 60,000 miles;
   I'm at 32,000, so this is premature by 28,000 miles — can you clarify what's prompting it
   now?"). Put this in disputeDraft. If every quote item is "justified" (or no quote was given),
   leave disputeDraft out entirely.
8. Finish by calling present_findings with the full structured result — this IS your final answer,
   do not also write a text response after it. Include a concise plain-English summary sentence.`;
```

- [ ] **Step 4: Add `disputeDraft` to `PRESENT_FINDINGS_TOOL`'s schema**

In the same file, replace:

```ts
        summary: { type: "string" },
        dutyClassification: { type: "string", enum: ["normal", "severe"] },
        dutyReason: { type: "string" },
      },
      required: ["vehicle", "mileage", "scheduleSource", "exactMatch", "items", "quoteVerdicts", "summary"],
```

with:

```ts
        summary: { type: "string" },
        dutyClassification: { type: "string", enum: ["normal", "severe"] },
        dutyReason: { type: "string" },
        disputeDraft: { type: "string" },
      },
      required: ["vehicle", "mileage", "scheduleSource", "exactMatch", "items", "quoteVerdicts", "summary"],
```

(Not in `required` — most audits won't need it.)

- [ ] **Step 5: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Add the "What to say" card to `ResultsView` in `AgentConsole.tsx`**

First, add `Copy` and `Check` to the existing `lucide-react` import. Replace:

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
} from "lucide-react";
```

Add `useState`-backed copy state and a small helper inside `ResultsView`. Replace:

```ts
function ResultsView({ findings, unit }: { findings: Findings; unit: "mi" | "km" }) {
  const { vehicle, mileage, items, quoteVerdicts, summary, exactMatch, scheduleSource } = findings;
  const displayMileage = unit === "km" ? milesToKm(mileage) : mileage;
```

with:

```ts
function ResultsView({ findings, unit }: { findings: Findings; unit: "mi" | "km" }) {
  const { vehicle, mileage, items, quoteVerdicts, summary, exactMatch, scheduleSource, disputeDraft } = findings;
  const displayMileage = unit === "km" ? milesToKm(mileage) : mileage;
  const [copied, setCopied] = useState(false);

  async function copyDisputeDraft() {
    if (!disputeDraft) return;
    await navigator.clipboard.writeText(disputeDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
```

Then insert the new card right after the "Quote audit" card's closing `)}` and before the "Full schedule status" card. Replace:

```tsx
      {/* Full schedule status */}
```

with:

```tsx
      {/* Dispute draft, if the model produced one */}
      {disputeDraft && (
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 text-accent" />
              What to say
            </div>
            <button
              type="button"
              onClick={copyDisputeDraft}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/10 transition"
            >
              {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">{disputeDraft}</p>
        </div>
      )}

      {/* Full schedule status */}
```

- [ ] **Step 7: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 8: Manual verification**

Run: `npm run dev`. Submit a VIN or manual entry with a quote that includes at least one item clearly premature or not on schedule (e.g. "Timing belt replacement" for a car where that's not on the mock schedule at all). Confirm:
  - A "What to say" card appears with a specific drafted message referencing real numbers from the schedule.
  - Clicking "Copy" changes the button to "Copied" briefly and actually puts the text on the clipboard (paste it somewhere to confirm).
  Then submit a request with NO quote (or a quote where everything is justified) and confirm the "What to say" card does NOT appear.

- [ ] **Step 9: Commit**

```bash
git add src/lib/types.ts src/lib/agent.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Add dispute message drafting for premature/not-on-schedule quote items

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

Manually confirm: VIN mode, manual entry mode, km/mi toggle, severe-duty badge (from Task 1), full schedule card, and dealer-quote audit all still work independent of whether a dispute draft is produced.
