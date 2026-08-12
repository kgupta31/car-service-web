# Android Play Store TWA (Web-App Side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the web-app-side prerequisites for publishing ServiceAudit Agent to Google Play via TWA — manifest, service worker, privacy policy page, and app icons — without changing any existing page's behavior.

**Architecture:** Four genuinely file-disjoint tasks (icons, manifest, service worker, privacy page) that can be built in parallel since none of them touch a file another task touches, followed by one small sequential task wiring them into `layout.tsx`. The Android/Bubblewrap/signing side is explicitly out of scope for this plan — local-only, not committed, done as a manual follow-up once this ships.

**Tech Stack:** Next.js 16 App Router, `sharp` (already present transitively via `next`, no new dependency), plain Web Manifest / Service Worker APIs — no new frameworks.

**Reference:** `docs/superpowers/specs/2026-08-12-android-play-store-twa-design.md` for full design rationale — read it before starting.

**Working directory:** `/Users/kartikgupta/Desktop/car-service-web`, branch `android-play-store-twa` (already created off latest main). Before every commit: `rm -f AGENTS.md CLAUDE.md && git checkout -- tsconfig.json` — `next dev`/`next build` regenerate these and they must never be committed.

---

### Task 1: App icons

**Files:**
- Create: `public/icons/icon-maskable-source.svg`
- Create: `scripts/generate-icons.mjs`
- Create (generated, not hand-written): `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`

- [ ] **Step 1: Create the maskable-safe source SVG**

Android's maskable-icon spec requires the meaningful content to stay within the center ~66% of the canvas — the OS applies its own mask shape (circle/squircle/rounded-square) over the full icon and can crop right up to that boundary. The existing `public/logo.svg` fills close to the full canvas, so it needs a version with the glyph shrunk and centered, on a full-bleed (non-rounded) background — the OS's own mask handles the shape, so this source shouldn't apply its own corner rounding.

Create `public/icons/icon-maskable-source.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" fill="url(#g)"/>
  <g transform="translate(16 16) scale(0.6) translate(-16 -16)">
    <path d="M16 6 L23 8.5 V15 C23 20.5 20 24.5 16 26 C12 24.5 9 20.5 9 15 V8.5 Z" fill="none" stroke="#0b1220" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M12.3 15.6 L15 18.2 L20 12.2" fill="none" stroke="#0b1220" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>
```

This is the same shield-and-checkmark glyph as `public/logo.svg`, scaled to 60% and re-centered — comfortably inside the 66% safe zone, with margin to spare.

- [ ] **Step 2: Write the icon-generation script**

Create `scripts/generate-icons.mjs`:

```js
// One-off generation script — not part of the build pipeline. Run manually
// whenever the source SVGs change: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

mkdirSync("public/icons", { recursive: true });

await sharp("public/logo.svg").resize(192, 192).png().toFile("public/icons/icon-192.png");
await sharp("public/logo.svg").resize(512, 512).png().toFile("public/icons/icon-512.png");
await sharp("public/icons/icon-maskable-source.svg")
  .resize(512, 512)
  .png()
  .toFile("public/icons/icon-maskable-512.png");

console.log("Generated public/icons/icon-192.png, icon-512.png, icon-maskable-512.png");
```

- [ ] **Step 3: Run the script**

Run: `node scripts/generate-icons.mjs`
Expected output:
```
Generated public/icons/icon-192.png, icon-512.png, icon-maskable-512.png
```

- [ ] **Step 4: Verify the generated files are the right size**

Run: `node -e "const sharp=require('sharp'); ['public/icons/icon-192.png','public/icons/icon-512.png','public/icons/icon-maskable-512.png'].forEach(async f => { const m = await sharp(f).metadata(); console.log(f, m.width + 'x' + m.height); })"`
Expected: `public/icons/icon-192.png 192x192`, `public/icons/icon-512.png 512x512`, `public/icons/icon-maskable-512.png 512x512`

- [ ] **Step 5: Commit**

```bash
rm -f AGENTS.md CLAUDE.md
git checkout -- tsconfig.json 2>/dev/null
git add public/icons/icon-maskable-source.svg scripts/generate-icons.mjs public/icons/icon-192.png public/icons/icon-512.png public/icons/icon-maskable-512.png
git commit -m "Add generated app icons for the Android manifest (192/512/maskable)"
```

