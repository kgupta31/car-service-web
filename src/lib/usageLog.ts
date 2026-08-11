// Internal-only token usage logging — never shown to users, just visible in
// server logs (Vercel function logs) so real per-call costs can be read off
// directly instead of reconstructed from rate-limit error messages.
export function logUsage(
  context: string,
  model: string,
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null
): void {
  if (!usage) return;
  console.log(
    `[usage] ${context} model=${model} prompt=${usage.prompt_tokens ?? "?"} ` +
      `completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`
  );
}
