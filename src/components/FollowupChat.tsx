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
  // Full history is still sent to the API for context, but only the latest
  // exchange is shown — this is a "current question" box, not a scrolling
  // chat thread.
  const visibleMessages = messages.slice(-2);

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

      {visibleMessages.length > 0 && (
        <div className="space-y-3 mb-4">
          {visibleMessages.map((m, i) => (
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
            className="flex-1 min-w-0 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20 transition placeholder:text-white/20"
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
