import type { Metadata } from "next";
import Link from "next/link";
import { SITE_TITLE } from "@/lib/site";

export const metadata: Metadata = {
  title: `Privacy Policy — ${SITE_TITLE}`,
  description: "How ServiceAudit Agent handles your data — no accounts, no server-side database, nothing sold or shared.",
};

export default function PrivacyPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 grid-bg" />
      <div className="absolute inset-0 noise" />
      <div className="relative max-w-3xl mx-auto px-6 py-16">
        <Link href="/" className="text-sm text-accent hover:underline">
          ← Back to ServiceAudit Agent
        </Link>

        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-white/40">Last updated: August 2026</p>

        <div className="mt-8 space-y-8 text-white/70 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white/90 mb-2">The short version</h2>
            <p>
              ServiceAudit Agent has no user accounts, no server-side database, and doesn&apos;t sell or
              share your data with anyone. Everything you enter is used only to generate your maintenance
              audit, and anything worth keeping (your audit history) is stored locally in your own
              browser — never on our servers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white/90 mb-2">What you give us</h2>
            <p>
              Your VIN or year/make/model, mileage, and (optionally) a dealer/shop quote — either typed
              in or as a photo — plus a ZIP code if you want a price comparison. This is sent to our
              server solely to generate your audit response. It is not stored in a database and is not
              retained after your request completes.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white/90 mb-2">Quote photos</h2>
            <p>
              If you upload a photo of a paper quote, it&apos;s sent to a hosted AI vision model (via
              Groq) for one-time text transcription — reading the line items off the image — and is not
              retained afterward. The photo itself never touches a database.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white/90 mb-2">What stays on your device</h2>
            <p>
              Your audit history and cached maintenance schedules are stored using your browser&apos;s
              local storage, tied to your device and browser only. We never see it, and it&apos;s never
              transmitted anywhere unless you explicitly use the Share button, which encodes that one
              audit into a link you choose to send.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white/90 mb-2">Analytics</h2>
            <p>
              This site uses Vercel Web Analytics, which is cookie-free and reports aggregated,
              anonymous usage counts (e.g. page views) — it does not track you individually or across
              other sites.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white/90 mb-2">Third-party services</h2>
            <p>
              Audits are processed using AI models hosted by Groq. Vehicle and recall lookups use
              NHTSA&apos;s free public APIs. The site itself is hosted on Vercel. None of these
              services receive more than what&apos;s needed to answer your specific request.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white/90 mb-2">Questions</h2>
            <p>
              Reach out at{" "}
              <a href="mailto:kgupta31@asu.edu" className="text-accent hover:underline">
                kgupta31@asu.edu
              </a>
              {" "}with any privacy questions.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
