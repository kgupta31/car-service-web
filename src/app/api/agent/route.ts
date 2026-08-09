import { NextRequest } from "next/server";
import { runAgent, transcribeQuoteImage } from "@/lib/agent";
import type { ScheduleResult } from "@/lib/tools";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_DATA_URL_LENGTH = 4_500_000;

type VehicleInput = { vin: string } | { manual: { year: string; make: string; model: string } };

function buildUserMessage(
  vehicle: VehicleInput,
  mileage: number,
  quoteItems: string[],
  drivingConditions: string,
  historyNote: string,
  photoUnreadable: boolean
): string {
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
  } else if (photoUnreadable) {
    msg +=
      "\nI attached a photo of my dealer/shop quote, but no clear line items could be read from it " +
      "(too blurry/unclear). Mention this in the summary, and just tell me what's overdue, what's " +
      "due now, and what's coming up soon based on my mileage.";
  } else {
    msg +=
      "\nNo quote was given to me yet. Just tell me what's overdue, what's due now, " +
      "and what's coming up soon based on my mileage.";
  }

  if (drivingConditions.trim().length > 0) {
    msg += `\n\nHere's how I actually drive this vehicle: ${drivingConditions.trim()}`;
  }

  if (historyNote.trim().length > 0) {
    msg += `\n\nThis vehicle has prior audit history:\n${historyNote.trim()}`;
  }

  return msg;
}

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
  const {
    mode,
    vin,
    year,
    make,
    model,
    mileage,
    quote,
    drivingConditions,
    historyNote,
    quoteImage,
    amountQuoted,
    zip,
    cachedSchedule,
  } = body as {
    mode?: "vin" | "manual";
    vin?: string;
    year?: string;
    make?: string;
    model?: string;
    mileage?: number;
    quote?: string;
    drivingConditions?: string;
    historyNote?: string;
    quoteImage?: string;
    amountQuoted?: number;
    zip?: string;
    cachedSchedule?: ScheduleResult;
  };

  const validAmountQuoted =
    typeof amountQuoted === "number" && Number.isFinite(amountQuoted) && amountQuoted > 0
      ? amountQuoted
      : undefined;
  const trimmedZip = typeof zip === "string" ? zip.trim() : "";

  // Client-supplied cache: only trust it if it's shaped correctly. A malformed
  // cache just means we do the search, never an error.
  const validCachedSchedule =
    cachedSchedule &&
    typeof cachedSchedule === "object" &&
    Array.isArray(cachedSchedule.schedule) &&
    cachedSchedule.schedule.length > 0
      ? cachedSchedule
      : undefined;

  if (quoteImage) {
    if (typeof quoteImage !== "string" || !/^data:image\/(png|jpe?g|webp);base64,/.test(quoteImage)) {
      return new Response(JSON.stringify({ error: "Invalid image format." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (quoteImage.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return new Response(JSON.stringify({ error: "Image is too large. Please use a smaller photo." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

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

  let quoteItems = (quote || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Transcribe the photo BEFORE the main loop runs, as its own short, isolated
  // call — so a photo only adds one bounded vision call instead of forcing the
  // entire multi-turn tool-calling loop onto a slower vision model. From here
  // on, transcribed items are treated exactly like typed quote items.
  let transcribedItems: string[] = [];
  if (quoteImage) {
    transcribedItems = await transcribeQuoteImage(quoteImage);
    if (transcribedItems.length > 0) {
      quoteItems = transcribedItems;
    }
  }

  const userMessage = buildUserMessage(
    vehicleInput,
    mileage,
    quoteItems,
    drivingConditions || "",
    historyNote || "",
    Boolean(quoteImage) && transcribedItems.length === 0
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      try {
        for await (const event of runAgent(
          userMessage,
          transcribedItems,
          validAmountQuoted,
          trimmedZip,
          validCachedSchedule
        )) {
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
