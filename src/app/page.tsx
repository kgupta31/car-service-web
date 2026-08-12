import Link from "next/link";
import AgentConsole from "@/components/AgentConsole";
import { FAQAccordion } from "@/components/FAQAccordion";
import { ShieldCheck, Zap, GitBranch } from "lucide-react";
import { SITE_URL, SITE_DESCRIPTION } from "@/lib/site";

const FAQ_ITEMS = [
  {
    q: "How do I know if a car repair is actually necessary?",
    a: "Compare it against your manufacturer's maintenance schedule at your exact mileage. If a service isn't due yet — or isn't on the schedule at all — it's very likely padding. ServiceAudit Agent does this automatically: give it your VIN (or year/make/model) and mileage, paste in whatever a shop quoted you, and it tells you which items are justified, premature, or not on the schedule.",
  },
  {
    q: "How can I tell if a dealership is upselling me on maintenance?",
    a: "The biggest red flag is a service pushed well before its real interval — for example a transmission flush at 30,000 miles when the manufacturer schedule calls for it at 60,000. The FTC specifically recommends checking any shop-proposed service against your owner's manual before agreeing to it.",
  },
  {
    q: "Where do I find my car's real manufacturer maintenance schedule?",
    a: "It's in your owner's manual, but most people don't have it handy. ServiceAudit Agent looks it up for you from your VIN or year/make/model — no manual required.",
  },
  {
    q: "Is a service due if it's not listed in my owner's manual?",
    a: "Almost never. If a shop recommends something that isn't on your manufacturer's schedule at all, ask what specific inspection or symptom justifies it right now — 'not on schedule' is the single strongest signal of unnecessary upselling.",
  },
  {
    q: "What should I ask before approving a repair?",
    a: "Ask two things: is this listed in my maintenance schedule at my current mileage, and if not, what test or inspection shows I need it now? A reputable shop can answer both specifically.",
  },
  {
    q: "Is ServiceAudit Agent free?",
    a: "Yes — it runs on a free, open-weight AI model and doesn't require signup.",
  },
];

export default function Home() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  const appJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "ServiceAudit Agent",
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    applicationCategory: "UtilitiesApplication",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      {/* Background layers */}
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 noise" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[560px] w-[900px] rounded-full bg-accent/20 blur-[140px]" />
      <div className="absolute top-40 right-0 h-[400px] w-[500px] rounded-full bg-accent-2/10 blur-[140px]" />

      <div className="relative">
        {/* Nav */}
        <header className="max-w-5xl mx-auto px-6 pt-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="" className="size-7" />
            <span className="font-semibold tracking-tight">ServiceAudit Agent</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-white/40">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <span className="size-1.5 rounded-full bg-ok animate-pulse" />
              Free · open-weight model · no signup
            </span>
          </div>
        </header>

        {/* Hero */}
        <section className="max-w-3xl mx-auto px-6 pt-16 sm:pt-20 pb-10 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/50 mb-6">
            <Zap className="size-3 text-accent" />
            An actual AI agent — not a lookup table
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.1]">
            Know what your car
            <br />
            <span className="text-gradient">actually needs.</span>
          </h1>
          <p className="mt-5 text-white/50 text-base sm:text-lg leading-relaxed max-w-xl mx-auto">
            Got a repair quote from a dealer or shop? Give the agent your VIN and
            mileage — it pulls your car&apos;s real manufacturer maintenance schedule
            and tells you exactly which items are actually due, which are premature,
            and which aren&apos;t on the schedule at all.
          </p>
        </section>

        {/* Console */}
        <section className="px-6 pb-16">
          <AgentConsole />
        </section>

        {/* Trust strip */}
        <section className="max-w-3xl mx-auto px-6 pb-24">
          <div className="grid sm:grid-cols-3 gap-4 text-xs text-white/40">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-accent shrink-0" />
              Reasons over manufacturer intervals, not fixed rules
            </div>
            <div className="flex items-center gap-2">
              <GitBranch className="size-4 text-accent shrink-0" />
              Live VIN decode via NHTSA&apos;s public database
            </div>
            <div className="flex items-center gap-2">
              <Zap className="size-4 text-accent shrink-0" />
              Runs on an open-weight model, free to operate
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-6 pb-24">
          <h2 className="text-2xl font-semibold tracking-tight text-center mb-10">
            Frequently asked questions
          </h2>
          <FAQAccordion items={FAQ_ITEMS} />
        </section>

        {/* Footer */}
        <footer className="max-w-5xl mx-auto px-6 pb-10 flex items-center justify-center gap-4 text-xs text-white/30">
          <span>ServiceAudit Agent</span>
          <span aria-hidden="true">·</span>
          <Link href="/privacy" className="hover:text-white/60 transition">
            Privacy Policy
          </Link>
        </footer>
      </div>
    </main>
  );
}
