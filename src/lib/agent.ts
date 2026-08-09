/**
 * The agent loop, server-side (runs inside the Next.js API route).
 *
 * This mirrors the Python prototype's agent loop exactly: the model decides
 * which tools to call and in what order, we execute whatever it asks for
 * and feed the result back, until it's ready to give a final answer.
 *
 * One addition vs. the CLI prototype: instead of ending in free text, the
 * model's final step is a call to `present_findings` — a "tool" it calls
 * with a structured JSON shape (per-service verdicts, a summary, etc.)
 * instead of prose. That's what lets the web UI render real cards and
 * status badges instead of parsing markdown. The model is still doing all
 * the reasoning; this only changes the shape of its final answer.
 */

import OpenAI from "openai";
import { TOOL_SCHEMAS, runTool, computeScheduleItemStatus } from "./tools";
import type { ScheduleResult } from "./tools";
import type { Findings, FindingsItem, AgentEvent, ChatMessage } from "./types";

export type { Findings, AgentEvent } from "./types";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// A current Groq-hosted model that supports tool calling. Check
// https://console.groq.com/docs/tool-use if this gets deprecated.
const MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are a car maintenance advisor agent. Your job is to protect the user
from paying for services they don't yet need, while also flagging services that genuinely ARE
due or overdue.

You have tools to decode a VIN and look up a manufacturer maintenance schedule. Use them. Do not
guess at maintenance intervals from memory if a tool can give you real data.

Given a VIN, the car's current mileage, and (optionally) a list of services a dealership or shop
has proposed, you must:

1. Call vin_decode to confirm make/model/year — unless the user already told you the
   year/make/model directly (no VIN given), in which case skip this step.
2. Call get_maintenance_schedule for that make/model.
3. For EACH service in the manufacturer schedule, determine status based on current mileage:
   "overdue", "due_now" (within ~1,000 miles of the interval), or "not_due" — using the interval
   and its multiples (an item due every 10,000 miles is due at 10k, 20k, 30k...). Always include
   a short milesInfo string with the concrete number, e.g. "2,400 miles overdue" or "due in 3,600 miles".
4. If the user gave you a list of dealer-proposed services, match each one against the manufacturer
   schedule (loosely worded matches are fine, e.g. "trans flush" -> "Transmission fluid service")
   and give a verdict: "justified" (due/overdue per schedule), "premature" (on schedule, not due yet
   — say by how much in the explanation), or "not_on_schedule" (not on the manufacturer schedule at
   all — the most likely padding).
5. Be direct and specific with numbers. This is a tool for someone about to spend real money.
6. If the user described their driving conditions, judge whether that qualifies as "severe duty"
   under common manufacturer definitions — frequent towing/hauling, dusty or off-road conditions,
   extensive idling or very short trips (under ~10 minutes), extreme heat or cold, or heavy
   stop-and-go traffic. If it qualifies, say so explicitly and note that routine intervals
   (oil changes, fluid services) are commonly halved under severe-duty schedules — mention this
   in the summary and set dutyClassification to "severe" with a one-sentence dutyReason. If no
   driving-condition info was given, or it doesn't meet any severe-duty criteria, set
   dutyClassification to "normal".
