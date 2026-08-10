import type { Findings } from "./types";

// Findings compress to roughly 500 bytes gzipped+base64 (measured), which fits
// comfortably in a URL — so sharing needs no database and no server. Uses the
// browser's native CompressionStream, so no dependency either.
const MAX_ENCODED_LENGTH = 8000;

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
  try {
    const base64 = param.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const json = await new Response(stream).text();
    const parsed = JSON.parse(json);
    // Shape check — a corrupt or hand-edited param must not crash the page.
    if (!parsed?.vehicle?.make || !Array.isArray(parsed.items)) return null;
    return parsed as Findings;
  } catch {
    return null;
  }
}
