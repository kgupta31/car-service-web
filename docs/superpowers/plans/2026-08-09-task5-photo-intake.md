# Task 5: Photo/Invoice Intake (Vision) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a photo of their dealer/shop quote instead of typing it in. The server switches to a vision-capable Groq model for that request, has the model transcribe the visible line items from the photo, then runs the normal audit using those as the quote — removing the single biggest friction point (manually retyping a paper quote) for actually using this tool in the moment.

**Architecture:** Client-side image compression (canvas resize + JPEG re-encode) keeps the request small; the compressed image travels as a base64 data URL in the existing POST body, alongside a boolean signal for "there's a photo." The server validates format/size, and `runAgent` picks between the existing tool-calling model and a vision-capable one (`meta-llama/llama-4-scout-17b-16e-instruct`, same Groq account, no new vendor) based on whether an image is present, sending the image as a multi-part message. A new `transcribedItems?: string[]` field on `Findings` lets the UI show what was read from the photo so the user can sanity-check it against garbled OCR.

**Tech Stack:** Same as the rest of the app, plus the OpenAI SDK's multi-part vision message format (already supported by the installed `openai` package — no new dependency). No test runner — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual checks against a live dev server using an actual photo.

---

### Task 1: Photo intake

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/agent.ts`
- Modify: `src/app/api/agent/route.ts`
- Create: `src/lib/image.ts`
- Modify: `src/components/AgentConsole.tsx`

- [ ] **Step 1: Add `transcribedItems` to the `Findings` type**

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
  disputeDraft?: string;
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
  transcribedItems?: string[];
};
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add the vision model, the photo-transcription instruction, and the schema field in `agent.ts`**

In `src/lib/agent.ts`, replace:

```ts
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// A current Groq-hosted model that supports tool calling. Check
// https://console.groq.com/docs/tool-use if this gets deprecated.
const MODEL = "llama-3.3-70b-versatile";
```

with:

```ts
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// A current Groq-hosted model that supports tool calling. Check
// https://console.groq.com/docs/tool-use if this gets deprecated.
const MODEL = "llama-3.3-70b-versatile";
// Vision-capable model, used only when the request includes a quote photo.
// Same Groq account/key as MODEL, no new vendor. Check
// https://console.groq.com/docs/vision if this gets deprecated.
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
```

Replace the entire `SYSTEM_PROMPT` constant:

```ts
const SYSTEM_PROMPT = `You are a car maintenance advisor agent. Your job is to protect the user
from paying for services they don't yet need, while also flagging services that genuinely ARE
due or overdue.

You have tools to decode a VIN and look up a manufacturer maintenance schedule. Use them. Do not
guess at maintenance intervals from memory if a tool can give you real data.

Given a VIN, the car's current mileage, and (optionally) a list of services a dealership or shop
has proposed, you must:

1. Call vin_decode to confirm make/model/year — unless the user already told you the
   year/make/model directly (no VIN given), in which case skip this step.
2. Call get_maintenance_schedule for that make/model.
3. For EACH service in the manufacturer schedule, determine status based on current mileage:
   "overdue", "due_now" (within ~1,000 miles of the interval), or "not_due" — using the interval
   and its multiples (an item due every 10,000 miles is due at 10k, 20k, 30k...). Always include
   a short milesInfo string with the concrete number, e.g. "2,400 miles overdue" or "due in 3,600 miles".
4. If the user gave you a list of dealer-proposed services, match each one against the manufacturer
   schedule (loosely worded matches are fine, e.g. "trans flush" -> "Transmission fluid service")
   and give a verdict: "justified" (due/overdue per schedule), "premature" (on schedule, not due yet
   — say by how much in the explanation), or "not_on_schedule" (not on the manufacturer schedule at
   all — the most likely padding).
5. Be direct and specific with numbers. This is a tool for someone about to spend real money.
6. If the user described their driving conditions, judge whether that qualifies as "severe duty"
   under common manufacturer definitions — frequent towing/hauling, dusty or off-road conditions,
   extensive idling or very short trips (under ~10 minutes), extreme heat or cold, or heavy
   stop-and-go traffic. If it qualifies, say so explicitly and note that routine intervals
   (oil changes, fluid services) are commonly halved under severe-duty schedules — mention this
   in the summary and set dutyClassification to "severe" with a one-sentence dutyReason. If no
   driving-condition info was given, or it doesn't meet any severe-duty criteria, set
   dutyClassification to "normal".
7. If ANY quote item's verdict is "premature" or "not_on_schedule", draft a short, polite,
   specific message the user could say or send to the shop pushing back on it — cite the exact
   manufacturer-schedule numbers (e.g. "My schedule shows transmission service at 60,000 miles;
   I'm at 32,000, so this is premature by 28,000 miles — can you clarify what's prompting it
   now?"). Put this in disputeDraft. If every quote item is "justified" (or no quote was given),
   leave disputeDraft out entirely.
8. If the user's message includes prior audit history for this vehicle, check whether any
   currently-quoted item was already flagged as "premature" or "not_on_schedule" in a past audit
   at a similar mileage (within ~2,000 miles). If so, explicitly call this out as likely duplicate
   billing in the summary — the same or a different shop may be re-quoting something already
   flagged.
9. Finish by calling present_findings with the full structured result — this IS your final answer,
   do not also write a text response after it. Include a concise plain-English summary sentence.`;
