/**
 * Tools the agent can call. Ported from the Python prototype (tools.py) —
 * same two tools, same mocked-data caveat: get_maintenance_schedule is a
 * small hardcoded table + generic fallback, meant to be swapped for a real
 * CarMD (or similar) API call later without touching the agent loop.
 */

import type { ItemStatus, RecallItem, DiyInfo } from "./types";

export type MaintenanceItem = {
  service: string;
  interval_miles: number;
  category: "routine" | "major";
};

export type VinDecodeResult = {
  vin: string;
  year?: string;
  make?: string;
  model?: string;
  trim?: string;
  engine?: string;
  drive_type?: string;
  error?: string;
};

export type ScheduleResult = {
  make: string;
  model: string;
  exact_match: boolean;
  source: string;
  schedule: MaintenanceItem[];
  sources?: string[];
  error?: string;
};

const NHTSA_URL = (vin: string) =>
  `https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${encodeURIComponent(vin)}?format=json`;

export async function vinDecode(vin: string): Promise<VinDecodeResult> {
  const cleanVin = vin.trim().toUpperCase();

  let data: { Results?: { Variable: string; Value: string | null }[] };
  try {
    const res = await fetch(NHTSA_URL(cleanVin), { cache: "no-store" });
    if (!res.ok) {
      return { vin: cleanVin, error: `VIN decode request failed: HTTP ${res.status}` };
    }
    data = await res.json();
  } catch (e) {
    return { vin: cleanVin, error: `VIN decode request failed: ${(e as Error).message}` };
  }

  const results: Record<string, string> = {};
  for (const r of data.Results ?? []) {
    if (r.Value) results[r.Variable] = r.Value;
  }

  const decoded: VinDecodeResult = {
    vin: cleanVin,
    year: results["Model Year"],
    make: results["Make"],
    model: results["Model"],
    trim: results["Trim"],
    engine: results["Engine Configuration"] || results["Engine Model"],
    drive_type: results["Drive Type"],
  };

  if (!decoded.make || !decoded.model) {
    return { vin: cleanVin, error: "VIN did not decode to a recognizable make/model. Double-check it." };
  }

  return decoded;
}

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
    const rawResults = Array.isArray(data?.results) ? data.results : [];
    // Guard against a structurally-absent entry (not just wrong-typed), which
    // would otherwise throw inside .map() and discard the whole result set.
    const results = rawResults.filter((r: unknown) => r && typeof r === "object");

    const recalls: RecallItem[] = results.slice(0, MAX_RECALLS).map((r: Record<string, unknown>) => ({
      component: typeof r.Component === "string" ? r.Component : "Unspecified",
      summary: typeof r.Summary === "string" ? r.Summary : "",
      remedy: typeof r.Remedy === "string" ? r.Remedy : "",
      campaignNumber: typeof r.NHTSACampaignNumber === "string" ? r.NHTSACampaignNumber : "",
    }));

    // count and recalls.length can diverge above MAX_RECALLS — the UI shows
    // "N open recalls" using count while only listing MAX_RECALLS detail
    // cards, so it must say so rather than silently implying that's the full
    // list. See the "showing top N" copy in AgentConsole.tsx.
    return { count: results.length, recalls };
  } catch (e) {
    return { count: 0, recalls: [], error: (e as Error).message };
  }
}

// MOCKED — small hand-entered table for a handful of common models, plus a
// generic industry-average fallback for everything else. Swap for a real
// CarMD API call (or licensed labor-guide data) when ready.
const MOCK_SCHEDULES: Record<string, MaintenanceItem[]> = {
  "TOYOTA|CAMRY": [
    { service: "Engine oil & filter change", interval_miles: 10000, category: "routine" },
    { service: "Tire rotation", interval_miles: 5000, category: "routine" },
    { service: "Cabin air filter replacement", interval_miles: 15000, category: "routine" },
    { service: "Engine air filter replacement", interval_miles: 30000, category: "routine" },
    { service: "Brake fluid replacement", interval_miles: 30000, category: "routine" },
    { service: "Spark plug replacement", interval_miles: 120000, category: "major" },
    { service: "Transmission fluid service", interval_miles: 60000, category: "major" },
    { service: "Coolant replacement", interval_miles: 100000, category: "major" },
  ],
  "HONDA|CIVIC": [
    { service: "Engine oil & filter change", interval_miles: 7500, category: "routine" },
    { service: "Tire rotation", interval_miles: 7500, category: "routine" },
    { service: "Cabin air filter replacement", interval_miles: 15000, category: "routine" },
    { service: "Engine air filter replacement", interval_miles: 30000, category: "routine" },
    { service: "Brake fluid replacement", interval_miles: 36000, category: "routine" },
    { service: "Spark plug replacement", interval_miles: 100000, category: "major" },
    { service: "Transmission fluid service (CVT)", interval_miles: 60000, category: "major" },
    { service: "Timing chain inspection", interval_miles: 100000, category: "major" },
  ],
  "FORD|F-150": [
    { service: "Engine oil & filter change", interval_miles: 7500, category: "routine" },
    { service: "Tire rotation", interval_miles: 5000, category: "routine" },
    { service: "Cabin/engine air filter replacement", interval_miles: 20000, category: "routine" },
    { service: "Brake fluid replacement", interval_miles: 30000, category: "routine" },
    { service: "Spark plug replacement", interval_miles: 100000, category: "major" },
    { service: "Transmission fluid service", interval_miles: 150000, category: "major" },
    { service: "Coolant replacement", interval_miles: 100000, category: "major" },
    { service: "4WD front/rear differential fluid", interval_miles: 60000, category: "major" },
  ],
};

