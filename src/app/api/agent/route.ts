import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

type VehicleInput = { vin: string } | { manual: { year: string; make: string; model: string } };

function buildUserMessage(vehicle: VehicleInput, mileage: number, quoteItems: string[]): string {
  let msg: string;
  if ("vin" in vehicle) {
    msg = `My VIN is ${vehicle.vin} and my current mileage is ${mileage}.\n`;
  } else {
    const { year, make, model } = vehicle.manual;
    msg =
      `My vehicle is a ${year} ${make} ${model}. I don't have the VIN, so skip vin_decode and go ` +
      `straight to looking up the maintenance schedule for this make/model. My current mileage is ${mileage}.\n`;
  }

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
  const { mode, vin, year, make, model, mileage, quote } = body as {
    mode?: "vin" | "manual";
    vin?: string;
    year?: string;
    make?: string;
    model?: string;
    mileage?: number;
    quote?: string;
  };

  const resolvedMode = mode === "manual" ? "manual" : "vin";

  let vehicleInput: VehicleInput;

  if (resolvedMode === "vin") {
    if (!vin || typeof vin !== "string" || vin.trim().length !== 17) {
      return new Response(JSON.stringify({ error: "Provide a full 17-character VIN." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    vehicleInput = { vin: vin.trim().toUpperCase() };
  } else {
    const yearTrimmed = (year || "").trim();
    const makeTrimmed = (make || "").trim();
    const modelTrimmed = (model || "").trim();
    if (!/^\d{4}$/.test(yearTrimmed) || makeTrimmed.length === 0 || modelTrimmed.length === 0) {
      return new Response(JSON.stringify({ error: "Provide year, make, and model." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    vehicleInput = { manual: { year: yearTrimmed, make: makeTrimmed, model: modelTrimmed } };
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

  const userMessage = buildUserMessage(vehicleInput, mileage, quoteItems);

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