```

with:

```ts
const SYSTEM_PROMPT = `You are a car maintenance advisor agent. Your job is to protect the user
from paying for services they don't yet need, while also flagging services that genuinely ARE
due or overdue.

You have tools to decode a VIN and look up a manufacturer maintenance schedule. Use them. Do not
guess at maintenance intervals from memory if a tool can give you real data.

Given a VIN, the car's current mileage, and (optionally) a list of services a dealership or shop
has proposed, you must:

1. Call vin_decode to confirm make/model/year — unless the user already told you the
   year/make/model directly (no VIN given), in which case skip this step.
2. Call get_maintenance_schedule for that make/model.
3. For EACH service in the manufacturer schedule, determine status based on current mileage:
   "overdue", "due_now" (within ~1,000 miles of the interval), or "not_due" — using the interval
   and its multiples (an item due every 10,000 miles is due at 10k, 20k, 30k...). Always include
   a short milesInfo string with the concrete number, e.g. "2,400 miles overdue" or "due in 3,600 miles".
4. If the user gave you a list of dealer-proposed services, match each one against the manufacturer
   schedule (loosely worded matches are fine, e.g. "trans flush" -> "Transmission fluid service")
   and give a verdict: "justified" (due/overdue per schedule), "premature" (on schedule, not due yet
   — say by how much in the explanation), or "not_on_schedule" (not on the manufacturer schedule at
   all — the most likely padding).
5. If the user attached a photo of their quote, first read every visible line item (service names)
   from the image as accurately as you can and put that list in transcribedItems. Use those
   transcribed items as the dealer-proposed services for step 4 above. If the photo is too blurry
   or unclear to read confidently, say so directly in the summary instead of guessing at line items.
6. Be direct and specific with numbers. This is a tool for someone about to spend real money.
7. If the user described their driving conditions, judge whether that qualifies as "severe duty"
   under common manufacturer definitions — frequent towing/hauling, dusty or off-road conditions,
   extensive idling or very short trips (under ~10 minutes), extreme heat or cold, or heavy
   stop-and-go traffic. If it qualifies, say so explicitly and note that routine intervals
   (oil changes, fluid services) are commonly halved under severe-duty schedules — mention this
   in the summary and set dutyClassification to "severe" with a one-sentence dutyReason. If no
   driving-condition info was given, or it doesn't meet any severe-duty criteria, set
   dutyClassification to "normal".
8. If ANY quote item's verdict is "premature" or "not_on_schedule", draft a short, polite,
   specific message the user could say or send to the shop pushing back on it — cite the exact
   manufacturer-schedule numbers (e.g. "My schedule shows transmission service at 60,000 miles;
   I'm at 32,000, so this is premature by 28,000 miles — can you clarify what's prompting it
   now?"). Put this in disputeDraft. If every quote item is "justified" (or no quote was given),
   leave disputeDraft out entirely.
9. If the user's message includes prior audit history for this vehicle, check whether any
   currently-quoted item was already flagged as "premature" or "not_on_schedule" in a past audit
   at a similar mileage (within ~2,000 miles). If so, explicitly call this out as likely duplicate
   billing in the summary — the same or a different shop may be re-quoting something already
   flagged.
10. Finish by calling present_findings with the full structured result — this IS your final answer,
    do not also write a text response after it. Include a concise plain-English summary sentence.`;
