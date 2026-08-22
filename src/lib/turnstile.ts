/**
 * Cloudflare Turnstile verification.
 *
 * Silently disabled when TURNSTILE_SECRET_KEY isn't set (e.g. local dev, or
 * before it's been configured in prod) — the site keeps working, it just
 * skips the challenge. Once the key is set, every request must carry a
 * valid token or gets rejected.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstile(token: unknown, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (typeof token !== "string" || token.length === 0) return false;

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Cloudflare's verify endpoint being unreachable shouldn't take the
    // whole audit flow down with it — fail open on transport errors, fail
    // closed on an actual "success: false" from Cloudflare.
    return true;
  }
}
