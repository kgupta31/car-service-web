import type { Findings } from "./types";

// Findings compress to roughly 500 bytes gzipped+base64 (measured), which fits
// comfortably in a URL — so sharing needs no database and no server. Uses the
// browser's native CompressionStream, so no dependency either.
const MAX_ENCODED_LENGTH = 8000;
// A ?r= value is attacker-controlled (anyone can hand-craft one). Bound both
// the encoded length and the decompressed size before parsing, so a malicious
// or corrupt link can't hang/crash the tab via a decompression bomb.
const MAX_DECOMPRESSED_BYTES = 200_000;

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export async function encodeFindings(findings: Findings): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const json = JSON.stringify(findings);
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
    const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return encoded.length > MAX_ENCODED_LENGTH ? null : encoded;
  } catch {
    return null;
  }
}

export async function decodeFindings(param: string): Promise<Findings | null> {
  if (typeof window === "undefined") return null;
  if (!param || param.length > MAX_ENCODED_LENGTH) return null;
  try {
    const base64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    if (buf.byteLength > MAX_DECOMPRESSED_BYTES) return null;
    const parsed = JSON.parse(new TextDecoder().decode(buf));
    // Shape check — a corrupt or hand-edited param must not crash the page,
    // and every field the UI reads/renders as a link must be validated since
    // this JSON is fully attacker-controlled (never touched by the LLM).
    if (
      !parsed?.vehicle?.make ||
      !Array.isArray(parsed.items) ||
      !Array.isArray(parsed.quoteVerdicts) ||
      typeof parsed.summary !== "string" ||
      typeof parsed.mileage !== "number"
    ) {
      return null;
    }
    if (parsed.scheduleSources) {
      parsed.scheduleSources = Array.isArray(parsed.scheduleSources)
        ? parsed.scheduleSources.filter(isHttpUrl)
        : undefined;
    }
    if (parsed.priceAssessment?.sources) {
      parsed.priceAssessment.sources = Array.isArray(parsed.priceAssessment.sources)
        ? parsed.priceAssessment.sources.filter(isHttpUrl)
        : undefined;
    }
    return parsed as Findings;
  } catch {
    return null;
  }
}