```

Add `transcribedItems` to `PRESENT_FINDINGS_TOOL`'s schema. Replace:

```ts
        summary: { type: "string" },
        dutyClassification: { type: "string", enum: ["normal", "severe"] },
        dutyReason: { type: "string" },
        disputeDraft: { type: "string" },
      },
      required: ["vehicle", "mileage", "scheduleSource", "exactMatch", "items", "quoteVerdicts", "summary"],
```

with:

```ts
        summary: { type: "string" },
        dutyClassification: { type: "string", enum: ["normal", "severe"] },
        dutyReason: { type: "string" },
        disputeDraft: { type: "string" },
        transcribedItems: { type: "array", items: { type: "string" } },
      },
      required: ["vehicle", "mileage", "scheduleSource", "exactMatch", "items", "quoteVerdicts", "summary"],
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Update `runAgent` to accept an optional image and pick the right model**

In `src/lib/agent.ts`, replace:

```ts
export async function* runAgent(userMessage: string): AsyncGenerator<AgentEvent> {
  const client = getClient();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const tools = [...TOOL_SCHEMAS, PRESENT_FINDINGS_TOOL];
  const MAX_TURNS = 8;
  let lastSchedule: ScheduleResult | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response;
    try {
      response = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      });
    } catch (e) {
```

with:

```ts
export async function* runAgent(userMessage: string, quoteImage?: string): AsyncGenerator<AgentEvent> {
  const client = getClient();

  const firstUserMessage: OpenAI.Chat.ChatCompletionMessageParam = quoteImage
    ? {
        role: "user",
        content: [
          { type: "text", text: userMessage },
          { type: "image_url", image_url: { url: quoteImage } },
        ],
      }
    : { role: "user", content: userMessage };

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    firstUserMessage,
  ];

  const tools = [...TOOL_SCHEMAS, PRESENT_FINDINGS_TOOL];
  const MAX_TURNS = 8;
  let lastSchedule: ScheduleResult | null = null;
  const modelToUse = quoteImage ? VISION_MODEL : MODEL;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response;
    try {
      response = await client.chat.completions.create({
        model: modelToUse,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      });
    } catch (e) {
```

- [ ] **Step 6: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Thread `quoteImage` through the API route**

In `src/app/api/agent/route.ts`, replace:

```ts
export const runtime = "nodejs";
export const maxDuration = 60;
```

with:

```ts
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_DATA_URL_LENGTH = 4_500_000;
```

Replace the `buildUserMessage` signature and body:

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

with:

```ts
function buildUserMessage(
  vehicle: VehicleInput,
  mileage: number,
  quoteItems: string[],
  drivingConditions: string,
  historyNote: string,
  hasQuoteImage: boolean
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

  if (hasQuoteImage) {
    msg +=
      "\nI've attached a photo of my dealer/shop quote. Please read the line items directly from " +
      "the photo and use those as the quoted services.";
  } else if (quoteItems.length > 0) {
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

Replace the body-parsing block:

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

with:

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

  if (quoteImage) {
    if (typeof quoteImage !== "string" || !/^data:image\/(png|jpe?g|webp);base64,/.test(quoteImage)) {
      return new Response(JSON.stringify({ error: "Invalid image format." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (quoteImage.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return new Response(JSON.stringify({ error: "Image is too large. Please use a smaller photo." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
```

Replace the `buildUserMessage` call:

```ts
  const userMessage = buildUserMessage(
    vehicleInput,
    mileage,
    quoteItems,
    drivingConditions || "",
    historyNote || ""
  );
```

