# Task 3: Follow-Up Conversational Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user ask follow-up questions about their audit ("why is this premature?", "what should I say if they push back?") in a small chat box below the results, with the model reasoning from the same audit context — a real multi-turn interaction, not a one-shot report.

**Architecture:** One new server function (`runFollowup`, no tools, single non-streaming completion) + one new plain JSON API route (`/api/agent/followup` — deliberately NOT SSE, since there's no tool-call trace to stream; a single request/response is simpler and correct here) + one new client component (`FollowupChat`) mounted at the bottom of the existing results view. Session-only state (component state, not persisted), reuses the existing `checkRateLimit` limiter, capped at 6 user turns per audit enforced both client- and server-side.

**Tech Stack:** Same as the rest of the app. No test runner — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual checks against a live dev server.

---

### Task 1: Follow-up chat

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/agent.ts`
- Create: `src/app/api/agent/followup/route.ts`
- Create: `src/components/FollowupChat.tsx`
- Modify: `src/components/AgentConsole.tsx`

- [ ] **Step 1: Add `ChatMessage` to `src/lib/types.ts`**

Add this new type at the end of the file, after `AgentEvent`:

```ts
export type ChatMessage = { role: "user" | "assistant"; content: string };
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Add `runFollowup` to `src/lib/agent.ts`**

Replace the import line:

```ts
import type { Findings, FindingsItem, AgentEvent } from "./types";
```

with:

```ts
import type { Findings, FindingsItem, AgentEvent, ChatMessage } from "./types";
```

Add this new exported function at the end of the file, after `runAgent`'s closing `}`:

```ts
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
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Create the follow-up API route**

Create `src/app/api/agent/followup/route.ts`:

```ts
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
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Create the `FollowupChat` client component**

Create `src/components/FollowupChat.tsx`:

```tsx
"use client";

import { useState } from "react";
import { MessageCircle, Send, Loader2 } from "lucide-react";
import type { Findings, ChatMessage } from "@/lib/types";

const MAX_TURNS = 6;

export function FollowupChat({ findings }: { findings: Findings }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const turnsUsed = messages.filter((m) => m.role === "user").length;
  const atLimit = turnsUsed >= MAX_TURNS;

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading || atLimit) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/agent/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findings, history: messages, question }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      setMessages([...nextMessages, { role: "assistant", content: body.answer as string }]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex items-center gap-2 text-sm font-semibold mb-4">
        <MessageCircle className="size-4 text-accent" />
        Ask a follow-up
      </div>

      {messages.length > 0 && (
        <div className="space-y-3 mb-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-xl p-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-accent/10 border border-accent/20 text-white/90"
                  : "bg-white/[0.03] border border-white/10 text-white/70"
              }`}
            >
              {m.content}
            </div>
          ))}
        </div>
      )}

      {error && <div className="text-xs text-danger mb-3">{error}</div>}

      {atLimit ? (
        <p className="text-xs text-white/40">You&apos;ve reached the chat limit for this audit.</p>
      ) : (
        <form onSubmit={ask} className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. Why is the transmission flush premature?"
            className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition placeholder:text-white/20"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="shrink-0 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-accent to-accent-2 size-10 text-black disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Mount `FollowupChat` at the bottom of `ResultsView` in `AgentConsole.tsx`**

Add the import. Replace:

```ts
import { VehicleIcon } from "@/components/VehicleIcon";
```

with:

```ts
import { VehicleIcon } from "@/components/VehicleIcon";
import { FollowupChat } from "@/components/FollowupChat";
```

Then, at the very end of `ResultsView`'s returned JSX, replace:

```tsx
        </div>
      </div>
    </motion.div>
  );
}
```

with:

```tsx
        </div>
      </div>

      <FollowupChat findings={findings} />
    </motion.div>
  );
}
```

(This is the closing of the "Full schedule status" card, immediately before `</motion.div>` — the last card in the results view. `findings` here refers to the `ResultsView` function's own `findings` prop, which is still in scope even though most of its fields were destructured out of it earlier in the function.)

- [ ] **Step 9: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 10: Manual verification**

Run: `npm run dev`. Submit a VIN or manual entry with a quote (so there's rich context to ask about). Once results appear, scroll to the "Ask a follow-up" card and:
  - Ask a specific question (e.g. "why is the transmission flush premature?") and confirm you get a relevant, specific answer referencing real numbers from the audit — not a generic non-answer.
  - Ask a second follow-up and confirm it has context from the first exchange (e.g. "what about the other one?" should still make sense).
  - Confirm the turn counter enforces the cap: after 6 user messages, the input is replaced with the "reached the chat limit" message.
  Kill the dev server when done.

- [ ] **Step 11: Commit**

```bash
git add src/lib/types.ts src/lib/agent.ts src/app/api/agent/followup/route.ts src/components/FollowupChat.tsx src/components/AgentConsole.tsx
git commit -m "$(cat <<'EOF'
Add follow-up conversational chat on audit results

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 2: Regression check**

Manually confirm: the main VIN/manual-entry flow, km/mi toggle, severe-duty badge, dispute-draft card, and full schedule card all still work exactly as before — the follow-up chat is purely additive at the bottom of the results.
