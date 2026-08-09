import type { Findings, QuoteVerdict } from "./types";

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
const MAX_AUDITS_PER_VEHICLE = 10;

// A VIN identifies a vehicle uniquely; without one, year+make+model is the
// best available proxy (imprecise across owners of the same model, but
// this is a client-only convenience feature, not a source of truth).
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
