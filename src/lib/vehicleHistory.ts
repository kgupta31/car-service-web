import type { Findings, QuoteVerdict } from "./types";
import type { ScheduleResult } from "./tools";

export type AuditRecord = {
  timestamp: number;
  mileage: number;
  quoteVerdicts: QuoteVerdict[];
  summary: string;
};

export type VehicleHistory = {
  vehicle: { year: string; make: string; model: string };
  audits: AuditRecord[];
};

const STORAGE_PREFIX = "serviceaudit:history:";
const SCHEDULE_PREFIX = "serviceaudit:schedule:";
const MAX_AUDITS_PER_VEHICLE = 10;
const SCHEDULE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// For the SCHEDULE CACHE only. A manufacturer's published maintenance
// schedule is identical across every unit of a given year/make/model, so
// year+make+model is a perfectly valid cache key here even without a VIN —
// unlike per-vehicle audit history (see historyIdentifier below), there's
// no correctness risk from two different owners' cars sharing this key.
export function vehicleIdentifier(
  mode: "vin" | "manual",
  vin: string,
  year: string,
  make: string,
  model: string
): string | null {
  if (mode === "vin") {
    const trimmed = vin.trim().toUpperCase();
    return trimmed.length === 17 ? trimmed : null;
  }
  const y = year.trim();
  const mk = make.trim();
  const md = model.trim();
  if (!y || !mk || !md) return null;
  return `${y}|${mk}|${md}`.toUpperCase();
}

// For audit HISTORY and the "possible duplicate billing" cross-check —
// unlike the schedule cache, these are about one specific car's past
// quotes and mileage, and year+make+model is NOT a safe stand-in for that:
// many people own the same year/make/model, so matching on it would show a
// different physical vehicle's history (and could produce a false
// duplicate-billing claim) as if it belonged to this one. Only a real VIN
// uniquely identifies a vehicle, so history is VIN-only — manual mode
// simply has no history feature.
export function historyIdentifier(mode: "vin" | "manual", vin: string): string | null {
  if (mode !== "vin") return null;
  const trimmed = vin.trim().toUpperCase();
  return trimmed.length === 17 ? trimmed : null;
}

function storageKey(identifier: string): string {
  return `${STORAGE_PREFIX}${identifier}`;
}

export function getVehicleHistory(identifier: string | null): VehicleHistory | null {
  if (!identifier || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(identifier));
    if (!raw) return null;
    return JSON.parse(raw) as VehicleHistory;
  } catch {
    return null;
  }
}

export function saveAuditToHistory(identifier: string | null, findings: Findings): void {
  if (!identifier || typeof window === "undefined") return;
  try {
    const existing = getVehicleHistory(identifier);
    const record: AuditRecord = {
      timestamp: Date.now(),
      mileage: findings.mileage,
      quoteVerdicts: findings.quoteVerdicts,
      summary: findings.summary,
    };
    const audits = [...(existing?.audits ?? []), record].slice(-MAX_AUDITS_PER_VEHICLE);
    const history: VehicleHistory = {
      vehicle: {
        year: findings.vehicle.year,
        make: findings.vehicle.make,
        model: findings.vehicle.model,
      },
      audits,
    };
    window.localStorage.setItem(storageKey(identifier), JSON.stringify(history));
  } catch {
    // localStorage unavailable or full — this is a nicety, not core functionality.
  }
}

export function summarizeHistoryForPrompt(history: VehicleHistory | null): string {
  if (!history || history.audits.length === 0) return "";
  const lines = history.audits.map((a) => {
    const date = new Date(a.timestamp).toLocaleDateString();
    const items =
      a.quoteVerdicts.length > 0
        ? a.quoteVerdicts.map((qv) => `${qv.item} (${qv.verdict})`).join(", ")
        : "no quote given";
    return `- ${date} at ${a.mileage.toLocaleString()} miles: ${items}`;
  });
  return lines.join("\n");
}

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