with:

```ts
  const userMessage = buildUserMessage(
    vehicleInput,
    mileage,
    quoteItems,
    drivingConditions || "",
    historyNote || "",
    Boolean(quoteImage)
  );
```

Replace the `runAgent` call:

```ts
        for await (const event of runAgent(userMessage)) {
```

with:

```ts
        for await (const event of runAgent(userMessage, quoteImage)) {
```

- [ ] **Step 8: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 9: Create the client-side image compression helper**

Create `src/lib/image.ts`:

```ts
// Client-only: resizes/re-encodes a user-selected image before sending it
// to the server, so quote photos don't blow up request size. Never called
// during SSR — only from browser event handlers in "use client" components.

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
const MAX_DATA_URL_LENGTH = 4_000_000; // ~4MB of base64 text

export async function compressImageToDataUrl(file: File): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(rawDataUrl);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image.");
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error("Image is too large even after compression — try a smaller photo.");
  }
  return dataUrl;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the selected image."));
    img.src = src;
  });
}
```

(`window.Image` rather than a bare `Image` avoids any ambiguity if a lucide-react `Image` icon is imported elsewhere in a file that imports this module — this module itself doesn't import any icon, but the explicit `window.Image` is clearer regardless.)

- [ ] **Step 10: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Add photo-mode UI to `AgentConsole.tsx`**

Add the new imports. Replace:

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
import type { AgentEvent, Findings } from "@/lib/types";
import { kmToMiles, milesToKm, convertMilesInfoToKm } from "@/lib/units";
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
} from "lucide-react";
import type { AgentEvent, Findings } from "@/lib/types";
import { kmToMiles, milesToKm, convertMilesInfoToKm } from "@/lib/units";
import { compressImageToDataUrl } from "@/lib/image";
```

Add state for the quote-input mode and the compressed image. Replace:

```ts
  const [quote, setQuote] = useState("");
  const [drivingConditions, setDrivingConditions] = useState("");
```

with:

```ts
  const [quote, setQuote] = useState("");
  const [quoteMode, setQuoteMode] = useState<"text" | "photo">("text");
  const [quoteImage, setQuoteImage] = useState<string | null>(null);
  const [quoteImageError, setQuoteImageError] = useState<string | null>(null);
  const [compressingImage, setCompressingImage] = useState(false);
  const [drivingConditions, setDrivingConditions] = useState("");
