import { NextRequest } from "next/server";
import { runFollowup, toUserFacingError } from "@/lib/agent";
import { checkRateLimit } from "@/lib/rateLimit";
import { isTrustedOrigin } from "@/lib/originCheck";
import type { Findings, ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_TURNS = 6;
// No auth on this endpoint — findings/history/question are all fully
// attacker-controlled, not just "whatever the browser client happens to
// send." Bound every one of them before they reach a prompt.
const MAX_QUESTION_LENGTH = 1000;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_FINDINGS_JSON_LENGTH = 20_000;

export async function POST(req: NextRequest) {
  if (!isTrustedOrigin(req)) {
    return new Response(JSON.stringify({ error: "Forbidden." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { limited, retryAfterSeconds } = checkRateLimit(ip);
  if (limited) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please wait a bit before trying again." }),
      {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSeconds) },
      }
    );
  }

  const body = await req.json();
  const { findings, history, question } = body as {
    findings?: Findings;
    history?: unknown;
    question?: string;
  };

  if (!findings || typeof findings !== "object" || !findings.vehicle) {
    return new Response(JSON.stringify({ error: "Missing audit context." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (JSON.stringify(findings).length > MAX_FINDINGS_JSON_LENGTH) {
    return new Response(JSON.stringify({ error: "Audit context is too large." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!question || typeof question !== "string" || question.trim().length === 0) {
    return new Response(JSON.stringify({ error: "Provide a question." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return new Response(JSON.stringify({ error: "Question is too long." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // A raw client-supplied "role" must never reach the LLM call verbatim — an
  // attacker could otherwise forge a role: "system" message and inject
  // instructions the model weighs far more heavily than ordinary chat
  // content. Only "user"/"assistant" survive; everything else (malformed
  // entries, forged roles, non-string content) is dropped, not coerced.
  const safeHistory: ChatMessage[] = (Array.isArray(history) ? history : [])
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }))
    .slice(-MAX_TURNS * 2);

  const turnsUsed = safeHistory.filter((m) => m.role === "user").length;
  if (turnsUsed >= MAX_TURNS) {
    return new Response(JSON.stringify({ error: "You've reached the chat limit for this audit." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const answer = await runFollowup(findings, safeHistory, question.trim());
    return new Response(JSON.stringify({ answer }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: toUserFacingError(e, "followup") }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
