# Android Play Store publishing via TWA — design

Date: 2026-08-12

## Context

ServiceAudit Agent is a Next.js web app deployed on Vercel. The ask: get it
onto the Google Play Store without rebuilding it natively, and without
disturbing the existing web app's behavior or deploy pipeline.

## Decisions made (brainstorming)

- **Approach: TWA (Trusted Web Activity)**, not a native/React Native
  rebuild. A TWA is a thin Android shell that opens the live production URL
  in a full-screen Chrome tab with no browser chrome — Google's own
  recommended path for "publish my existing website as an app." The web app
  itself is the product; nothing gets duplicated or reimplemented.
- **App identity**: display name "ServiceAudit Agent" (matches the site
  exactly), package ID `com.serviceauditagent.app` (auto-derived, no domain
  ownership required since it's just an internal Android identifier).
- **Icon**: rasterize the existing `public/logo.svg` gradient icon to every
  required Android size rather than commissioning new art. Can be revisited
  later if it reads poorly at large sizes — not a blocker for shipping.
- **Privacy policy**: drafted by me, based on the app's actual data
  handling (which I built, so this is precise, not guessed), reviewed and
  approved by the user before it goes live. Required by Play Store policy
  regardless of TWA vs. native.

## Design

### Two independent pieces, zero shared build

1. **Web app additions** (this repo, deployed by Vercel exactly as today):
   - `public/manifest.json` — name, icons, `display: "standalone"`, theme
     color. This is also what enables "Add to Home Screen" as an installable
     PWA on any phone, independent of the Play Store listing — a real side
     benefit, not just Android-app plumbing.
   - A minimal service worker (`public/sw.js`, registered from a small
     client component) — just enough to satisfy Android's PWA
     installability check (a registered service worker is a hard
     requirement for TWA). Not building offline support; that's separate,
     unrequested scope.
   - `src/app/privacy/page.tsx` — a new route, accurate content: no user
     accounts, no server-side database, quote photos are sent to a vision
     model for one-time transcription and are not retained, audit history
     lives only in the visitor's own browser (`localStorage`). Required by
     Play Store policy.
   - App icons rasterized from `public/logo.svg` at the sizes Android
     requires (512×512 store icon, adaptive-icon foreground/background
     layers, standard launcher sizes).

   All of the above are **new files only** — no existing page, component,
   or API route is modified. This is what "additive" means concretely: a
   diff that only adds files, and a production site that behaves
   identically for every existing visitor.

2. **Android project** (Bubblewrap-generated, **lives entirely outside
   this git repo** — not committed, not part of any PR):
   Bubblewrap CLI reads the deployed `manifest.json` and generates a Gradle
   project (icons, signing config, TWA shell) in a local-only directory. This
   is deliberate, not an oversight: the generated project includes a signing
   keystore, which must never be committed to version control under any
   circumstance (losing control of it is one thing; committing it to git
   history is unrecoverable even after deletion). The Gradle boilerplate
   itself is also irrelevant to the Next.js app's repo and would only add
   noise. The output artifact that matters is the final signed `.aab` file,
   handed to Play Console directly — the generation project itself doesn't
   need to be a permanent part of this codebase.

### Digital Asset Links verification

TWA requires proving the Android app and the website are controlled by the
same party, via a `/.well-known/assetlinks.json` file served from the
production domain, containing a SHA-256 fingerprint of the app's signing
certificate. This file **is** committed to the repo (it's public, harmless
metadata, not a secret) but its exact content depends on the signing
certificate generated during the Android project step — so it's a
second, small web-app commit that happens *after* Bubblewrap generates the
keystore, not part of the first batch of additive files.

### Task split — code vs. user action

**Code (this session, parallelizable across files with no shared state):**
- `public/manifest.json`
- `public/sw.js` + its registration
- `src/app/privacy/page.tsx`
- Rasterized icon set in `public/icons/`
- (Sequential, after the above ship) Bubblewrap project generation + signed
  `.aab` build, done locally, not committed
- (Sequential, after Bubblewrap) `/.well-known/assetlinks.json`, using the
  real certificate fingerprint

**User action (parallelizable with the code work, doesn't block it):**
- Create a Google Play Developer account, pay the one-time $25 fee
- Review/approve the drafted privacy policy content and store listing copy
  (title, short description, full description — drafted by me)
- Provide or approve 2-4 store listing screenshots
- Final upload of the `.aab` to Play Console (requires the developer
  account to exist — the one genuinely sequential dependency on the user's
  side)

## Out of scope

- Offline support / full PWA caching strategy — the service worker here
  exists only to satisfy TWA's installability requirement, not to make the
  app usable offline.
- iOS / App Store — not requested.
- Store listing screenshots' actual design/copy polish — I'll draft
  reasonable defaults, but final creative call is the user's.
- Rebuilding any part of the existing web app natively.
