import { NextRequest } from "next/server";

/**
 * Rejects cross-site requests to our API routes — without this, any other
 * website's JavaScript could call these endpoints directly from a visitor's
 * browser and drain our shared, rate-limited Groq quota using our own site's
 * traffic. Compares the Origin (falling back to Referer) against the
 * request's own Host header, so it works across production, Vercel preview
 * deployments, and localhost without hardcoding a domain.
 */
export function isTrustedOrigin(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (!host) return false;

  const candidate = req.headers.get("origin") || req.headers.get("referer");
  if (!candidate) return false;

  try {
    return new URL(candidate).host === host;
  } catch {
    return false;
  }
}