---

### Task 2: Web app manifest

**Files:**
- Create: `public/manifest.json`

- [ ] **Step 1: Create the manifest**

Create `public/manifest.json`:

```json
{
  "name": "ServiceAudit Agent",
  "short_name": "ServiceAudit",
  "description": "Free AI tool that checks a dealer or shop's repair quote against your car's real manufacturer maintenance schedule.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#08090d",
  "theme_color": "#08090d",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`background_color`/`theme_color` match this site's actual dark theme (`--color-bg: #08090d` in `src/app/globals.css`), so the splash screen and browser chrome (when installed) match the site instead of showing a jarring white flash.

This file depends on the icon paths Task 1 generates, but since it's just a JSON file referencing string paths (not a build-time import), it can be written and committed independently of Task 1's completion — the paths just need to exist by the time both are merged together.

- [ ] **Step 2: Validate the JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('public/manifest.json', 'utf8')); console.log('valid JSON')"`
Expected: `valid JSON`

- [ ] **Step 3: Commit**

```bash
rm -f AGENTS.md CLAUDE.md
git checkout -- tsconfig.json 2>/dev/null
git add public/manifest.json
git commit -m "Add web app manifest for PWA/TWA installability"
```

---

### Task 3: Service worker

**Files:**
- Create: `public/sw.js`
- Create: `src/components/ServiceWorkerRegister.tsx`

- [ ] **Step 1: Write the service worker**

Create `public/sw.js`:

```js
// Minimal service worker — exists only to satisfy the Trusted Web Activity
// installability requirement (Android requires a registered service worker
// with a fetch handler before it will treat a site as an installable app).
// Deliberately not implementing offline caching — every request just passes
// straight through to the network, unchanged. Real offline support is
// separate, unrequested scope.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
```

- [ ] **Step 2: Write the registration component**

Create `src/components/ServiceWorkerRegister.tsx`:

```tsx
"use client";

import { useEffect } from "react";

// Registers public/sw.js — required for TWA installability, not for offline
// support (see the comment in sw.js). Silently no-ops on failure or in
// browsers without serviceWorker support; this is purely additive and must
// never be able to break the page it's mounted on.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Best-effort — the site works identically with or without it.
      });
    }
  }, []);

  return null;
}
```

- [ ] **Step 3: Commit**

```bash
rm -f AGENTS.md CLAUDE.md
git checkout -- tsconfig.json 2>/dev/null
git add public/sw.js src/components/ServiceWorkerRegister.tsx
git commit -m "Add minimal service worker for TWA installability"
```

Not wired into `layout.tsx` yet — that's Task 5, after this and Task 2's manifest both exist.

---

### Task 4: Privacy policy page

**Files:**
- Create: `src/app/privacy/page.tsx`

- [ ] **Step 1: Create the privacy page**

Create `src/app/privacy/page.tsx`:

```tsx
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
              <a href="mailto:privacy@example.com" className="text-accent hover:underline">
                privacy@example.com
              </a>
              {" "}with any privacy questions.
            </p>
            <p className="mt-2 text-xs text-white/30">
              (Site owner: replace the email above with a real contact address before publishing.)
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
```

The visual structure (background layers, `max-w-*-mx-auto px-6`, `text-white/NN` opacity scale, `text-accent` links) matches `src/app/page.tsx`'s existing conventions — no new patterns introduced. The mailto placeholder and the note below it are deliberate: flagged explicitly in the design as something the user personalizes before this goes live, not a real contact address I can supply.

