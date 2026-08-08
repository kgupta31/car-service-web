import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

function buildUserMessage(vin: string, mileage: number, quoteItems: string[]): string {
  let msg = `My VIN is ${vin} and my current mileage is ${mileage}.\n`;
  if (quoteItems.length > 0) {
    const items = quoteItems.map((s) => `- ${s.trim()}`).join("\n");
    msg +=
      `\nMy dealership/shop has proposed the following services:\n${items}\n\n` +
      "Tell me which of these are actually justified right now, which are premature, " +
      "and which aren't on the manufacturer schedule at all.";
  } else {
    msg +=
      "\nNo quote was given to me yet. Just tell me what's overdue, what's due now, " +
      "and what's coming up soon based on my mileage.";
  }
  return msg;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { vin, mileage, quote } = body as { vin?: string; mileage?: number; quote?: string };

  if (!vin || typeof vin !== "string" || vin.trim().length !== 17) {
    return new Response(JSON.stringify({ error: "Provide a full 17-character VIN." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (typeof mileage !== "number" || mileage < 0) {
    return new Response(JSON.stringify({ error: "Provide a valid mileage." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const quoteItems = (quote || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const userMessage = buildUserMessage(vin.trim().toUpperCase(), mileage, quoteItems);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        for await (const event of runAgent(userMessage)) {
          send(event);
        }
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
