# Overwatch — AI Car Service Advisor (Web)

A Next.js web app around the same agent from the Python prototype — VIN +
mileage in, a real agentic tool-calling loop, a live reasoning trace, and
structured results rendered as cards instead of raw text. Deploys free on
Vercel; runs on Groq's free-tier, open-weight Llama 3.3 70B, so there's
nothing to pay and nothing end users need to sign up for.

## Why this still counts as an agent, not a form

The model decides which tools to call and in what order — `vin_decode` then
`get_maintenance_schedule` — and does all the mileage-interval reasoning
itself (overdue by how much, due within the next window, loosely-worded
dealer line items matched against schedule entries). The only addition vs.
the CLI version: instead of ending in free text, its final step is a call to
a `present_findings` tool with structured JSON, which is what lets the UI
render real status badges instead of parsing prose. The reasoning is still
100% the model's — this only changes the *shape* of its answer.

## Stack

- **Next.js 16** (App Router, TypeScript) — free to host on Vercel's Hobby tier
- **Tailwind CSS v4** — dark, glassmorphic UI, no default component library
- **Framer Motion** — animated trace log + result reveal
- **Groq** (OpenAI-compatible API) running **Llama 3.3 70B** — free tier, no credit card
- **NHTSA vPIC** — free, real VIN decoding, no key needed

## Run locally

```bash
npm install
cp .env.local.example .env.local
# edit .env.local and paste a free key from https://console.groq.com
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel for free

1. **Get a free Groq key**: [console.groq.com](https://console.groq.com) → API Keys → Create. No credit card.
2. **Push this folder to GitHub**:
   ```bash
   cd car-service-web
   git init && git add . && git commit -m "Car service advisor web app"
   git branch -M main
   git remote add origin https://github.com/<you>/car-service-advisor-web.git
   git push -u origin main
   ```
3. **Import into Vercel**: [vercel.com/new](https://vercel.com/new) → import the repo → framework preset auto-detects Next.js → don't deploy yet.
4. **Add the environment variable**: in the import screen (or later under Project → Settings → Environment Variables), add:
   ```
   GROQ_API_KEY = gsk_your_key_here
   ```
5. **Deploy.** You get a public `your-app.vercel.app` URL. Visitors never see or need any key — it's read server-side from your env var.

Vercel's Hobby plan is free forever for personal projects: unlimited deployments, generous serverless function usage, no credit card required. Groq's free tier (30 req/min, 14,400/day) is shared across everyone who visits your deployed app — plenty for a demo or a small group of real users.

## What's real vs. mocked

| Piece | Status |
|---|---|
| VIN decoding | **Real** — live NHTSA vPIC call, no key |
| Maintenance schedules | **Mocked** — small table for Camry/Civic/F-150 + generic fallback, in `src/lib/tools.ts`. Swap for a real CarMD API call here; nothing else needs to change. |
| Fair pricing / cost estimates | **Not built** — needs licensed labor/parts data; deliberately out of scope for this pass |

## Files

- `src/lib/tools.ts` — the two tools (`vin_decode`, `get_maintenance_schedule`) and their OpenAI-compatible schemas
- `src/lib/agent.ts` — the agent loop: model ↔ tool execution ↔ structured final answer, as an async generator that streams each step
- `src/app/api/agent/route.ts` — API route that streams the agent's steps to the browser over Server-Sent Events
- `src/components/AgentConsole.tsx` — the form, live trace log, and results UI
- `src/app/page.tsx` — landing page / hero

## Next steps

1. Swap the mocked schedule table for a real CarMD API call.
2. Add a `parse_dealer_quote` tool so people can paste a raw PDF/text quote instead of a clean comma list.
3. Add the pricing-fairness layer once a labor-data source is lined up.
4. If traffic outgrows Groq's free rate limit, add a simple per-IP cooldown in the API route, or move to a small paid tier.
