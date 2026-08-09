const TRUCK_MODELS = [
  "f-150",
  "f-250",
  "f-350",
  "silverado",
  "sierra",
  "ram 1500",
  "ram 2500",
  "tacoma",
  "tundra",
  "ridgeline",
  "colorado",
  "ranger",
  "frontier",
  "titan",
  "gladiator",
];

const SUV_MODELS = [
  "cr-v",
  "rav4",
  "highlander",
  "explorer",
  "tahoe",
  "suburban",
  "4runner",
  "pilot",
  "pathfinder",
  "wrangler",
  "cherokee",
  "grand cherokee",
  "outback",
  "forester",
  "cx-5",
  "cx-9",
  "santa fe",
  "tucson",
  "telluride",
  "palisade",
  "traverse",
  "equinox",
  "expedition",
  "escalade",
  "x3",
  "x5",
  "q5",
  "q7",
  "glc",
  "gle",
];

export type BodyType = "sedan" | "suv" | "truck";

export function classifyBodyType(model: string): BodyType {
  const m = model.toLowerCase();
  if (TRUCK_MODELS.some((name) => m.includes(name))) return "truck";
  if (SUV_MODELS.some((name) => m.includes(name))) return "suv";
  return "sedan";
}

export function VehicleIcon({ model, className }: { model: string; className?: string }) {
  const bodyType = classifyBodyType(model);

  return (
    <div
      className={`rounded-xl bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center shrink-0 ${className ?? ""}`}
    >
      <svg viewBox="0 0 80 80" className="size-2/3" fill="none">
        {bodyType === "sedan" && (
          <>
            <rect x="18" y="45" width="44" height="15" rx="5" fill="black" fillOpacity="0.85" />
            <path d="M24 45 L28 32 H52 L56 45 Z" fill="black" fillOpacity="0.85" />
            <circle cx="27" cy="60" r="6" fill="black" fillOpacity="0.85" />
            <circle cx="53" cy="60" r="6" fill="black" fillOpacity="0.85" />
          </>
        )}
        {bodyType === "suv" && (
          <>
            <rect x="16" y="36" width="48" height="24" rx="5" fill="black" fillOpacity="0.85" />
            <rect x="21" y="24" width="38" height="14" rx="4" fill="black" fillOpacity="0.85" />
            <circle cx="26" cy="60" r="6" fill="black" fillOpacity="0.85" />
            <circle cx="54" cy="60" r="6" fill="black" fillOpacity="0.85" />
          </>
        )}
        {bodyType === "truck" && (
          <>
            <rect x="12" y="46" width="56" height="14" rx="3" fill="black" fillOpacity="0.85" />
            <rect x="15" y="28" width="21" height="18" rx="3" fill="black" fillOpacity="0.85" />
            <circle cx="24" cy="60" r="6" fill="black" fillOpacity="0.85" />
            <circle cx="54" cy="60" r="6" fill="black" fillOpacity="0.85" />
          </>
        )}
      </svg>
    </div>
  );
}
