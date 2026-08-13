# Publishing to Google Play — reference doc

Status as of 2026-08-12: app created in Play Console, submitted for review.
Google's first-submission review typically takes a few days.

## Store listing copy

**Short description** (80 char limit):
> Check if a car repair quote is actually necessary — free, no signup required.

**Full description:**
> Got a quote from a dealer or shop and aren't sure if it's legitimate? ServiceAudit Agent checks it against your car's real manufacturer maintenance schedule — not generic industry averages — so you know exactly what's actually due, what's premature, and what's not on your schedule at all.
>
> HOW IT WORKS
> Enter your VIN (or year/make/model) and mileage, then paste in or photograph whatever a shop quoted you. The agent researches your vehicle's real maintenance schedule with cited sources, checks it against your mileage, and tells you which quoted items are justified — and which ones aren't.
>
> WHAT IT CHECKS
> • Real manufacturer schedule, not a generic table — with sources you can verify
> • Open safety recalls from NHTSA — recall repairs are free at any dealer
> • Which quoted services you can safely DIY, with real cost and time estimates
> • What's actually urgent vs. what can wait
> • Whether the price you were quoted looks typical for your area
>
> WHY TRUST IT
> Nothing here is guessed. Manufacturer schedules are researched with citations, not memorized. Recall data comes straight from NHTSA's own database. Anything safety-critical is verified in code, not left to chance.
>
> No account, no signup, no cost. Nothing you enter is stored on a server — your audit history stays only on your own device.

## App identity

- **App name:** ServiceAudit Agent
- **Package ID:** `app.vercel.service_audit_agent.twa`
- **Privacy policy URL:** https://service-audit-agent.vercel.app/privacy
- **Category:** suggest Tools or Auto & Vehicles

## Signing credentials

Kept **out of this repo** deliberately — a signing keystore must never be committed to git. Location:

```
~/Desktop/ServiceAuditAgent-Android-KEEP-SAFE/
```

Contains `android.keystore`, the built `app-release-bundle.aab` (what was uploaded to Play Console), `app-release-signed.apk` (for local device testing), `twa-manifest.json`, and a `README.txt` with the actual credentials. **Back that folder up externally** — losing the keystore means no future updates are possible under this listing, ever.

## Digital Asset Links

Live at `https://service-audit-agent.vercel.app/.well-known/assetlinks.json`, generated from the real signing certificate's SHA-256 fingerprint. This is what lets the app open full-screen without a browser address bar — already merged and deployed, no action needed unless the signing key ever changes.

## If a rebuild is ever needed

The Android/Bubblewrap project itself isn't committed to this repo (also deliberate — it's local tooling output, not application code). To rebuild from scratch:

```bash
cd ~/android-twa-serviceaudit  # or wherever it's regenerated
npx bubblewrap build
```

reading `twa-manifest.json` and `android.keystore` from that same directory. If that directory no longer exists, the manifest and keystore backed up on the Desktop (above) are the source of truth to reconstruct it from.

## Next steps once review completes

- [ ] Confirm Play Console review outcome (approved / rejected / changes requested)
- [ ] If approved: verify the live Play Store listing renders correctly (icon, screenshots, description)
- [ ] Test-install from the actual Play Store on a real Android device
- [ ] If rejected: address whatever Google's review flagged and resubmit
