/**
 * Tools the agent can call. Ported from the Python prototype (tools.py) —
 * same two tools, same mocked-data caveat: get_maintenance_schedule is a
 * small hardcoded table + generic fallback, meant to be swapped for a real
 * CarMD (or similar) API call later without touching the agent loop.
 */

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
        },
        required: ["make", "model"],
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
      return getMaintenanceSchedule(input.make as string, input.model as string);
    }
    return { error: `Unknown tool: ${name}` };
  } catch (e) {
    return { error: `Tool '${name}' raised an exception: ${(e as Error).message}` };
  }
}