7. If ANY quote item's verdict is "premature" or "not_on_schedule", draft a short, polite,
   specific message the user could say or send to the shop pushing back on it — cite the exact
   manufacturer-schedule numbers (e.g. "My schedule shows transmission service at 60,000 miles;
   I'm at 32,000, so this is premature by 28,000 miles — can you clarify what's prompting it
   now?"). Put this in disputeDraft. If every quote item is "justified" (or no quote was given),
   leave disputeDraft out entirely.
8. If the user's message includes prior audit history for this vehicle, check whether any
   currently-quoted item was already flagged as "premature" or "not_on_schedule" in a past audit
   at a similar mileage (within ~2,000 miles). If so, explicitly call this out as likely duplicate
   billing in the summary — the same or a different shop may be re-quoting something already
   flagged.
9. Finish by calling present_findings with the full structured result — this IS your final answer,
   do not also write a text response after it. Include a concise plain-English summary sentence.`;

const PRESENT_FINDINGS_TOOL = {
  type: "function" as const,
  function: {
    name: "present_findings",
    description:
      "Call this exactly once, as your final step, with the complete structured result. " +
      "This is how you deliver your answer to the user — do not also write prose after calling it.",
    parameters: {
      type: "object",
      properties: {
        vehicle: {
          type: "object",
          properties: {
            year: { type: "string" },
            make: { type: "string" },
            model: { type: "string" },
            trim: { type: "string" },
          },
          required: ["year", "make", "model"],
        },
        mileage: { type: "number" },
        scheduleSource: { type: "string" },
        exactMatch: { type: "boolean" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              service: { type: "string" },
              category: { type: "string", enum: ["routine", "major"] },
              status: { type: "string", enum: ["overdue", "due_now", "not_due"] },
              milesInfo: { type: "string" },
            },
            required: ["service", "category", "status", "milesInfo"],
          },
        },
        quoteVerdicts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: { type: "string" },
              verdict: { type: "string", enum: ["justified", "premature", "not_on_schedule"] },
              explanation: { type: "string" },
            },
            required: ["item", "verdict", "explanation"],
          },
        },
        summary: { type: "string" },
        dutyClassification: { type: "string", enum: ["normal", "severe"] },
        dutyReason: { type: "string" },
        disputeDraft: { type: "string" },
      },
      required: ["vehicle", "mileage", "scheduleSource", "exactMatch", "items", "quoteVerdicts", "summary"],
    },
  },
};

function getClient(): OpenAI {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set on the server. Add it in your Vercel project's Environment Variables."
    );
  }
  return new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
}

function normalizeServiceName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Safety net: the system prompt instructs the model to return a status for
// every item in the manufacturer schedule, but nothing enforces that. Fill
// in anything it dropped so the UI always shows the complete schedule.
function fillMissingScheduleItems(
  findings: Findings,
  schedule: ScheduleResult | null,
  mileage: number
): Findings {
  if (!schedule || schedule.schedule.length === 0) return findings;
  if (!Number.isFinite(mileage)) return findings;

  const existing = findings.items.map((it) => normalizeServiceName(it.service));
  const consumed = new Set<number>();

  const missing = schedule.schedule.filter((si) => {
    const n = normalizeServiceName(si.service);
    const idx = existing.findIndex(
      (en, i) => !consumed.has(i) && (en.includes(n) || n.includes(en))
    );
    if (idx === -1) return true;
    consumed.add(idx);
    return false;
  });

  if (missing.length === 0) return findings;

  const added: FindingsItem[] = missing.map((si) => {
    const { status, milesInfo } = computeScheduleItemStatus(si.interval_miles, mileage);
    return { service: si.service, category: si.category, status, milesInfo };
  });

  return { ...findings, items: [...findings.items, ...added] };
}

export async function* runAgent(userMessage: string): AsyncGenerator<AgentEvent> {
  const client = getClient();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const tools = [...TOOL_SCHEMAS, PRESENT_FINDINGS_TOOL];
  const MAX_TURNS = 8;
  let lastSchedule: ScheduleResult | null = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let response;
    try {
      response = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.2,
      });
    } catch (e) {
      yield { type: "error", message: `Model request failed: ${(e as Error).message}` };
      return;
    }

    const message = response.choices[0].message;
    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      yield { type: "error", message: message.content || "Agent stopped without a final answer." };
      return;
    }

    messages.push({
      role: "assistant",
      content: message.content,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      // Groq only emits "function"-type tool calls; the OpenAI SDK's type also
      // allows a "custom" variant we never use, so narrow before touching .function.
      if (tc.type !== "function") continue;

      const args = JSON.parse(tc.function.arguments || "{}");

      if (tc.function.name === "present_findings") {
        const findings = fillMissingScheduleItems(args as Findings, lastSchedule, (args as Findings).mileage);
        yield { type: "final", findings };
        return;
      }

      yield { type: "tool_call", name: tc.function.name, input: args };
      const result = await runTool(tc.function.name, args);
      yield { type: "tool_result", name: tc.function.name, result };

      if (tc.function.name === "get_maintenance_schedule") {
        lastSchedule = result as ScheduleResult;
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  yield { type: "error", message: "Agent didn't converge on a final answer within the turn limit." };
}

export async function runFollowup(
  findings: Findings,
  history: ChatMessage[],
  question: string
): Promise<string> {
  const client = getClient();

  const context = JSON.stringify({
    vehicle: findings.vehicle,
    mileage: findings.mileage,
    items: findings.items,
    quoteVerdicts: findings.quoteVerdicts,
    summary: findings.summary,
  });

  const systemPrompt =
    `You already completed a maintenance-schedule audit for this vehicle. Here is that audit's ` +
    `full result as JSON, which you should treat as ground truth — do not contradict it or ` +
    `re-derive numbers differently:\n\n${context}\n\n` +
    `Answer the user's follow-up questions about this specific audit directly and specifically, ` +
    `citing the numbers above where relevant. Keep answers concise — 2-4 sentences unless the ` +
    `question genuinely requires more. You have no tools available for this — you already have ` +
    `everything you need in the audit above.`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
    { role: "user", content: question },
  ];

  const response = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.3,
  });

  return response.choices[0].message.content || "I don't have a response for that — try rephrasing?";
}