- [ ] **Step 2: Verify the route builds**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
rm -f AGENTS.md CLAUDE.md
git checkout -- tsconfig.json 2>/dev/null
git add src/app/privacy/page.tsx
git commit -m "Add /privacy page — required for Play Store submission"
```

---

### Task 5: Wire everything into layout.tsx (sequential — after Tasks 1-3 land)

**Files:**
- Modify: `src/app/layout.tsx`

This task depends on Task 1 (icon files), Task 2 (manifest — not directly imported, just referenced by path), and Task 3 (`ServiceWorkerRegister` component) all existing, so it must run after those three are merged, not in parallel with them.

- [ ] **Step 1: Update the metadata export and mount the service worker registration**

Find, in `src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";
import { SITE_URL, SITE_TITLE, SITE_DESCRIPTION } from "@/lib/site";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  keywords: [
    "is this car repair necessary",
    "am I being overcharged for car repair",
    "dealer maintenance upsell",
    "car maintenance schedule by VIN",
    "check dealer repair quote",
    "manufacturer maintenance schedule lookup",
  ],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "ServiceAudit Agent",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

Replace with:
```tsx
import type { Metadata } from "next";
import "./globals.css";
import { SITE_URL, SITE_TITLE, SITE_DESCRIPTION } from "@/lib/site";
import { Analytics } from "@vercel/analytics/next";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  manifest: "/manifest.json",
  keywords: [
    "is this car repair necessary",
    "am I being overcharged for car repair",
    "dealer maintenance upsell",
    "car maintenance schedule by VIN",
    "check dealer repair quote",
    "manufacturer maintenance schedule lookup",
  ],
  icons: {
    icon: "/logo.svg",
    apple: "/icons/icon-512.png",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "ServiceAudit Agent",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Analytics />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
```

Changes: added `manifest: "/manifest.json"` (this is what makes Next.js emit the `<link rel="manifest">` tag — the actual mechanism Android's installability check and "Add to Home Screen" both look for), added `apple` icon (harmless if unused, doesn't hurt), mounted `<ServiceWorkerRegister />` next to the existing `<Analytics />` mount — same pattern, same place.

- [ ] **Step 2: Typecheck, lint, build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: clean (`eslint src --max-warnings=0`).

Run: `npm run build`
Expected: clean build, same route list as before plus `/privacy`.

- [ ] **Step 3: Manual verification with the dev server**

Start: `npm run dev > /tmp/dev-server-twa.log 2>&1 &`, wait a few seconds, then:

```bash
curl -s http://localhost:3000/manifest.json | python3 -m json.tool
curl -s -o /dev/null -w "sw.js: %{http_code}\n" http://localhost:3000/sw.js
curl -s -o /dev/null -w "privacy page: %{http_code}\n" http://localhost:3000/privacy
curl -s http://localhost:3000/ | grep -o '<link rel="manifest"[^>]*>'
```

Expected: manifest prints valid parsed JSON, `sw.js: 200`, `privacy page: 200`, and the manifest `<link>` tag is present in the homepage's HTML head.

- [ ] **Step 4: Clean up and commit**

```bash
rm -f AGENTS.md CLAUDE.md
git checkout -- tsconfig.json 2>/dev/null
git add src/app/layout.tsx
git commit -m "Wire manifest.json and service worker registration into layout.tsx

Sequential final step — depends on the icons (Task 1), manifest.json
(Task 2), and ServiceWorkerRegister component (Task 3) all existing.
Site behavior is unchanged for every existing page; this only adds
the <link rel=manifest> tag and mounts the (silently best-effort)
service worker registration."
```

---

## Self-review notes (already applied above)

- **Spec coverage:** every "Code" item from the spec's task split maps to a task here — manifest (Task 2), service worker + registration (Task 3), `/privacy` (Task 4), icon rasterization (Task 1), final `layout.tsx` wiring (Task 5). Bubblewrap/signing/Play Console work is correctly excluded per the spec's explicit scope boundary.
- **Type/name consistency checked:** `ServiceWorkerRegister` is defined once (Task 3) and imported with that exact name in Task 5; icon file paths (`/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png`) are identical between Task 1's generation script and Task 2's manifest.
- **Parallel-safety check:** Tasks 1-4 each own a fully disjoint set of files (no two tasks write to the same file); only Task 5 touches a shared/existing file (`layout.tsx`) and is explicitly sequenced after the other four.
- **No placeholders:** every step has complete, copy-pasteable code, including the maskable SVG's exact transform values and the privacy page's full copy — the only intentional placeholder is the `privacy@example.com` contact address, which is called out explicitly as something the site owner must personalize, not an implementation gap.
