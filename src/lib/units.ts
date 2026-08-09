const MILES_PER_KM = 0.621371;

export function kmToMiles(km: number): number {
  return Math.round(km * MILES_PER_KM);
}

export function milesToKm(miles: number): number {
  return Math.round(miles / MILES_PER_KM);
}

// Converts every "<number> mile(s)/mi" occurrence in a milesInfo string
// (e.g. "due in 3,600 miles", "2,400 miles overdue", "due now (passed at
// 30,000 mi)") to km for display. The number isn't always leading, so this
// scans the whole string rather than anchoring to the start. Any segment
// that doesn't parse as a number is left unchanged — display-only
// conversion, never worth hard-failing on.
export function convertMilesInfoToKm(milesInfo: string): string {
  return milesInfo.replace(/([\d,]+)\s*(miles?|mi)\b/gi, (match, num: string) => {
    const miles = Number(num.replace(/,/g, ""));
    if (Number.isNaN(miles)) return match;
    return `${milesToKm(miles).toLocaleString()} km`;
  });
}
