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
import { TOOL_SCHEMAS, runTool } from "./tools";
import type { Findings, AgentEvent } from "./types";

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

1. Call vin_decode to confirm make/model/year.
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
6. Finish by calling present_findings with the full structured result — this IS your final answer,
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

export async function* runAgent(userMessage: string): AsyncGenerator<AgentEvent> {
  const client = getClient();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const tools = [...TOOL_SCHEMAS, PRESENT_FINDINGS_TOOL];
  const MAX_TURNS = 8;

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
        yield { type: "final", findings: args as Findings };
        return;
      }

      yield { type: "tool_call", name: tc.function.name, input: args };
      const result = await runTool(tc.function.name, args);
      yield { type: "tool_result", name: tc.function.name, result };

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  yield { type: "error", message: "Agent didn't converge on a final answer within the turn limit." };
}