const GENERIC_SCHEDULE: MaintenanceItem[] = [
  { service: "Engine oil & filter change", interval_miles: 7500, category: "routine" },
  { service: "Tire rotation", interval_miles: 6000, category: "routine" },
  { service: "Cabin air filter replacement", interval_miles: 15000, category: "routine" },
  { service: "Engine air filter replacement", interval_miles: 25000, category: "routine" },
  { service: "Brake fluid replacement", interval_miles: 30000, category: "routine" },
  { service: "Spark plug replacement", interval_miles: 60000, category: "major" },
  { service: "Transmission fluid service", interval_miles: 60000, category: "major" },
  { service: "Coolant replacement", interval_miles: 60000, category: "major" },
];

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
    // Always false here, even for the hand-entered table: exact_match:true is
    // reserved for schedules we actually found and can cite (see
    // searchMaintenanceSchedule). Otherwise a transient search failure for a
    // hardcoded model would render the same "real, cited" badge as a genuine
    // result, and get permanently cached as if it had been researched.
    exact_match: false,
    source: exact ? "built-in table (not researched)" : "generic estimate (not model-specific)",
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
      .map((it: { service: string; interval_miles: number; category: string }) => ({
        service: it.service,
        interval_miles: it.interval_miles,
        category: it.category === "major" ? ("major" as const) : ("routine" as const),
      }));

    if (schedule.length === 0) return null;

    // Only accept http(s) URLs — these strings come from a web-search-augmented
    // model and get rendered as clickable anchor hrefs, so a non-http scheme
    // (e.g. javascript:) must never reach the client.
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.filter(
          (s: unknown): s is string => typeof s === "string" && /^https?:\/\//i.test(s)
        )
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

// Deterministic status calc for one schedule item at a given mileage. Used
// as a fallback when the model's own findings.items is missing an entry —
// see fillMissingScheduleItems in agent.ts.
export function computeScheduleItemStatus(
  intervalMiles: number,
  mileage: number
): { status: ItemStatus; milesInfo: string } {
  // Defensive: all current mock intervals are positive constants, but this
  // table is a placeholder for a future real API, so guard against bad data.
  if (!Number.isFinite(intervalMiles) || intervalMiles <= 0) {
    return { status: "not_due", milesInfo: "interval unknown" };
  }
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

// ---------------------------------------------------------------------------
// OpenAI-compatible tool schemas (Groq's API is OpenAI-compatible)
// ---------------------------------------------------------------------------

export const TOOL_SCHEMAS = [
  {
    type: "function" as const,
    function: {
      name: "vin_decode",
      description:
        "Decode a 17-character VIN into year, make, model, trim, and engine using NHTSA's " +
        "free vPIC database. Call this first whenever a VIN is provided.",
      parameters: {
        type: "object",
        properties: {
          vin: { type: "string", description: "The 17-character Vehicle Identification Number." },
        },
        required: ["vin"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_maintenance_schedule",
      description:
        "Look up the manufacturer-recommended maintenance schedule (service name and the mileage " +
        "interval it recurs at) for a given make and model. Call this after decoding the VIN.",
      parameters: {
        type: "object",
        properties: {
          make: { type: "string", description: "Vehicle make, e.g. 'Toyota'." },
          model: { type: "string", description: "Vehicle model, e.g. 'Camry'." },
          year: { type: "string", description: "Model year, e.g. '2022'. Include it when known." },
        },
        required: ["make", "model"],
      },
    },
  },
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
];

export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  try {
    if (name === "vin_decode") {
      return await vinDecode(input.vin as string);
    }
    if (name === "get_maintenance_schedule") {
      return await getMaintenanceSchedule(
        input.make as string,
        input.model as string,
        input.year as string | undefined
      );
    }
    if (name === "nhtsa_recalls") {
      return await getRecalls(input.make as string, input.model as string, input.year as string);
    }
    return { error: `Unknown tool: ${name}` };
  } catch (e) {
    return { error: `Tool '${name}' raised an exception: ${(e as Error).message}` };
  }
}

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