```

Add the file-select handler right after the `canSubmit` derivation. Replace:

```ts
  const canSubmit = mode === "vin" ? vinValid : manualValid;

  async function runAgent(e: React.FormEvent) {
```

with:

```ts
  const canSubmit = mode === "vin" ? vinValid : manualValid;

  async function handleQuoteImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setQuoteImageError(null);
    setCompressingImage(true);
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setQuoteImage(dataUrl);
    } catch (err) {
      setQuoteImageError((err as Error).message);
      setQuoteImage(null);
    } finally {
      setCompressingImage(false);
    }
  }

  async function runAgent(e: React.FormEvent) {
```

Include the image in the request body. Replace:

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

with:

```ts
    const mileageMiles = unit === "km" ? kmToMiles(Number(mileage)) : Number(mileage);
    const identifier = vehicleIdentifier(mode, vin, manualYear, manualMake, manualModel);
    const historyNote = summarizeHistoryForPrompt(getVehicleHistory(identifier));
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

Add the mode toggle and photo UI next to the existing quote textarea. Replace:

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
```

with:

```tsx
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-2 text-sm font-medium text-white/70">
                <FileText className="size-4 text-accent" />
                Dealer / shop quote <span className="text-white/30 font-normal">(optional)</span>
              </label>
              <div className="flex rounded-lg border border-white/10 overflow-hidden text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setQuoteMode("text");
                    setQuoteImage(null);
                    setQuoteImageError(null);
                  }}
                  className={`px-2 py-1 transition ${
                    quoteMode === "text" ? "bg-accent/20 text-accent" : "text-white/40"
                  }`}
                >
                  Type it in
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuoteMode("photo");
                    setQuote("");
                  }}
                  className={`px-2 py-1 transition ${
                    quoteMode === "photo" ? "bg-accent/20 text-accent" : "text-white/40"
                  }`}
                >
                  Upload a photo
                </button>
              </div>
            </div>
            {quoteMode === "text" ? (
              <textarea
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                rows={2}
                placeholder="Transmission flush, Timing belt replacement, Cabin air filter, Wiper blades"
                className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition resize-none placeholder:text-white/20"
              />
            ) : (
              <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
                <label className="inline-flex items-center gap-2 text-xs text-white/60 cursor-pointer">
                  <ImageIcon className="size-4 text-accent" />
                  Choose a photo of your quote
                  <input type="file" accept="image/*" onChange={handleQuoteImageChange} className="hidden" />
                </label>
                {compressingImage && <p className="text-xs text-white/40 mt-2">Processing image...</p>}
                {quoteImageError && <p className="text-xs text-danger mt-2">{quoteImageError}</p>}
                {quoteImage && !compressingImage && (
                  <div className="mt-3 flex items-center gap-3">
                    <img
                      src={quoteImage}
                      alt="Quote preview"
                      className="h-16 w-16 object-cover rounded-lg border border-white/10"
                    />
                    <button
                      type="button"
                      onClick={() => setQuoteImage(null)}
                      className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition"
                    >
                      <X className="size-3.5" />
                      Remove
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
```

- [ ] **Step 12: Show what was transcribed from the photo in `ResultsView`**

Replace:

```ts
function ResultsView({ findings, unit }: { findings: Findings; unit: "mi" | "km" }) {
  const { vehicle, mileage, items, quoteVerdicts, summary, exactMatch, scheduleSource, disputeDraft } = findings;
```

with:

```ts
function ResultsView({ findings, unit }: { findings: Findings; unit: "mi" | "km" }) {
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

Then, right before the "Quote audit" card, add a small transcription-confirmation note. Replace:

```tsx
      {/* Quote audit, if a quote was given */}
      {quoteVerdicts.length > 0 && (
```

with:

```tsx
      {/* What we read from the photo, if one was uploaded */}
      {transcribedItems && transcribedItems.length > 0 && (
        <div className="glass rounded-2xl p-6">
          <div className="flex items-center gap-2 text-sm font-semibold mb-3">
            <ImageIcon className="size-4 text-accent" />
            Read from your photo
          </div>
          <ul className="text-xs text-white/50 space-y-1 list-disc list-inside">
            {transcribedItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Quote audit, if a quote was given */}
      {quoteVerdicts.length > 0 && (
```

- [ ] **Step 13: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 14: Manual verification**

Run: `npm run dev`. In the browser:
  1. Switch the quote field to "Upload a photo" and choose an image file containing readable text (a photo of any invoice/receipt/document with line items works for testing — doesn't need to be an actual car quote). Confirm a preview thumbnail appears and "Remove" clears it.
  2. Fill in a VIN or manual entry + mileage, leave the typed quote empty (photo mode), and submit. Confirm the request succeeds, a "Read from your photo" card appears listing plausible transcribed text, and the dealer-quote-audit card reflects those items.
  3. Switch back to "Type it in" mode and confirm the normal typed-quote flow still works exactly as before (regression check).
  4. Try submitting a very large image (several MB, e.g. a high-res photo straight from a phone camera) and confirm it still works (client-side compression should keep the request small) or fails with a clear, specific error message — not a silent hang or a generic 500.
  Kill the dev server when done.

- [ ] **Step 15: Commit**

```bash
git add src/lib/types.ts src/lib/agent.ts src/app/api/agent/route.ts src/lib/image.ts src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Add photo/invoice intake via vision model

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

Manually confirm: VIN mode, manual entry mode, km/mi toggle, severe-duty badge, dispute-draft card, vehicle memory/past-audits, and follow-up chat all still work exactly as before when using the typed-quote path (no photo). Photo intake is purely additive and gated behind the "Upload a photo" toggle.
