import { NextRequest } from "next/server";
import { runFollowup } from "@/lib/agent";
import { checkRateLimit } from "@/lib/rateLimit";
import type { Findings, ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_TURNS = 6;

export async function POST(req: NextRequest) {
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
    history?: ChatMessage[];
    question?: string;
  };

  if (!findings || typeof findings !== "object" || !findings.vehicle) {
    return new Response(JSON.stringify({ error: "Missing audit context." }), {
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

  const safeHistory = Array.isArray(history) ? history.slice(-MAX_TURNS * 2) : [];
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
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
